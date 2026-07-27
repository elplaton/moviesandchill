import asyncio
import logging
import os
import re
import shutil
from typing import Annotated

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
    from app.routers.download import config
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
            key = m.group(1).strip().lower()
            if key not in season_groups:
                season_groups[key] = []
            season_groups[key].append(d)
        else:
            standalone_dirs.append(d)

    items = []

    for key, season_dirs in season_groups.items():
        all_episodes = []
        for sd in sorted(season_dirs):
            sd_path = os.path.join(target, sd)
            for vf in sorted(os.listdir(sd_path)):
                vf_path = os.path.join(sd_path, vf)
                if os.path.splitext(vf)[1].lower() in VIDEO_EXTS and os.path.isfile(vf_path):
                    all_episodes.append({"name": vf, "size": format_size(os.path.getsize(vf_path)), "path": vf_path})
        if all_episodes:
            items.append({"name": season_dirs[0], "is_dir": True, "size": "", "path": os.path.join(target, season_dirs[0]), "is_series": True, "clean_name": clean_title(key), "episodes": all_episodes})

    for d in standalone_dirs:
        full = os.path.join(target, d)
        sub_files = sorted(os.listdir(full))
        videos = [f for f in sub_files if os.path.splitext(f)[1].lower() in VIDEO_EXTS and os.path.isfile(os.path.join(full, f))]
        if len(videos) > 1:
            episodes = [{"name": vf, "size": format_size(os.path.getsize(os.path.join(full, vf))), "path": os.path.join(full, vf)} for vf in videos]
            items.append({"name": d, "is_dir": True, "size": format_size(_dir_size(full)), "path": full, "is_series": True, "clean_name": clean_title(d), "episodes": episodes})
        elif len(videos) == 1:
            vf = videos[0]; vf_path = os.path.join(full, vf)
            items.append({"name": vf, "is_dir": False, "size": format_size(os.path.getsize(vf_path)), "path": vf_path, "is_series": False, "clean_name": clean_title(vf)})

    for entry in sorted(os.listdir(target)):
        full = os.path.join(target, entry)
        if os.path.isdir(full):
            continue
        items.append({"name": entry, "is_dir": False, "size": format_size(os.path.getsize(full)), "path": full, "is_series": False, "clean_name": clean_title(entry)})

    return {"files": items, "path": target, "parent": subpath}


@router.delete("/files")
async def delete_file(req: DeleteRequest, user: Annotated[str, Depends(get_current_user)] = None):
    from app.routers.download import config
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

        headers = {"Content-Disposition": "inline", "Accept-Ranges": "bytes", "Content-Length": str(content_length)}
        if range_header:
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
            return StreamingResponse(chunked_stream(), status_code=206, media_type=content_type, headers=headers)
        return StreamingResponse(chunked_stream(), media_type=content_type, headers=headers)


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
