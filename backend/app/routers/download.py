import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import time
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, get_current_user_ws
from app.services.telegram_client import TelegramDownloader
from app.services.extractor import extract_archive, find_first_archive
from app.services.storage import format_size, get_free_space, suggest_folder_name, create_movie_folder
from app.services.storage import save_paused_batch, load_paused_batches, delete_paused_batch

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["download"])

active_ws: list[WebSocket] = []
_batch_tasks: dict[str, asyncio.Task] = {}

downloader: TelegramDownloader | None = None
config: dict = {}
_stream_semaphore: asyncio.Semaphore | None = None


def init_download_router(dl: TelegramDownloader, cfg: dict):
    global downloader, config, _stream_semaphore
    downloader = dl
    config = cfg
    _stream_semaphore = asyncio.Semaphore(cfg.get("stream_max", 3))


class SearchRequest(BaseModel):
    query: str
    page_size: int = 8
    offset_id: int = 0
    sort_asc: bool = False
    channel_ids: list[int] | None = None


class DownloadRequest(BaseModel):
    message_id: int
    channel_id: int | None = None


class CancelRequest(BaseModel):
    batch_id: str


class PauseRequest(BaseModel):
    batch_id: str


class DeleteRequest(BaseModel):
    path: str


@router.post("/search")
async def search(req: SearchRequest, user: Annotated[str, Depends(get_current_user)]):
    if not req.query.strip():
        return {"results": [], "count": 0, "has_more": False, "last_message_id": 0}
    results = await downloader.search_messages(
        req.query.strip(), 50, req.offset_id,
        reverse=req.sort_asc, channel_ids=req.channel_ids,
    )
    has_more = len(results) > req.page_size
    if has_more:
        results = results[:req.page_size]
    existing = _find_downloaded_files(config.get("extract_path", "."))
    for r in results:
        r["downloaded"] = _strip_filename(r.get("file_name") or "").lower() in existing
    return {
        "results": results,
        "count": len(results),
        "has_more": has_more,
        "last_message_id": results[-1]["id"] if results else 0,
    }


@router.post("/download")
async def download(req: DownloadRequest, background_tasks: BackgroundTasks, user: Annotated[str, Depends(get_current_user)]):
    dl = downloader

    for batch_id, batch in list(dl.active_batches.items()):
        if batch["status"] in ("downloading", "extracting"):
            for part in batch["parts"]:
                if part["message_id"] == req.message_id:
                    return {
                        "error": "Ese archivo ya esta en descarga",
                        "batch_id": batch_id,
                        "folder_name": batch["folder_name"],
                    }

    base_name, folder_name, parts = await dl.find_related_parts(req.message_id, req.channel_id)
    if not parts:
        return {"error": "No se encontro el mensaje o no tiene archivo adjunto"}

    folder_path = create_movie_folder(config["extract_path"], folder_name or "descarga")
    total_size = sum(p.get("size", 0) for p in parts)

    batch_id = str(req.message_id)

    dl.active_batches[batch_id] = {
        "batch_id": batch_id,
        "base_name": base_name or folder_name or "",
        "folder_name": os.path.basename(folder_path),
        "folder_path": folder_path,
        "parts": [
            {
                "message_id": p["message_id"],
                "file_name": p["file_name"],
                "part_num": p.get("part_num", 0),
                "size": p.get("size", 0),
                "size_str": format_size(p.get("size", 0)),
                "downloaded": 0,
                "progress": 0,
                "status": "pending",
            }
            for p in parts
        ],
        "total_parts": len(parts),
        "downloaded_parts": 0,
        "total_size": total_size,
        "total_size_str": format_size(total_size),
        "downloaded_size": 0,
        "progress": 0,
        "status": "downloading",
        "extracted_files": [],
        "error": None,
    }

    task = asyncio.create_task(_download_batch(batch_id))
    task.add_done_callback(lambda _, bid=batch_id: _batch_tasks.pop(bid, None))
    _batch_tasks[batch_id] = task

    return {
        "status": "started",
        "batch_id": batch_id,
        "folder_name": os.path.basename(folder_path),
        "folder_path": folder_path,
        "total_parts": len(parts),
        "parts": [
            {"message_id": p["message_id"], "file_name": p["file_name"]}
            for p in parts
        ],
    }


@router.post("/cancel")
async def cancel(req: CancelRequest, user: Annotated[str, Depends(get_current_user)]):
    task = _batch_tasks.get(req.batch_id)
    if not task:
        return {"error": "Descarga no encontrada o ya finalizada"}
    batch = downloader.active_batches.get(req.batch_id)
    if not batch or batch["status"] != "downloading":
        return {"error": "La descarga no se puede cancelar en su estado actual"}
    batch["_cancelled"] = True
    task.cancel()
    return {"status": "cancelling", "batch_id": req.batch_id}


@router.post("/pause")
async def pause(req: PauseRequest, user: Annotated[str, Depends(get_current_user)]):
    task = _batch_tasks.get(req.batch_id)
    batch = downloader.active_batches.get(req.batch_id)
    if not task or not batch or batch["status"] != "downloading":
        return {"error": "La descarga no se puede pausar en su estado actual"}
    batch["_cancelled"] = True
    task.cancel()
    for p in batch["parts"]:
        if p["status"] == "done" and not os.path.isfile(os.path.join(batch.get("folder_path", ""), p.get("file_name", ""))):
            p["status"] = "pending"
    save_paused_batch(req.batch_id, batch)
    batch["status"] = "paused"
    _batch_tasks.pop(req.batch_id, None)
    downloader.active_batches.pop(req.batch_id, None)
    await _broadcast_progress({
        "type": "batch_status",
        "batch_id": req.batch_id,
        "status": "paused",
        "folder_name": batch.get("folder_name", ""),
    })
    return {"status": "paused", "batch_id": req.batch_id}


@router.get("/resumable")
async def resumable(user: Annotated[str, Depends(get_current_user)]):
    items = []
    for bid, b in load_paused_batches().items():
        items.append({
            "batch_id": b["batch_id"],
            "folder_name": b["folder_name"],
            "total_parts": b["total_parts"],
            "downloaded_parts": b.get("downloaded_parts", 0),
            "total_size_str": b.get("total_size_str", ""),
            "parts": [{
                "message_id": p["message_id"],
                "file_name": p["file_name"],
                "status": p["status"],
                "size_str": p.get("size_str", ""),
            } for p in b["parts"]],
        })
    return {"batches": items}


@router.post("/resume")
async def resume(req: PauseRequest, background_tasks: BackgroundTasks, user: Annotated[str, Depends(get_current_user)]):
    dl = downloader
    saved = load_paused_batches().get(req.batch_id)
    if not saved:
        return {"error": "Descarga pausada no encontrada"}
    batch = {
        "batch_id": saved["batch_id"],
        "base_name": saved.get("base_name", ""),
        "folder_name": saved["folder_name"],
        "folder_path": saved["folder_path"],
        "parts": saved["parts"],
        "total_parts": saved["total_parts"],
        "downloaded_parts": saved.get("downloaded_parts", 0),
        "total_size": saved.get("total_size", 0),
        "total_size_str": saved.get("total_size_str", ""),
        "downloaded_size": saved.get("downloaded_size", 0),
        "progress": 0,
        "status": "downloading",
        "extracted_files": [],
        "error": None,
    }
    dl.active_batches[req.batch_id] = batch
    delete_paused_batch(req.batch_id)
    task = asyncio.create_task(_download_batch(req.batch_id))
    task.add_done_callback(lambda _, bid=req.batch_id: _batch_tasks.pop(bid, None))
    _batch_tasks[req.batch_id] = task
    return {
        "status": "resumed",
        "batch_id": req.batch_id,
        "folder_name": saved["folder_name"],
        "total_parts": saved["total_parts"],
        "parts": [{"message_id": p["message_id"], "file_name": p["file_name"]} for p in saved["parts"]],
    }


@router.get("/status")
async def status(user: Annotated[str, Depends(get_current_user)]):
    batches = []
    for bid, b in downloader.active_batches.items():
        batches.append({
            "batch_id": b["batch_id"],
            "folder_name": b["folder_name"],
            "status": b["status"],
            "total_parts": b["total_parts"],
            "downloaded_parts": b["downloaded_parts"],
            "total_size_str": b["total_size_str"],
            "progress": b.get("progress", 0),
            "error": b.get("error"),
            "parts": [{
                "message_id": p["message_id"],
                "file_name": p["file_name"],
                "status": p["status"],
                "progress": p["progress"],
                "size_str": p["size_str"],
            } for p in b["parts"]],
        })
    return {
        "active_batches": batches,
        "disk_free": format_size(get_free_space(config["extract_path"])),
    }


@router.delete("/files")
async def delete_file(req: DeleteRequest, user: Annotated[str, Depends(get_current_user)]):
    base_dir = os.path.realpath(config["extract_path"])
    target = os.path.realpath(req.path)
    if not target.startswith(base_dir + os.sep) and target != base_dir:
        return {"error": "Ruta no permitida"}
    if not os.path.exists(target):
        return {"error": "El archivo o carpeta no existe"}
    try:
        if os.path.isdir(target):
            shutil.rmtree(target)
        else:
            os.remove(target)
        return {"deleted": req.path}
    except OSError as e:
        return {"error": str(e)}


@router.get("/files")
async def list_files(subpath: str = "", user: Annotated[str, Depends(get_current_user)] = None):
    from app.services.tmdb import clean_title
    base = os.path.realpath(config["extract_path"])
    if subpath:
        target = os.path.realpath(os.path.join(base, subpath))
        if not target.startswith(base + os.sep) and target != base:
            return {"files": [], "path": base, "error": "Ruta no permitida"}
    else:
        target = base
    if not os.path.isdir(target):
        return {"files": [], "path": target}

    VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts"}
    SEASON_RE = re.compile(r"^(.*?)\s*[sS](\d{1,2})\s*$")

    dirs = [e for e in sorted(os.listdir(target)) if os.path.isdir(os.path.join(target, e))]
    season_groups: dict[str, list[str]] = {}
    standalone_dirs = []

    for d in dirs:
        m = SEASON_RE.match(d)
        if m:
            base_name = m.group(1).strip()
            key = base_name.lower()
            if key not in season_groups:
                season_groups[key] = []
            season_groups[key].append(d)
        else:
            standalone_dirs.append(d)

    items = []
    processed_dirs = set()

    for key, season_dirs in season_groups.items():
        all_episodes = []
        for sd in sorted(season_dirs):
            sd_path = os.path.join(target, sd)
            for vf in sorted(os.listdir(sd_path)):
                vf_path = os.path.join(sd_path, vf)
                if os.path.splitext(vf)[1].lower() in VIDEO_EXTS and os.path.isfile(vf_path):
                    all_episodes.append({
                        "name": vf,
                        "size": format_size(os.path.getsize(vf_path)),
                        "path": vf_path,
                    })
            processed_dirs.add(sd)
        if len(all_episodes) >= 1:
            display_name = season_dirs[0] if len(season_dirs) == 1 else key.title()
            items.append({
                "name": display_name,
                "is_dir": True,
                "size": format_size(sum(
                    os.path.getsize(os.path.join(target, sd, ep["name"]))
                    for sd in season_dirs
                    for ep in all_episodes
                    if os.path.isfile(os.path.join(target, sd, ep["name"]))
                )),
                "path": os.path.join(target, season_dirs[0]),
                "is_series": True,
                "clean_name": clean_title(key),
                "episodes": all_episodes,
            })

    for d in standalone_dirs:
        full = os.path.join(target, d)
        sub_files = sorted(os.listdir(full))
        videos = [f for f in sub_files if os.path.splitext(f)[1].lower() in VIDEO_EXTS
                  and os.path.isfile(os.path.join(full, f))]
        if len(videos) > 1:
            episodes = []
            for vf in videos:
                vf_path = os.path.join(full, vf)
                episodes.append({
                    "name": vf,
                    "size": format_size(os.path.getsize(vf_path)),
                    "path": vf_path,
                })
            items.append({
                "name": d,
                "is_dir": True,
                "size": format_size(_dir_size(full)),
                "path": full,
                "is_series": True,
                "clean_name": clean_title(d),
                "episodes": episodes,
            })
            continue
        elif len(videos) == 1:
            vf = videos[0]
            vf_path = os.path.join(full, vf)
            items.append({
                "name": vf,
                "is_dir": False,
                "size": format_size(os.path.getsize(vf_path)),
                "path": vf_path,
                "is_series": False,
                "clean_name": clean_title(vf),
            })
            continue

    for entry in sorted(os.listdir(target)):
        full = os.path.join(target, entry)
        if os.path.isdir(full):
            continue
        items.append({
            "name": entry,
            "is_dir": False,
            "size": format_size(os.path.getsize(full)),
            "path": full,
            "is_series": False,
            "clean_name": clean_title(entry),
        })
    return {"files": items, "path": target, "parent": subpath}


@router.get("/stream")
async def stream(request: Request, path: str = "", user: Annotated[str, Depends(get_current_user)] = None):
    base = os.path.realpath(config["extract_path"])
    target = os.path.realpath(os.path.join(base, path))
    if not target.startswith(base + os.sep) and target != base:
        raise HTTPException(status_code=403, detail="Ruta no permitida")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    file_size = os.path.getsize(target)
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""
    mime_map = {
        "mkv": "video/x-matroska", "mp4": "video/mp4", "avi": "video/x-msvideo",
        "ts": "video/mp2t", "mov": "video/quicktime", "webm": "video/webm",
        "m4v": "video/mp4", "flv": "video/x-flv", "wmv": "video/x-ms-wmv",
    }
    content_type = mime_map.get(ext, "application/octet-stream")

    range_header = request.headers.get("Range")
    start = 0
    end = file_size - 1

    if range_header:
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if match:
            start = int(match.group(1))
            end_str = match.group(2)
            end = int(end_str) if end_str else file_size - 1
            if end >= file_size:
                end = file_size - 1
            if start > end:
                raise HTTPException(status_code=416, detail="Range no valido")

    async with _stream_semaphore:
        CHUNK = 1024 * 1024
        content_length = end - start + 1

        async def chunked_stream():
            with open(target, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        headers = {
            "Content-Disposition": "inline",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
        }

        if range_header:
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
            return StreamingResponse(
                chunked_stream(),
                status_code=206,
                media_type=content_type,
                headers=headers,
            )

        return StreamingResponse(
            chunked_stream(),
            media_type=content_type,
            headers=headers,
        )


@router.get("/channels")
async def channels(user: Annotated[str, Depends(get_current_user)]):
    from app.database.connection import get_active_channels
    db_channels = await get_active_channels()
    if db_channels:
        return {"channels": db_channels}
    return {"channels": [
        {"id": ch["id"], "name": ch["name"]}
        for ch in downloader.channel_ids
    ]}


@router.get("/dialogs")
async def dialogs(user: Annotated[str, Depends(get_current_user)]):
    try:
        dialogs = await downloader.list_dialogs()
    except Exception:
        return {"dialogs": [], "error": "No se pudo conectar a Telegram"}

    from app.database.connection import get_all_channels
    db_all = await get_all_channels()
    configured_ids = {ch["id"] for ch in (db_all or []) if ch.get("active")}

    items = []
    for d in dialogs:
        items.append({
            "id": d["id"],
            "name": d["name"],
            "is_channel": d["is_channel"],
            "is_group": d["is_group"],
            "is_megagroup": d.get("is_megagroup", False),
            "active": d["id"] in configured_ids,
        })
    items.sort(key=lambda x: (not x["active"], not x["is_channel"], x["name"].lower()))
    return {"dialogs": items}


class AddChannelRequest(BaseModel):
    url: str


@router.post("/channels/add")
async def add_channel_by_url(req: AddChannelRequest, user: Annotated[str, Depends(get_current_user)]):
    url = req.url.strip()
    if not url:
        return {"error": "URL vacia"}

    match = re.match(r'(?:https?://)?t\.me/(c/)?(-?\d+)(?:/\d+)?', url)
    if not match:
        match = re.match(r'(?:https?://)?t\.me/([a-zA-Z][\w]+)', url)
    if not match:
        return {"error": "URL no valida. Formatos:\n- https://t.me/c/ID\n- https://t.me/username"}

    if match.group(1) == "c/" or (match.group(2) and match.group(2).isdigit()):
        num = match.group(2)
        entity_input = int(f"-100{num}" if not num.startswith("-") else num)
    else:
        entity_input = match.group(1)
        if not entity_input:
            return {"error": "No se pudo extraer el ID/nombre del canal"}

    try:
        client = downloader.client
        entity = await client.get_entity(entity_input)
        name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Sin nombre"
        ch_id = entity.id
    except Exception as e:
        logger.error("Error resolviendo canal: %s", e)
        return {"error": f"No se pudo resolver el canal: {e}"}

    is_new = await downloader.add_channel(ch_id, name)

    try:
        from app.database.connection import upsert_channel, get_pool
        if get_pool():
            await upsert_channel(ch_id, name)
    except Exception as e:
        logger.warning("No se pudo guardar canal en Oracle: %s", e)

    logger.info("Canal %s | ID=%d | name=%s", "anadido" if is_new else "actualizado", ch_id, name)
    return {
        "status": "added" if is_new else "updated",
        "channel": {"id": ch_id, "name": name},
    }


class MetadataRequest(BaseModel):
    names: list[str]


@router.post("/metadata/batch")
async def batch_metadata(req: MetadataRequest, user: Annotated[str, Depends(get_current_user)]):
    api_key = config.get("tmdb_api_key", "")
    if not api_key:
        return {"metadata": {}}
    from app.services.tmdb import batch_search, clean_title
    cleaned = [clean_title(n) for n in req.names if n]
    results = await batch_search(api_key, cleaned)
    return {"metadata": {name: meta for name, meta in results.items()}}


@router.get("/config")
async def get_config(user: Annotated[str, Depends(get_current_user)]):
    return {"config": {k: v for k, v in config.items() if k not in ("jwt_secret", "database_url")}}


class ConfigUpdateRequest(BaseModel):
    api_id: int | None = None
    api_hash: str | None = None
    phone: str | None = None
    channels: list[dict] | None = None
    download_path: str | None = None
    extract_path: str | None = None
    server_host: str | None = None
    server_port: int | None = None
    delete_archives_after_extract: bool | None = None
    download_parallel: int | None = None
    convert_dts_to_ac3: bool | None = None


@router.post("/config")
async def save_config_endpoint(req: ConfigUpdateRequest, user: Annotated[str, Depends(get_current_user)]):
    data = req.model_dump(exclude_none=True)

    if "channels" in data:
        try:
            from app.database.connection import set_active_channels, get_active_channels
            channel_ids = [ch["id"] for ch in data["channels"]]
            await set_active_channels(channel_ids)
            db_active = await get_active_channels()
            if db_active:
                await downloader.refresh_from_db(db_active)
                config["channels"] = db_active
        except Exception as e:
            logger.warning("No se pudo actualizar canales en Oracle: %s", e)
        data.pop("channels")

    for k, v in data.items():
        config[k] = v

    logger.info("Configuracion actualizada via API por %s: %s", user, list(data.keys()))
    return {"status": "saved", "message": "Cambios aplicados en memoria. Para persistir, edita .env"}




@router.get("/logs")
async def logs(lines: int = 100, user: Annotated[str, Depends(get_current_user)] = None):
    try:
        result = subprocess.run(
            ["journalctl", "-u", "telegram-movie",
             "-n", str(lines), "--no-pager",
             "-o", "short-iso"],
            capture_output=True, text=True, timeout=5,
        )
        out = result.stdout.strip()
        return {"logs": out.split("\n") if out else [], "count": len(out.split("\n")) if out else 0}
    except Exception as e:
        return {"logs": [], "count": 0, "error": str(e)}


@router.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    token = websocket.query_params.get("token")
    username = await get_current_user_ws(websocket, token)
    if not username:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    active_ws.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_ws:
            active_ws.remove(websocket)


async def _broadcast_progress(data):
    disconnected = []
    for ws in active_ws:
        try:
            await ws.send_json(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in active_ws:
            active_ws.remove(ws)


async def _download_batch(batch_id):
    dl = downloader
    batch = dl.active_batches.get(batch_id)
    if not batch:
        return

    try:
        folder = batch["folder_path"]
        os.makedirs(folder, exist_ok=True)
        logger.info("Download batch %s started | %s | %d parts",
                     batch_id, batch.get("folder_name", ""), batch["total_parts"])

        parallel = config.get("download_parallel", 3)
        sem = asyncio.Semaphore(parallel)
        batch["_last_broadcast"] = 0

        async def _download_one_part(idx, part):
            if part.get("status") == "error":
                return
            if part.get("status") == "done":
                batch["downloaded_parts"] += 1
                return
            async with sem:
                part["status"] = "downloading"
                await _broadcast_progress({
                    "type": "batch_update",
                    "batch_id": batch_id,
                    "part_message_id": part["message_id"],
                    "part_idx": idx,
                    "status": "downloading",
                })

                def make_progress_cb(msg_id):
                    def cb(_msg_id, current, total):
                        pct = int(current / total * 100) if total else 0
                        for p in batch["parts"]:
                            if p["message_id"] == msg_id:
                                p["downloaded"] = current
                                p["progress"] = pct
                                break

                        total_downloaded = sum(p["downloaded"] for p in batch["parts"])
                        total_size = batch["total_size"]
                        overall_pct = int(total_downloaded / total_size * 100) if total_size else 0
                        batch["downloaded_size"] = total_downloaded
                        batch["progress"] = overall_pct

                        now = time.monotonic()
                        if now - batch["_last_broadcast"] >= 1.0:
                            batch["_last_broadcast"] = now
                            asyncio.ensure_future(_broadcast_progress({
                                "type": "batch_progress",
                                "batch_id": batch_id,
                                "part_message_id": msg_id,
                                "part_idx": idx,
                                "part_progress": pct,
                                "overall_progress": overall_pct,
                                "downloaded_size_str": format_size(total_downloaded),
                                "total_size_str": batch["total_size_str"],
                            }))
                    return cb

                try:
                    await dl.download_to_folder(
                        part["message_id"], folder,
                        progress_callback=make_progress_cb(part["message_id"]),
                    )
                    part["status"] = "done"
                    part["progress"] = 100
                    batch["downloaded_parts"] += 1
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    part["status"] = "error"
                    part["error"] = str(e)

                await _broadcast_progress({
                    "type": "batch_update",
                    "batch_id": batch_id,
                    "part_message_id": part["message_id"],
                    "status": "done" if part["status"] == "done" else "error",
                    "downloaded_parts": batch["downloaded_parts"],
                    "total_parts": batch["total_parts"],
                    "overall_progress": batch.get("progress", 0),
                })

        await asyncio.gather(*[
            _download_one_part(idx, p)
            for idx, p in enumerate(batch["parts"])
        ])

        batch.pop("_last_broadcast", None)

        if any(p["status"] == "error" for p in batch["parts"]):
            raise Exception("Una o mas partes fallaron la descarga")

        if batch.get("_cancelled"):
            raise asyncio.CancelledError()

        batch["status"] = "extracting"
        batch["progress"] = 100
        logger.info("Extraction starting | %s", batch.get("folder_name", ""))

        downloaded_files = [
            os.path.join(folder, p["file_name"])
            for p in batch["parts"]
        ]
        all_extracted = []

        first_file = find_first_archive(downloaded_files)
        if first_file and _is_archived(first_file):
            extract_target = first_file
        elif len(downloaded_files) == 1 and _is_archived(downloaded_files[0]):
            extract_target = downloaded_files[0]
        else:
            extract_target = None

        if extract_target:
            loop = asyncio.get_event_loop()
            extract_task = loop.run_in_executor(
                None, extract_archive, extract_target, folder,
                config.get("delete_archives_after_extract", True),
            )
            while not extract_task.done():
                await _broadcast_progress({
                    "type": "batch_status",
                    "batch_id": batch_id,
                    "status": "extracting",
                    "overall_progress": 100,
                })
                await asyncio.sleep(0.5)
            extracted, is_archive = extract_task.result()
            all_extracted.extend(extracted)
        else:
            all_extracted = downloaded_files

        _flatten_single_subfolder(folder)
        all_extracted = [
            os.path.join(folder, f)
            for f in os.listdir(folder)
            if os.path.isfile(os.path.join(folder, f))
        ] or all_extracted

        batch["extracted_files"] = all_extracted

        if config.get("convert_dts_to_ac3", False):
            batch["status"] = "converting"
            logger.info("Audio conversion starting | %s", batch.get("folder_name", ""))
            loop = asyncio.get_event_loop()
            convert_task = loop.run_in_executor(
                None, _convert_audio, all_extracted,
            )
            while not convert_task.done():
                await _broadcast_progress({
                    "type": "batch_status",
                    "batch_id": batch_id,
                    "status": "converting",
                    "overall_progress": 100,
                })
                await asyncio.sleep(0.5)
            all_extracted = convert_task.result()
            batch["extracted_files"] = all_extracted

        batch["status"] = "done"
        logger.info("Batch complete | %s | %d files extracted",
                     batch.get("folder_name", ""), len(all_extracted))

        await _broadcast_progress({
            "type": "batch_status",
            "batch_id": batch_id,
            "status": "done",
            "folder_name": batch["folder_name"],
            "folder_path": batch["folder_path"],
            "extracted_files": [os.path.basename(f) for f in all_extracted],
        })

    except asyncio.CancelledError:
        batch["status"] = "cancelled"
        logger.info("Batch cancelled | %s", batch.get("folder_name", ""))
        _cleanup_partial_files(batch.get("folder_path", ""), {p["file_name"] for p in batch["parts"]})
        batch.pop("_last_broadcast", None)
        batch.pop("_cancelled", None)
        await _broadcast_progress({
            "type": "batch_status",
            "batch_id": batch_id,
            "status": "cancelled",
            "folder_name": batch.get("folder_name", ""),
        })
    except Exception as e:
        batch["status"] = "error"
        batch["error"] = str(e)
        logger.error("Batch failed | %s | %s", batch.get("folder_name", ""), e)
        await _broadcast_progress({
            "type": "batch_status",
            "batch_id": batch_id,
            "status": "error",
            "error": str(e),
            "folder_name": batch["folder_name"],
            "parts": [{
                "message_id": p["message_id"],
                "file_name": p["file_name"],
                "status": p["status"],
                "error": p.get("error"),
            } for p in batch["parts"]],
        })

    await asyncio.sleep(10)
    downloader.active_batches.pop(batch_id, None)


def _find_downloaded_files(base_dir):
    found = set()
    if not os.path.isdir(base_dir):
        return found
    for root, dirs, files in os.walk(base_dir):
        for name in files:
            found.add(_strip_filename(name).lower())
        for name in dirs:
            found.add(name.lower())
    return found


def _strip_filename(name):
    name = re.sub(r"\.part\d+", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.\d{3,}$", "", name)
    for ext in [".rar", ".zip", ".7z", ".tar.gz", ".tar.bz2", ".tar", ".tgz", ".tbz2",
                ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts"]:
        if name.lower().endswith(ext):
            name = name[:-len(ext)]
            break
    return name


def _convert_audio(file_list):
    VIDEO_EXTS = ('.mkv', '.mp4', '.avi', '.ts', '.m4v', '.mov')
    INCOMPATIBLE = {'dts', 'dtshd', 'truehd', 'ac3', 'eac3', 'dolbydigital', 'dolbye', 'mlp'}
    converted = []
    for f in file_list:
        if not f.lower().endswith(VIDEO_EXTS):
            converted.append(f)
            continue
        try:
            r = subprocess.run(
                ["mediainfo", "--Inform=Audio;%Format%", f],
                capture_output=True, text=True, timeout=10,
            )
            codec = r.stdout.strip().lower()
        except Exception:
            codec = ""
        codec_norm = re.sub(r'[^a-z0-9]', '', codec)
        if not codec_norm or not any(bad in codec_norm for bad in INCOMPATIBLE):
            converted.append(f)
            continue
        logger.info("Audio conversion: %s -> AAC | codec=%s", os.path.basename(f), codec)
        tmp = os.path.splitext(f)[0] + "_tmp" + os.path.splitext(f)[1]
        try:
            subprocess.run([
                "ffmpeg", "-i", f, "-map", "0", "-c:v", "copy",
                "-c:a", "aac", "-b:a", "256k", tmp, "-y",
                "-loglevel", "error",
            ], check=True)
            os.replace(tmp, f)
        except Exception as e:
            logger.error("Audio conversion failed for %s: %s", f, e)
            if os.path.isfile(tmp):
                os.remove(tmp)
        converted.append(f)
    return converted


def _flatten_single_subfolder(folder):
    items = os.listdir(folder)
    if len(items) != 1:
        return
    sub = os.path.join(folder, items[0])
    if not os.path.isdir(sub):
        return
    for f in os.listdir(sub):
        shutil.move(os.path.join(sub, f), os.path.join(folder, f))
    os.rmdir(sub)


def _cleanup_partial_files(folder, target_files=None):
    if not folder or not os.path.isdir(folder):
        return
    for f in os.listdir(folder):
        if target_files is not None and f not in target_files:
            continue
        fpath = os.path.join(folder, f)
        try:
            if os.path.isfile(fpath):
                os.remove(fpath)
            elif os.path.isdir(fpath):
                shutil.rmtree(fpath)
        except OSError:
            pass
    if not os.listdir(folder):
        try:
            os.rmdir(folder)
        except OSError:
            pass


def _is_archived(file_path):
    fname = file_path.lower()
    return fname.endswith((".rar", ".zip", ".7z", ".tar.gz", ".tar.bz2", ".tar", ".tgz", ".tbz2")) or ".part" in fname or fname.endswith(".001")


def _dir_size(path):
    total = 0
    try:
        for entry in os.scandir(path):
            if entry.is_file(follow_symlinks=False):
                total += entry.stat().st_size
            elif entry.is_dir(follow_symlinks=False):
                total += _dir_size(entry.path)
    except PermissionError:
        pass
    return total
