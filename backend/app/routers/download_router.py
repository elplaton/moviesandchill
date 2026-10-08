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
from app.services.layout import plan as plan_layout, finalize_episode
from app.services.extractor import extract_archive, find_first_archive
from app.services.storage import (format_size, format_speed, format_eta, get_free_space,
                                   suggest_folder_name, create_movie_folder)
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
    return await iniciar_descarga(req.message_id, req.channel_id, account)


async def iniciar_descarga(message_id: int, channel_id: int | None, account: dict) -> dict:
    """Arranca la descarga de un mensaje. Es el cuerpo de `POST /download`.

    Vive aparte del endpoint porque hay otro sitio que descarga sin que nadie
    pulse nada: la pregunta de «¿bajo los dos siguientes?» al acabar un
    episodio (`routers/siguiente_router.py`). Las dos cosas tienen que pasar
    por las mismas comprobaciones —cuota, duplicados, lo que ya esta en
    disco—, asi que son la misma funcion y no dos caminos parecidos.
    """
    from app.database.downloads import find_existing, usage_by_user, create_download
    dl = downloader
    for batch_id, batch in list(dl.active_batches.items()):
        if batch["status"] in ("downloading", "extracting"):
            for part in batch["parts"]:
                if part["message_id"] == message_id:
                    return {"error": f"Ese archivo ya lo está descargando {batch.get('owner', 'otra cuenta')}",
                            "batch_id": batch_id, "folder_name": batch["folder_name"], "already": True}

    base_name, folder_name, parts = await dl.find_related_parts(message_id, channel_id)
    if not parts:
        return {"error": "No se encontro el mensaje o no tiene archivo adjunto"}

    # El message_id solo es unico dentro de un canal: sin el prefijo, dos canales
    # distintos con el mismo id pisarian el batch del otro.
    batch_id = f"{channel_id or 0}_{message_id}"

    # Carpeta segun el catalogo: Serie/Temporada N/ para episodios, Titulo (Año)/ para peliculas.
    from app.database.media import get_media_item
    catalog = await get_media_item(channel_id, message_id)
    layout = plan_layout(config["extract_path"], parts[0]["file_name"], catalog, batch_id)
    folder_path = layout["work_dir"]
    folder_name = layout["folder_name"]
    total_size = sum(p.get("size", 0) for p in parts)

    # Una descarga por archivo para todo el mundo: si ya esta en disco (de
    # quien sea) se ofrece ver, no volver a bajar. Lo que no se puede repetir
    # es **el mismo archivo**, no la misma pelicula: antes se comparaba tambien
    # la carpeta de destino, asi que al tener el 1080p ya no se dejaba bajar el
    # 4K ("Ya esta descargado"). Cada version es una descarga distinta.
    existing = await find_existing(message_id, channel_id)
    if existing and existing["status"] == "done" and os.path.exists(existing["folder_path"]):
        return {"error": f"Ya está descargado por {existing.get('owner') or 'admin'}", "already": True,
                "owner": existing.get("owner"), "folder_name": existing["folder_name"], "local_path": existing["folder_path"]}
    os.makedirs(folder_path, exist_ok=True)

    # Cuota de disco de la cuenta: lo que ya ocupa (incluido lo que esta bajando) mas esto.
    quota = account.get("quota_bytes")
    if quota is not None and account.get("role") != "admin":
        used = await usage_by_user(account["id"])
        if used + total_size > quota:
            return {"error": f"No cabe en tu cuota: usas {format_size(used)} de {format_size(quota)} "
                             f"y esto ocupa {format_size(total_size)}", "quota_exceeded": True,
                    "used_bytes": used, "quota_bytes": quota}

    await create_download(account["id"], folder_name, folder_path, base_name or folder_name or "",
                          message_id, channel_id, total_size, "downloading")

    dl.active_batches[batch_id] = {
        "batch_id": batch_id, "base_name": base_name or folder_name or "",
        "owner": account["username"], "owner_id": account["id"],
        # La ficha del catalogo se guarda ahora y no al final: el aviso de
        # "descarga completada" dice "Suits 3x08" y no el nombre del fichero,
        # y buscarla otra vez al terminar seria una consulta de mas.
        "tmdb_id": (catalog or {}).get("tmdb_id"),
        "tmdb_type": (catalog or {}).get("tmdb_type"),
        "tmdb_title": (catalog or {}).get("tmdb_title"),
        "tmdb_poster": (catalog or {}).get("tmdb_poster"),
        "season": layout.get("season") or (catalog or {}).get("season"),
        "episode": layout.get("episode") or (catalog or {}).get("episode"),
        "kind": layout["kind"], "final_dir": layout["final_dir"], "final_stem": layout.get("final_stem"),
        "folder_name": folder_name, "folder_path": folder_path,
        "parts": [{"message_id": p["message_id"], "channel_id": p.get("channel_id", channel_id), "file_name": p["file_name"], "part_num": p.get("part_num", 0), "size": p.get("size", 0), "size_str": format_size(p.get("size", 0)), "downloaded": 0, "progress": 0, "status": "pending"} for p in parts],
        "total_parts": len(parts), "downloaded_parts": 0, "total_size": total_size, "total_size_str": format_size(total_size),
        "downloaded_size": 0, "progress": 0, "status": "downloading", "extracted_files": [], "error": None,
    }

    task = asyncio.create_task(_download_batch(batch_id))
    task.add_done_callback(lambda _, bid=batch_id: _batch_tasks.pop(bid, None))
    _batch_tasks[batch_id] = task

    return {"status": "started", "batch_id": batch_id, "folder_name": folder_name, "folder_path": folder_path, "total_parts": len(parts), "parts": [{"message_id": p["message_id"], "file_name": p["file_name"]} for p in parts]}


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
             "owner": (row or {}).get("owner") or account["username"], "owner_id": (row or {}).get("owner_id") or account["id"],
             "kind": saved.get("kind", "movie"), "final_dir": saved.get("final_dir", saved["folder_path"]), "final_stem": saved.get("final_stem")}
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
        velocidad = _velocidad_vigente(b)
        restante = max(0, b.get("total_size", 0) - b.get("downloaded_size", 0))
        batches.append({"batch_id": b["batch_id"], "folder_name": b["folder_name"], "status": b["status"], "total_parts": b["total_parts"], "downloaded_parts": b["downloaded_parts"], "total_size_str": b["total_size_str"],
                        # Lo descargado y la velocidad tambien aqui: el telefono
                        # suspende el WebSocket al apagar la pantalla y al
                        # volver esto es lo unico que tiene.
                        "downloaded_size": b.get("downloaded_size", 0),
                        "downloaded_size_str": format_size(b.get("downloaded_size", 0)),
                        "total_size": b.get("total_size", 0),
                        "speed": velocidad, "speed_str": format_speed(velocidad),
                        "eta_str": format_eta(restante / velocidad) if velocidad > 0 else "",
                        "progress": b.get("progress", 0), "error": b.get("error"), "owner": b.get("owner"), "parts": [{"message_id": p["message_id"], "file_name": p["file_name"], "status": p["status"], "progress": p["progress"], "size_str": p["size_str"]} for p in b["parts"]]})
    return {"active_batches": batches, "disk_free": format_size(get_free_space(config["extract_path"]))}


# Cuanto puede llevar la ultima medida sin que la velocidad deje de valer. Si
# no llegan bytes, el callback no se llama y el numero se queda congelado: a
# partir de aqui se da por que no hay velocidad en vez de mentir.
VELOCIDAD_CADUCA_S = 6


def _medir_velocidad(batch, ahora, descargado):
    """Velocidad de la descarga, suavizada.

    Se mide por bytes y no por el texto formateado, y se promedia con la medida
    anterior porque Telegram manda a rafagas: la velocidad instantanea salta
    entre 2 y 40 MB/s de un segundo a otro y un numero asi no se puede leer.

    El peso (0,8 a lo anterior) esta medido sobre rafagas simuladas con esa
    forma: con 0,5 el numero daba saltos de 7 MB/s entre segundos consecutivos,
    con 0,8 de 2 MB/s, y la media sigue siendo la de verdad.
    """
    medida = batch.get("_medida")
    if medida:
        transcurrido = ahora - medida[0]
        avance = descargado - medida[1]
        if transcurrido > 0 and avance >= 0:
            instantanea = avance / transcurrido
            anterior = batch.get("speed") or 0
            batch["speed"] = instantanea if not anterior else anterior * 0.8 + instantanea * 0.2
    batch["_medida"] = (ahora, descargado)


def _velocidad_vigente(batch):
    """La velocidad guardada, o 0 si la ultima medida es ya vieja."""
    medida = batch.get("_medida")
    if not medida or time.monotonic() - medida[0] > VELOCIDAD_CADUCA_S:
        return 0
    return batch.get("speed") or 0


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
        # (momento, bytes) de la ultima medida, para la velocidad. Aparte de
        # `_last_broadcast` porque ese empieza en 0 y el primer intervalo
        # saldria de horas.
        batch["_medida"] = None

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
                        pct = min(100, int(current / total * 100)) if total else 0
                        for p in batch["parts"]:
                            if p["message_id"] == msg_id:
                                p["downloaded"] = current; p["progress"] = pct; break
                        total_downloaded = sum(p["downloaded"] for p in batch["parts"])
                        batch["downloaded_size"] = total_downloaded
                        batch["progress"] = min(100, int(total_downloaded / batch["total_size"] * 100)) if batch["total_size"] else 0
                        now = time.monotonic()
                        if now - batch["_last_broadcast"] >= 1.0:
                            batch["_last_broadcast"] = now
                            _medir_velocidad(batch, now, total_downloaded)
                            restante = max(0, batch["total_size"] - total_downloaded)
                            velocidad = batch.get("speed") or 0
                            asyncio.ensure_future(broadcast_progress({
                                "type": "batch_progress", "batch_id": batch_id,
                                "part_message_id": msg_id, "part_idx": idx,
                                "part_progress": pct, "overall_progress": batch["progress"],
                                # Los bytes van tal cual ademas del texto: el
                                # cliente sacaba la velocidad deshaciendo la
                                # cadena ("1.2 GB" -> bytes) y a esa escala la
                                # resolucion es de 100 MB, asi que el numero
                                # salia a saltos o en blanco.
                                "downloaded_size": total_downloaded,
                                "total_size": batch["total_size"],
                                "downloaded_size_str": format_size(total_downloaded),
                                "total_size_str": batch["total_size_str"],
                                "speed": velocidad,
                                "speed_str": format_speed(velocidad),
                                "eta_str": format_eta(restante / velocidad) if velocidad > 0 else "",
                            }))
                    return cb

                try:
                    await dl.download_to_folder(part["message_id"], folder, progress_callback=make_progress_cb(part["message_id"]),
                                                channel_id=part.get("channel_id"))
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
        batch["speed"] = 0; batch["_medida"] = None
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

        from app.database.downloads import set_download_status, move_download, dir_size
        if batch.get("final_stem"):
            # De la carpeta temporal al sitio definitivo con su nombre:
            #   series    -> Serie/Temporada N/<N>x<EE>.<ext>
            #   peliculas -> Titulo (Año)/Titulo (Año) - 1080p.<ext>
            # En los dos casos **se posee el archivo**, no la carpeta. Cuando
            # una pelicula poseia su carpeta, las dos calidades compartian la
            # misma fila de ruta: borrar una borraba las dos y el dueño que
            # salia era el de cualquiera de ellas.
            finals = await asyncio.get_event_loop().run_in_executor(None, finalize_episode, folder, batch["final_dir"], batch["final_stem"])
            all_extracted = finals or all_extracted
            owned = finals[0] if finals else folder
            size = sum(os.path.getsize(f) for f in finals if os.path.isfile(f)) or dir_size(folder)
            await move_download(folder, owned, "done", size)
            batch["folder_path"] = owned
        else:
            await set_download_status(folder, "done", dir_size(folder))
        batch["status"] = "done"
        batch["extracted_files"] = all_extracted
        logger.info("Batch complete | %s | %d files", batch.get("folder_name", ""), len(all_extracted))
        # Hay un archivo nuevo en la biblioteca: el listado, las fichas y "ya
        # esta descargado" estan cacheados y tienen que enterarse ahora.
        from app.services import cache
        cache.cambio_en_disco()
        await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "done", "folder_name": batch["folder_name"], "folder_path": batch["folder_path"], "extracted_files": [os.path.basename(f) for f in all_extracted]})
        # Y se avisa a quien la pidio. Va al final, cuando el archivo ya esta
        # en su sitio: un aviso que llega antes de que se pueda reproducir es
        # peor que no avisar.
        await _avisar_completada(batch, all_extracted)

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
            _prune_work_dir(batch)
            from app.database.downloads import delete_download
            await delete_download(batch.get("folder_path", ""))
            from app.services import cache
            cache.cambio_en_disco()
            await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "cancelled", "folder_name": batch.get("folder_name", "")})
    except Exception as e:
        batch["status"] = "error"; batch["error"] = str(e)
        logger.error("Batch failed | %s | %s", batch.get("folder_name", ""), e)
        _prune_work_dir(batch)
        from app.database.downloads import delete_download
        await delete_download(batch.get("folder_path", ""))
        await broadcast_progress({"type": "batch_status", "batch_id": batch_id, "status": "error", "error": str(e), "folder_name": batch["folder_name"], "parts": [{"message_id": p["message_id"], "file_name": p["file_name"], "status": p["status"], "error": p.get("error")} for p in batch["parts"]]})

    await asyncio.sleep(10)
    downloader.active_batches.pop(batch_id, None)


async def _avisar_completada(batch: dict, archivos: list[str]) -> None:
    """Aviso al movil (o al escritorio) de que la descarga ha terminado.

    Lo pidio la cuenta que la lanzo y es a ella a quien se avisa; el resto ve
    el archivo aparecer en la biblioteca, que es lo suyo. Nada de lo que pase
    aqui puede marcar la descarga como fallida: ya ha terminado bien.
    """
    from app.services.aviso_descarga import avisar, titulo_de

    try:
        tamano = format_size(sum(os.path.getsize(f) for f in archivos if os.path.isfile(f)))
    except OSError:
        tamano = batch.get("total_size_str", "")
    await avisar(
        batch.get("owner_id"),
        titulo=titulo_de(batch, {"tmdb_title": batch.get("tmdb_title")}, archivos),
        tmdb_id=batch.get("tmdb_id"), tmdb_type=batch.get("tmdb_type"),
        season=batch.get("season"), episode=batch.get("episode"),
        tamano=tamano, poster=batch.get("tmdb_poster"), batch_id=batch.get("batch_id", ""),
    )


def _prune_work_dir(batch):
    """Sin lote no hay carpeta temporal que mantener; y si la carpeta de la
    pelicula o la temporada se queda vacia, tampoco."""
    from app.services.layout import prune_empty_dirs
    work = batch.get("folder_path", "")
    if work and os.path.basename(work).startswith(".dl_"):
        shutil.rmtree(work, ignore_errors=True)
        # Desde la carpeta temporal (ya borrada) hacia arriba: pelicula o temporada y serie.
        prune_empty_dirs(work, config.get("extract_path", "/app/movies"))


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
