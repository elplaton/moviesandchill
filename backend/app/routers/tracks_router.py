"""Pistas de audio y subtitulos de un archivo ya descargado."""
import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_user, get_stream_user

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["tracks"])


def _ruta_segura(path: str) -> str:
    """Misma guarda que /api/stream: nada fuera de la carpeta de la biblioteca."""
    from app.routers.download import config

    base = os.path.realpath(config["extract_path"])
    target = os.path.realpath(os.path.join(base, path))
    if not target.startswith(base + os.sep) and target != base:
        raise HTTPException(status_code=403, detail="Ruta no permitida")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return target


@router.get("/media/tracks")
async def media_tracks(path: str, user: Annotated[str, Depends(get_current_user)]):
    """Que trae el archivo: video, pistas de audio con su idioma y subtitulos,
    mas los .vtt que haya sueltos al lado."""
    from app.services.tracks import leer_pistas, mejor_audio
    from app.services.subs import subtitulos_externos

    target = _ruta_segura(path)
    datos = leer_pistas(target)
    datos["path"] = path
    datos["default_audio"] = mejor_audio(datos["audio"]) if datos["audio"] else None
    datos["external_subtitles"] = subtitulos_externos(target, path)
    return datos


@router.get("/subtitle")
async def subtitle(path: str, user: Annotated[str, Depends(get_stream_user)]):
    """Sirve un .vtt suelto. Va aparte de /api/stream porque el navegador lo
    pide con `<track>`, que no entiende de Range ni de respuestas parciales."""
    from fastapi.responses import FileResponse
    from app.services.subs import es_vtt, parece_vtt

    if not es_vtt(path):
        raise HTTPException(status_code=400, detail="Solo se sirven subtitulos .vtt")
    target = _ruta_segura(path)
    if not parece_vtt(target):
        raise HTTPException(status_code=422, detail="El archivo no es WebVTT")
    return FileResponse(target, media_type="text/vtt; charset=utf-8",
                        headers={"Cache-Control": "public, max-age=86400"})


@router.get("/stream/ticket")
async def stream_ticket(path: str, user: Annotated[str, Depends(get_current_user)]):
    """Entrada de reproduccion para un archivo concreto.

    La pide el reproductor al abrir y la usa en la URL del `<video>` en vez
    del token de acceso, que caduca en una hora y cortaba las peliculas largas
    por la mitad. Tambien es lo que hace posible AirPlay: la URL la consume el
    Apple TV, que no puede renovar nada.
    """
    from app.auth.service import create_stream_token, STREAM_EXPIRE_HOURS
    from app.config import get_jwt_secret

    _ruta_segura(path)   # 403/404 si no existe o se sale de la biblioteca
    return {
        "token": create_stream_token(user, path, get_jwt_secret()),
        "expires_in": STREAM_EXPIRE_HOURS * 3600,
    }
