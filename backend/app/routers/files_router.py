import asyncio
import logging
import os
import re
import shutil
from typing import Annotated

import aiofiles

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.services.storage import format_size

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["files"])

_stream_semaphore: asyncio.Semaphore | None = None


def init_files_semaphore(max_streams: int = 3):
    global _stream_semaphore
    _stream_semaphore = asyncio.Semaphore(max_streams)


class DeleteRequest(BaseModel):
    path: str


@router.get("/files")
async def list_files(subpath: str = "", user: Annotated[str, Depends(get_current_user)] = None):
    """Biblioteca en disco.

    Estructura nueva:  Serie/Temporada N/<N>x<EE>.mp4  y  Titulo (Año)/Titulo (Año).mp4
    Estructura vieja:  "Serie S1/<episodios>" (varias carpetas por temporada) y
    "Pelicula/<video>". Las dos se entienden.
    """
    from app.routers.download import config
    from app.services.tmdb import clean_title
    from app.services.layout import WORK_PREFIX

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
    SEASON_SUFFIX_RE = re.compile(r"^(.*?)\s*[sS](\d{1,2})\s*$")
    SEASON_DIR_RE = re.compile(r"^(?:temporada|season)\s*(\d{1,2})$", re.IGNORECASE)
    EP_RE = re.compile(r"(\d{1,2})x(\d{2,3})|[sS](\d{1,2})[eE](\d{1,3})")

    def video(path):
        return os.path.splitext(path)[1].lower() in VIDEO_EXTS and os.path.isfile(path)

    def episode_entry(vf_path, season=None):
        name = os.path.basename(vf_path)
        m = EP_RE.search(name)
        ep = {"name": name, "size": format_size(os.path.getsize(vf_path)), "path": vf_path}
        if m:
            ep["season"] = int(m.group(1) or m.group(3)) if season is None else season
            ep["episode"] = int(m.group(2) or m.group(4))
        elif season is not None:
            ep["season"] = season
        return ep

    entries = [e for e in sorted(os.listdir(target)) if not e.startswith(".")]
    dirs = [e for e in entries if os.path.isdir(os.path.join(target, e))]
    items = []
    legacy_groups: dict[str, list[str]] = {}

    for d in dirs:
        full = os.path.join(target, d)
        subdirs = [x for x in sorted(os.listdir(full)) if os.path.isdir(os.path.join(full, x)) and not x.startswith(WORK_PREFIX)]
        direct = [x for x in sorted(os.listdir(full)) if video(os.path.join(full, x))]
        seasons = [(int(SEASON_DIR_RE.match(x).group(1)), x) for x in subdirs if SEASON_DIR_RE.match(x)]

        if seasons:
            # Estructura nueva: Serie/Temporada N/
            episodes = []
            for n, sd in sorted(seasons):
                sd_path = os.path.join(full, sd)
                for vf in sorted(os.listdir(sd_path), key=lambda v: (len(v), v)):
                    vf_path = os.path.join(sd_path, vf)
                    if video(vf_path):
                        episodes.append(episode_entry(vf_path, n))
            for vf in direct:
                episodes.append(episode_entry(os.path.join(full, vf)))
            if episodes:
                items.append({"name": d, "is_dir": True, "size": format_size(_dir_size(full)), "path": full,
                              "is_series": True, "clean_name": clean_title(d), "episodes": episodes})
            continue

        m = SEASON_SUFFIX_RE.match(d)
        if m:
            legacy_groups.setdefault(m.group(1).strip().lower(), []).append(d)
            continue

        if len(direct) > 1 or (len(direct) == 1 and EP_RE.search(direct[0])):
            episodes = [episode_entry(os.path.join(full, vf)) for vf in direct]
            items.append({"name": d, "is_dir": True, "size": format_size(_dir_size(full)), "path": full,
                          "is_series": True, "clean_name": clean_title(d), "episodes": episodes})
        elif len(direct) == 1:
            vf_path = os.path.join(full, direct[0])
            items.append({"name": direct[0], "is_dir": False, "size": format_size(os.path.getsize(vf_path)), "path": vf_path,
                          "is_series": False, "clean_name": clean_title(d), "folder": full})

    # Estructura vieja: "Serie S1", "Serie S2"... se juntan en una sola serie.
    for key, season_dirs in legacy_groups.items():
        episodes = []
        for sd in sorted(season_dirs):
            sd_path = os.path.join(target, sd)
            for vf in sorted(os.listdir(sd_path)):
                vf_path = os.path.join(sd_path, vf)
                if video(vf_path):
                    episodes.append(episode_entry(vf_path))
        if episodes:
            items.append({"name": season_dirs[0], "is_dir": True, "size": "", "path": os.path.join(target, season_dirs[0]),
                          "is_series": True, "clean_name": clean_title(key), "episodes": episodes})

    for entry in entries:
        full = os.path.join(target, entry)
        if os.path.isdir(full) or not video(full):
            continue
        items.append({"name": entry, "is_dir": False, "size": format_size(os.path.getsize(full)), "path": full,
                      "is_series": False, "clean_name": clean_title(entry)})

    # Dueño de cada elemento y de cada episodio, y si esta cuenta puede borrarlo.
    from app.database.downloads import owners_by_path
    from app.database.users import get_user_by_username
    owners = await owners_by_path()
    me = await get_user_by_username(user) if user else None
    is_admin = bool(me and me.get("role") == "admin")

    def tag(obj, path):
        row = _owner_row(owners, path)
        obj["owner"] = row["owner"] if row else "admin"
        obj["can_delete"] = is_admin or bool(row and me and row["owner_id"] == me["id"])

    for it in items:
        tag(it, it.get("folder") or it["path"])
        for ep in it.get("episodes") or []:
            tag(ep, ep["path"])
        if it.get("episodes"):
            # Una serie con episodios de varias cuentas: la carpeta solo la borra un admin.
            owners_set = {ep["owner"] for ep in it["episodes"]}
            it["owner"] = owners_set.pop() if len(owners_set) == 1 else "varios"
            it["can_delete"] = is_admin
    return {"files": items, "path": target, "parent": subpath}


def _owner_row(owners: dict, path: str):
    best = None
    for folder, row in owners.items():
        if path == folder or path.startswith(folder + os.sep):
            if best is None or len(folder) > len(best[0]):
                best = (folder, row)
    return best[1] if best else None


@router.delete("/files")
async def delete_file(req: DeleteRequest, user: Annotated[str, Depends(get_current_user)] = None):
    from app.routers.download import config
    from app.database.downloads import owner_of_path, delete_download, set_download_status, dir_size
    from app.database.users import get_user_by_username
    base_dir = os.path.realpath(config["extract_path"])
    target = os.path.realpath(req.path)
    if not target.startswith(base_dir + os.sep) and target != base_dir:
        return {"error": "Ruta no permitida"}
    if not os.path.exists(target):
        return {"error": "El archivo o carpeta no existe"}

    # Solo borra quien lo descargo (o un admin). Lo que no tiene fila es del admin.
    me = await get_user_by_username(user) if user else None
    row = await owner_of_path(target)
    is_admin = bool(me and me.get("role") == "admin")
    if not is_admin and not (row and me and row["owner_id"] == me["id"]):
        owner = (row or {}).get("owner") or "admin"
        return {"error": f"Solo {owner} puede borrarlo"}
    if row and row["status"] in ("downloading", "paused"):
        return {"error": "Esta descarga sigue en curso: cancélala antes de borrarla"}

    try:
        if os.path.isdir(target):
            shutil.rmtree(target)
        else:
            os.remove(target)
            # Si era el ultimo archivo, sobran su carpeta (temporada) y la de
            # la serie si tambien queda vacia.
            from app.services.layout import prune_empty_dirs
            prune_empty_dirs(target, base_dir)
        if row:
            if os.path.exists(row["folder_path"]):
                await set_download_status(row["folder_path"], row["status"], dir_size(row["folder_path"]))
            else:
                await delete_download(row["folder_path"])
        logger.info("Borrado desde la app por %s: %s", user, os.path.relpath(target, base_dir))
        return {"deleted": req.path}
    except OSError as e:
        return {"error": str(e)}


@router.get("/stream")
async def stream(request: Request, path: str = "", user: Annotated[str, Depends(get_current_user)] = None):
    from app.routers.download import config
    base = os.path.realpath(config["extract_path"])
    target = os.path.realpath(os.path.join(base, path))
    if not target.startswith(base + os.sep) and target != base:
        raise HTTPException(status_code=403, detail="Ruta no permitida")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    file_size = os.path.getsize(target)
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""
    mime_map = {"mkv": "video/x-matroska", "mp4": "video/mp4", "avi": "video/x-msvideo", "ts": "video/mp2t", "mov": "video/quicktime", "webm": "video/webm", "m4v": "video/mp4", "flv": "video/x-flv", "wmv": "video/x-ms-wmv"}
    content_type = mime_map.get(ext, "application/octet-stream")

    range_header = request.headers.get("Range")
    start, end = 0, file_size - 1
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

    if _stream_semaphore is None:
        init_files_semaphore()

    # El semaforo se adquiere aqui y se suelta en el finally del generador.
    # Con "async with" envolviendo el return se liberaba al construir la
    # respuesta, antes de enviar un solo byte, asi que no limitaba nada.
    await _stream_semaphore.acquire()
    released = False
    try:
        CHUNK = 1024 * 1024
        content_length = end - start + 1

        async def chunked_stream():
            try:
                # Lectura asincrona: con open()/read() sincronos cada chunk de 1MB
                # bloqueaba el event loop y frenaba al resto de peticiones.
                async with aiofiles.open(target, "rb") as f:
                    await f.seek(start)
                    remaining = content_length
                    while remaining > 0:
                        chunk = await f.read(min(CHUNK, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk
            finally:
                _stream_semaphore.release()

        headers = {"Content-Disposition": "inline", "Accept-Ranges": "bytes", "Content-Length": str(content_length)}
        if range_header:
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
            response = StreamingResponse(chunked_stream(), status_code=206, media_type=content_type, headers=headers)
        else:
            response = StreamingResponse(chunked_stream(), media_type=content_type, headers=headers)
        released = True  # a partir de aqui lo libera el generador
        return response
    finally:
        if not released:
            _stream_semaphore.release()


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
