import asyncio
import logging
import os
import shutil
import time
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, get_current_account
from app.services.compat import make_compatible
from app.services.extractor import extract_archive, find_first_archive
from app.services.storage import format_size, get_free_space, suggest_folder_name, create_movie_folder
from app.services.storage import save_paused_batch, load_paused_batches, delete_paused_batch
from app.routers.ws_router import broadcast_progress

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["download"])

_batch_tasks: dict[str, asyncio.Task] = {}

downloader = None
config: dict = {}


def init_download_router(dl, cfg):
    global downloader, config
    downloader = dl
    config = cfg


class DownloadRequest(BaseModel):
    message_id: int
    channel_id: int | None = None


class CancelRequest(BaseModel):
    batch_id: str


class PauseRequest(BaseModel):
    batch_id: str


@router.post("/download")
async def download(req: DownloadRequest, background_tasks: BackgroundTasks, account: Annotated[dict, Depends(get_current_account)]):
    from app.database.downloads import find_existing, usage_by_user, create_download
    dl = downloader
    for batch_id, batch in list(dl.active_batches.items()):
        if batch["status"] in ("downloading", "extracting"):
            for part in batch["parts"]:
                if part["message_id"] == req.message_id:
                    return {"error": f"Ese archivo ya lo está descargando {batch.get('owner', 'otra cuenta')}",
                            "batch_id": batch_id, "folder_name": batch["folder_name"], "already": True}

    base_name, folder_name, parts = await dl.find_related_parts(req.message_id, req.channel_id)
    if not parts:
        return {"error": "No se encontro el mensaje o no tiene archivo adjunto"}

    folder_path = create_movie_folder(config["extract_path"], folder_name or "descarga")
    total_size = sum(p.get("size", 0) for p in parts)

    # Una descarga por archivo para todo el mundo: si ya esta en disco (de
    # quien sea) se ofrece ver, no volver a bajar.
    existing = await find_existing(req.message_id, req.channel_id, folder_path)
    if existing and existing["status"] == "done" and os.path.exists(existing["folder_path"]):
        return {"error": f"Ya está descargado por {existing.get('owner') or 'admin'}", "already": True,
                "owner": existing.get("owner"), "folder_name": existing["folder_name"]}

    # Cuota de disco de la cuenta: lo que ya ocupa (incluido lo que esta bajando) mas esto.
    quota = account.get("quota_bytes")
    if quota is not None and account.get("role") != "admin":
        used = await usage_by_user(account["id"])
        if used + total_size > quota:
            return {"error": f"No cabe en tu cuota: usas {format_size(used)} de {format_size(quota)} "
                             f"y esto ocupa {format_size(total_size)}", "quota_exceeded": True,
                    "used_bytes": used, "quota_bytes": quota}

    # El message_id solo es unico dentro de un canal: sin el prefijo, dos canales
    # distintos con el mismo id pisarian el batch del otro.
    batch_id = f"{req.channel_id or 0}_{req.message_id}"
    await create_download(account["id"], os.path.basename(folder_path), folder_path, base_name or folder_name or "",
                          req.message_id, req.channel_id, total_size, "downloading")

    dl.active_batches[batch_id] = {
        "batch_id": batch_id, "base_name": base_name or folder_name or "",
        "owner": account["username"], "owner_id": account["id"],
        "folder_name": os.path.basename(folder_path), "folder_path": folder_path,
        "parts": [{"message_id": p["message_id"], "file_name": p["file_name"], "part_num": p.get("part_num", 0), "size": p.get("size", 0), "size_str": format_size(p.get("size", 0)), "downloaded": 0, "progress": 0, "status": "pending"} for p in parts],
        "total_parts": len(parts), "downloaded_parts": 0, "total_size": total_size, "total_size_str": format_size(total_size),
        "downloaded_size": 0, "progress": 0, "status": "downloading", "extracted_files": [], "error": None,
    }

    task = asyncio.create_task(_download_batch(batch_id))
    task.add_done_callback(lambda _, bid=batch_id: _batch_tasks.pop(bid, None))
    _batch_tasks[batch_id] = task

    return {"status": "started", "batch_id": batch_id, "folder_name": os.path.basename(folder_path), "folder_path": folder_path, "total_parts": len(parts), "parts": [{"message_id": p["message_id"], "file_name": p["file_name"]} for p in parts]}


def _may_manage(batch: dict, account: dict) -> bool:
    return account.get("role") == "admin" or batch.get("owner_id") in (None, account.get("id"))


@router.post("/cancel")
async def cancel(req: CancelRequest, account: Annotated[dict, Depends(get_current_account)]):
    task = _batch_tasks.get(req.batch_id)
    if not task:
        return {"error": "Descarga no encontrada o ya finalizada"}
    batch = downloader.active_batches.get(req.batch_id)
    if not batch or batch["status"] != "downloading":
        return {"error": "La descarga no se puede cancelar en su estado actual"}
    if not _may_manage(batch, account):
        return {"error": f"Solo {batch.get('owner', 'su dueño')} puede cancelarla"}
    batch["_cancelled"] = True
    task.cancel()
    return {"status": "cancelling", "batch_id": req.batch_id}


@router.post("/pause")
async def pause(req: PauseRequest, account: Annotated[dict, Depends(get_current_account)]):
    from app.database.downloads import set_download_status
    task = _batch_tasks.get(req.batch_id)
    batch = downloader.active_batches.get(req.batch_id)
    if not task or not batch or batch["status"] != "downloading":
        return {"error": "La descarga no se puede pausar en su estado actual"}
    if not _may_manage(batch, account):
        return {"error": f"Solo {batch.get('owner', 'su dueño')} puede pausarla"}
    await set_download_status(batch["folder_path"], "paused")
    batch["_paused"] = True
    batch["_cancelled"] = True
    task.cancel()
    for p in batch["parts"]:
        if p["status"] == "done" and not os.path.isfile(os.path.join(batch.get("folder_path", ""), p.get("file_name", ""))):
            p["status"] = "pending"
    save_paused_batch(req.batch_id, batch)
    batch["status"] = "paused"
    _batch_tasks.pop(req.batch_id, None)
    downloader.active_batches.pop(req.batch_id, None)
    await broadcast_progress({"type": "batch_status", "batch_id": req.batch_id, "status": "paused", "folder_name": batch.get("folder_name", "")})
    return {"status": "paused", "batch_id": req.batch_id}


@router.get("/resumable")
async def resumable(user: Annotated[str, Depends(get_current_user)]):
    items = []
    for bid, b in load_paused_batches().items():
        items.append({"batch_id": b["batch_id"], "folder_name": b["folder_name"], "total_parts": b["total_parts"], "downloaded_parts": b.get("downloaded_parts", 0), "total_size_str": b.get("total_size_str", ""), "parts": [{"message_id": p["message_id"], "file_name": p["file_name"], "status": p["status"], "size_str": p.get("size_str", "")} for p in b["parts"]]})
    return {"batches": items}


@router.post("/resume")
async def resume(req: PauseRequest, background_tasks: BackgroundTasks, account: Annotated[dict, Depends(get_current_account)]):
    from app.database.downloads import get_download_by_path, set_download_status
    dl = downloader
    saved = load_paused_batches().get(req.batch_id)
    if not saved:
        return {"error": "Descarga pausada no encontrada"}
    row = await get_download_by_path(saved["folder_path"])
    if row and account.get("role") != "admin" and row["owner_id"] != account["id"]:
        return {"error": f"Solo {row.get('owner') or 'su dueño'} puede reanudarla"}
    await set_download_status(saved["folder_path"], "downloading")
    batch = {"batch_id": saved["batch_id"], "base_name": saved.get("base_name", ""), "folder_name": saved["folder_name"], "folder_path": saved["folder_path"], "parts": saved["parts"], "total_parts": saved["total_parts"], "downloaded_parts": saved.get("downloaded_parts", 0), "total_size": saved.get("total_size", 0), "total_size_str": saved.get("total_size_str", ""), "downloaded_size": saved.get("downloaded_size", 0), "progress": 0, "status": "downloading", "extracted_files": [], "error": None,
             "owner": (row or {}).get("owner") or account["username"], "owner_id": (row or {}).get("owner_id") or account["id"]}
    dl.active_batches[req.batch_id] = batch
    delete_paused_batch(req.batch_id)
    task = asyncio.create_task(_download_batch(req.batch_id))
    task.add_done_callback(lambda _, bid=req.batch_id: _batch_tasks.pop(bid, None))
    _batch_tasks[req.batch_id] = task
    return {"status": "resumed", "batch_id": req.batch_id, "folder_name": saved["folder_name"], "total_parts": saved["total_parts"], "parts": [{"message_id": p["message_id"], "file_name": p["file_name"]} for p in saved["parts"]]}


@router.get("/status")
async def status(user: Annotated[str, Depends(get_current_user)]):
    batches = []
    for bid, b in downloader.active_batches.items():
        batches.append({"batch_id": b["batch_id"], "folder_name": b["folder_name"], "status": b["status"], "total_parts": b["total_parts"], "downloaded_parts": b["downloaded_parts"], "total_size_str": b["total_size_str"], "progress": b.get("progress", 0), "error": b.get("error"), "owner": b.get("owner"), "parts": [{"message_id": p["message_id"], "file_name": p["file_name"], "status": p["status"], "progress": p["progress"], "size_str": p["size_str"]} for p in b["parts"]]})
    return {"active_batches": batches, "disk_free": format_size(get_free_space(config["extract_path"]))}


async def _download_batch(batch_id):
    dl = downloader
    batch = dl.active_batches.get(batch_id)
    if not batch:
        return

    try:
        folder = batch["folder_path"]
        os.makedirs(folder, exist_ok=True)
        # Se recuenta desde cero: cada parte (incluidas las ya hechas) suma abajo,
        # y al reanudar el valor guardado las contaria por duplicado.
        batch["downloaded_parts"] = 0
        logger.info("Download batch %s started | %s | %d parts", batch_id, batch.get("folder_name", ""), batch["total_parts"])

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
                await broadcast_progress({"type": "batch_update", "batch_id": batch_id, "part_message_id": part["message_id"], "part_idx": idx, "status": "downloading"})

                def make_progress_cb(msg_id):
                    def cb(_msg_id, current, total):
                        pct = int(current / total * 100) if total else 0
                        for p in batch["parts"]:
                            if p["message_id"] == msg_id:
                                p["downloaded"] = current; p["progress"] = pct; break
                        total_downloaded = sum(p["downloaded"] for p in batch["parts"])
                        batch["downloaded_size"] = total_downloaded
                        batch["progress"] = int(total_downloaded / batch["total_size"] * 100) if batch["total_size"] else 0
                        now = time.monotonic()
                        if now - batch["_last_broadcast"] >= 1.0:
                            batch["_last_broadcast"] = now
                            asyncio.ensure_future(broadcast_progress({"type": "batch_progress", "batch_id": batch_id, "part_message_id": msg_id, "part_idx": idx, "part_progress": pct, "overall_progress": batch["progress"], "downloaded_size_str": format_size(total_downloaded), "total_size_str": batch["total_size_str"]}))
                    return cb

                try:
                    await dl.download_to_folder(part["message_id"], folder, progress_callback=make_progress_cb(part["message_id"]))
                    part["status"] = "done"; part["progress"] = 100; batch["downloaded_parts"] += 1
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    part["status"] = "error"; part["error"] = str(e)
                await broadcast_progress({"type": "batch_update", "batch_id": batch_id, "part_message_id": part["message_id"], "status": "done" if part["status"] == "done" else "error", "downloaded_parts": batch["downloaded_parts"], "total_parts": batch["total_parts"], "overall_progress": batch.get("progress", 0)})

        await asyncio.gather(*[_download_one_part(idx, p) for idx, p in enumerate(batch["parts"])])
        batch.pop("_last_broadcast", None)

        if any(p["status"] == "error" for p in batch["parts"]):
            raise Exception("Una o mas partes fallaron la descarga")
        if batch.get("_cancelled"):
            raise asyncio.CancelledError()

        batch["status"] = "extracting"; batch["progress"] = 100
        logger.info("Extraction starting | %s", batch.get("folder_name", ""))
        downloaded_files = [os.path.join(folder, p["file_name"]) for p in batch["parts"]]
        all_extracted = []

        first_file = find_first_archive(downloaded_files)
        extract_target = first_file if first_file and _is_archived(first_file) else (downloaded_files[0] if len(downloaded_files) == 1 and _is_archived(downloaded_files[0]) else None)

        if extract_target:
            loop = asyncio.get_event_loop()
            extract_task = loop.run_in_executor(None, extract_archive, extract_target, folder, config.get("delete_archives_after_extract", True))
            while not extract_task.done():
                await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "extracting", "overall_progress": 100})
                await asyncio.sleep(0.5)
            extracted, is_archive = extract_task.result()
            all_extracted.extend(extracted)
        else:
            all_extracted = downloaded_files

        _flatten_single_subfolder(folder)
        all_extracted = [os.path.join(folder, f) for f in os.listdir(folder) if os.path.isfile(os.path.join(folder, f))] or all_extracted
        batch["extracted_files"] = all_extracted

        if config.get("convert_dts_to_ac3", False):
            batch["status"] = "converting"
            logger.info("MP4 conversion starting | %s", batch.get("folder_name", ""))
            loop = asyncio.get_event_loop()
            convert_task = loop.run_in_executor(None, make_compatible, all_extracted)
            while not convert_task.done():
                await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "converting", "overall_progress": 100})
                await asyncio.sleep(0.5)
            all_extracted = convert_task.result()
            batch["extracted_files"] = all_extracted

        batch["status"] = "done"
        from app.database.downloads import set_download_status, dir_size
        await set_download_status(folder, "done", dir_size(folder))
        logger.info("Batch complete | %s | %d files", batch.get("folder_name", ""), len(all_extracted))
        await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "done", "folder_name": batch["folder_name"], "folder_path": batch["folder_path"], "extracted_files": [os.path.basename(f) for f in all_extracted]})

    except asyncio.CancelledError:
        batch.pop("_last_broadcast", None); batch.pop("_cancelled", None)
        if batch.pop("_paused", False):
            # Pausa: se borran solo las descargas a medias. Si se borrasen todas
            # las partes (como hacia antes) el "reanudar" quedaria inservible,
            # porque el estado guardado las da por completas y se las salta.
            incomplete = {p["file_name"] for p in batch["parts"] if p.get("status") != "done"}
            kept = len(batch["parts"]) - len(incomplete)
            _cleanup_partial_files(batch.get("folder_path", ""), incomplete, remove_empty_dir=False)
            batch["status"] = "paused"
            logger.info("Batch pausado | %s | %d partes conservadas", batch.get("folder_name", ""), kept)
        else:
            batch["status"] = "cancelled"
            logger.info("Batch cancelled | %s", batch.get("folder_name", ""))
            _cleanup_partial_files(batch.get("folder_path", ""), {p["file_name"] for p in batch["parts"]})
            from app.database.downloads import delete_download
            await delete_download(batch.get("folder_path", ""))
            await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "cancelled", "folder_name": batch.get("folder_name", "")})
    except Exception as e:
        batch["status"] = "error"; batch["error"] = str(e)
        logger.error("Batch failed | %s | %s", batch.get("folder_name", ""), e)
        from app.database.downloads import delete_download
        await delete_download(batch.get("folder_path", ""))
        await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "error", "error": str(e), "folder_name": batch["folder_name"], "parts": [{"message_id": p["message_id"], "file_name": p["file_name"], "status": p["status"], "error": p.get("error")} for p in batch["parts"]]})

    await asyncio.sleep(10)
    downloader.active_batches.pop(batch_id, None)


def _cleanup_partial_files(folder, target_files=None, remove_empty_dir=True):
    if not folder or not os.path.isdir(folder):
        return
    for f in os.listdir(folder):
        if target_files is not None and f not in target_files:
            continue
        fpath = os.path.join(folder, f)
        try:
            if os.path.isfile(fpath): os.remove(fpath)
            elif os.path.isdir(fpath): shutil.rmtree(fpath)
        except OSError:
            pass
    if remove_empty_dir and not os.listdir(folder):
        try: os.rmdir(folder)
        except OSError: pass


def _is_archived(file_path):
    fname = file_path.lower()
    return fname.endswith((".rar", ".zip", ".7z", ".tar.gz", ".tar.bz2", ".tar", ".tgz", ".tbz2")) or ".part" in fname or fname.endswith(".001")


def _flatten_single_subfolder(folder):
    items = os.listdir(folder)
    if len(items) != 1: return
    sub = os.path.join(folder, items[0])
    if not os.path.isdir(sub): return
    for f in os.listdir(sub):
        shutil.move(os.path.join(sub, f), os.path.join(folder, f))
    os.rmdir(sub)
