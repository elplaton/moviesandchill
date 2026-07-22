import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from pydantic import BaseModel

from telegram_client import TelegramDownloader
from extractor import extract_archive, find_first_archive

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=__import__("sys").stdout,
)
logger = logging.getLogger("tmd")
from storage import format_size, get_free_space, suggest_folder_name, create_movie_folder
from storage import save_paused_batch, load_paused_batches, delete_paused_batch

app = FastAPI(title="Telegram Movie Downloader")

ENV_FILE = ".env"

downloader = None
config = {}
active_ws = []
_batch_tasks = {}
_stream_semaphore = None


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


class DeleteRequest(BaseModel):
    path: str


class PauseRequest(BaseModel):
    batch_id: str


class ConfigRequest(BaseModel):
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


@app.on_event("startup")
async def startup():
    global downloader, config, _stream_semaphore
    with open("config.json") as f:
        config = json.load(f)
    _stream_semaphore = asyncio.Semaphore(config.get("stream_max", 3))
    downloader = TelegramDownloader(config)
    await downloader.start()
    logger.info("Server started | channels: %d | download_parallel: %d",
                len(config.get("channels", [])), config.get("download_parallel", 3))


@app.on_event("shutdown")
async def shutdown():
    if downloader:
        await downloader.stop()


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse("templates/index.html")


@app.post("/api/search")
async def search(req: SearchRequest):
    if not req.query.strip():
        return {"results": [], "count": 0, "has_more": False, "last_message_id": 0}
    results = await downloader.search_messages(req.query.strip(), 50, req.offset_id, reverse=req.sort_asc, channel_ids=req.channel_ids)
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


@app.get("/api/channels")
async def channels():
    return {"channels": [
        {"id": ch["id"], "name": ch["name"]}
        for ch in downloader.channel_ids
    ]}


@app.post("/api/download")
async def download(req: DownloadRequest, background_tasks: BackgroundTasks):
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


@app.post("/api/cancel")
async def cancel(req: CancelRequest):
    task = _batch_tasks.get(req.batch_id)
    if not task:
        return {"error": "Descarga no encontrada o ya finalizada"}
    batch = downloader.active_batches.get(req.batch_id)
    if not batch or batch["status"] != "downloading":
        return {"error": "La descarga no se puede cancelar en su estado actual"}
    batch["_cancelled"] = True
    task.cancel()
    return {"status": "cancelling", "batch_id": req.batch_id}


@app.post("/api/pause")
async def pause(req: PauseRequest):
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


@app.get("/api/resumable")
async def resumable():
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


@app.post("/api/resume")
async def resume(req: PauseRequest, background_tasks: BackgroundTasks):
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


@app.get("/api/status")
async def status():
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


@app.delete("/api/files")
async def delete_file(req: DeleteRequest):
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


@app.get("/api/files")
async def list_files(subpath: str = ""):
    base = os.path.realpath(config["extract_path"])
    if subpath:
        target = os.path.realpath(os.path.join(base, subpath))
        if not target.startswith(base + os.sep) and target != base:
            return {"files": [], "path": base, "error": "Ruta no permitida"}
    else:
        target = base
    if not os.path.isdir(target):
        return {"files": [], "path": target}
    items = []
    for entry in sorted(os.listdir(target)):
        full = os.path.join(target, entry)
        items.append({
            "name": entry,
            "is_dir": os.path.isdir(full),
            "size": format_size(_dir_size(full)) if os.path.isdir(full) else format_size(os.path.getsize(full)),
            "path": full,
        })
    return {"files": items, "path": target, "parent": subpath}


@app.get("/api/stream")
async def stream(request: Request, path: str = ""):
    base = os.path.realpath(config["extract_path"])
    target = os.path.realpath(os.path.join(base, path))
    if not target.startswith(base + os.sep) and target != base:
        raise HTTPException(status_code=403, detail="Ruta no permitida")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""
    mime_map = {
        "mkv": "video/x-matroska", "mp4": "video/mp4", "avi": "video/x-msvideo",
        "ts": "video/mp2t", "mov": "video/quicktime", "webm": "video/webm",
        "m4v": "video/mp4", "flv": "video/x-flv", "wmv": "video/x-ms-wmv",
    }
    content_type = mime_map.get(ext, "application/octet-stream")

    async with _stream_semaphore:
        async def chunked_stream():
            CHUNK = 1024 * 1024
            with open(target, "rb") as f:
                while True:
                    chunk = f.read(CHUNK)
                    if not chunk:
                        break
                    yield chunk
                    if await request.is_disconnected():
                        return

        return StreamingResponse(
            chunked_stream(),
            media_type=content_type,
            headers={
                "Content-Disposition": "inline",
                "Accept-Ranges": "bytes",
            }
        )


@app.get("/dev", response_class=HTMLResponse)
async def dev_page():
    return FileResponse("templates/logs.html")


@app.get("/settings", response_class=HTMLResponse)
async def settings_page():
    return FileResponse("templates/settings.html")


@app.get("/api/config")
async def get_config():
    sources = _get_env_sources()
    return {"config": config, "sources": sources, "has_env": os.path.isfile(ENV_FILE)}


@app.post("/api/config")
async def save_config(req: ConfigRequest):
    data = req.model_dump(exclude_none=True)
    for k, v in data.items():
        config[k] = v
    if os.path.isfile(ENV_FILE):
        _save_env_overrides(data, config)
    with open("config.json", "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    if "channels" in data:
        downloader.channel_ids = config["channels"]
    if "download_path" in data:
        downloader.download_path = config["download_path"]
    return {"status": "saved"}


@app.get("/api/logs")
async def logs(lines: int = 100):
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


@app.websocket("/ws/progress")
async def ws_progress(ws: WebSocket):
    await ws.accept()
    active_ws.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in active_ws:
            active_ws.remove(ws)


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


ENV_KEY_MAP = {
    "api_id": "TMD_API_ID",
    "api_hash": "TMD_API_HASH",
    "phone": "TMD_PHONE",
    "download_path": "TMD_DOWNLOAD_PATH",
    "extract_path": "TMD_EXTRACT_PATH",
    "server_host": "TMD_SERVER_HOST",
    "server_port": "TMD_SERVER_PORT",
    "download_parallel": "TMD_DOWNLOAD_PARALLEL",
    "stream_max": "TMD_STREAM_MAX",
    "delete_archives_after_extract": "TMD_DELETE_ARCHIVES",
    "convert_dts_to_ac3": "TMD_CONVERT_DTS",
}


def _get_env_sources():
    if not os.path.isfile(ENV_FILE):
        return {}
    sources = {}
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _ = line.split("=", 1)
            key = key.strip()
            for cfg_key, env_key in ENV_KEY_MAP.items():
                if env_key == key:
                    sources[cfg_key] = "env"
                    break
    return sources


def _save_env_overrides(data, config):
    if not os.path.isfile(ENV_FILE):
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        lines = f.readlines()
    updated = set()
    for cfg_key, env_var in ENV_KEY_MAP.items():
        if cfg_key not in data:
            continue
        val = config[cfg_key]
        if isinstance(val, bool):
            val = "true" if val else "false"
        key = f"{env_var}="
        found = False
        for i, line in enumerate(lines):
            if line.strip().startswith(key) or line.strip().startswith(f"# {key}") or line.strip().startswith(f"#{key}"):
                lines[i] = f"{key}{val}\n"
                found = True
                updated.add(env_var)
                break
        if not found:
            lines.append(f"{key}{val}\n")
            updated.add(env_var)
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(lines)


def _strip_filename(name):
    name = re.sub(r"\.part\d+", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.\d{3,}$", "", name)
    for ext in [".rar", ".zip", ".7z", ".tar.gz", ".tar.bz2", ".tar", ".tgz", ".tbz2",
                ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts"]:
        if name.lower().endswith(ext):
            name = name[:-len(ext)]
            break
    return name


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


def _convert_dts_audio(file_list):
    VIDEO_EXTS = ('.mkv', '.mp4', '.avi', '.ts', '.m4v', '.mov')
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
            codec = r.stdout.strip()
        except Exception:
            codec = ""
        if not codec or 'dts' not in codec.lower():
            converted.append(f)
            continue
        out = os.path.splitext(f)[0] + "_ac3" + os.path.splitext(f)[1]
        subprocess.run([
            "ffmpeg", "-i", f, "-map", "0", "-c", "copy",
            "-c:a", "ac3", "-b:a", "640k", out, "-y",
            "-loglevel", "error",
        ], check=True)
        os.replace(out, f)
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
                None, _convert_dts_audio, all_extracted,
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
