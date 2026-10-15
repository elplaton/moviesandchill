"""Pistas de audio y subtitulos de un archivo ya descargado."""
import asyncio
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
    mas los .vtt que haya sueltos al lado.

    Cacheado un dia, porque lo contesta `ffprobe`: un proceso nuevo cada vez
    que alguien abre un reproductor, para decir algo que no cambia mientras el
    archivo no cambie. La clave lleva el tamaño y la fecha de modificacion,
    asi que si se reconvierte el archivo (la revision de biblioteca lo hace)
    la entrada vieja ya no se encuentra y se vuelve a mirar.
    """
    from app.services import cache, reproduccion
    from app.services.tracks import leer_pistas, mejor_audio
    from app.services.subs import subtitulos_externos

    if reproduccion.es_ruta(path):
        # Ver sin descargar: las pistas ya se leyeron al comprobar el archivo.
        ids = reproduccion.leer_ruta(path)
        if not ids:
            raise HTTPException(status_code=404, detail="Ruta de Telegram no valida")
        r = await reproduccion.comprobar(*ids)
        if not r.get("pistas"):
            raise HTTPException(status_code=409, detail=r.get("motivo") or "No se pueden leer las pistas")
        return r["pistas"]

    target = _ruta_segura(path)
    st = os.stat(target)

    async def calcular():
        datos = await asyncio.to_thread(leer_pistas, target)
        datos["path"] = path
        datos["default_audio"] = mejor_audio(datos["audio"]) if datos["audio"] else None
        datos["external_subtitles"] = subtitulos_externos(target, path)
        return datos

    # No es de nadie: son los datos del archivo, iguales para todas las cuentas.
    return await cache.recordar("pistas", [path, st.st_size, int(st.st_mtime)], calcular)


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
    from app.services import reproduccion

    if reproduccion.es_ruta(path):
        if not reproduccion.leer_ruta(path):
            raise HTTPException(status_code=404, detail="Ruta de Telegram no valida")
    else:
        _ruta_segura(path)   # 403/404 si no existe o se sale de la biblioteca
    return {
        "token": create_stream_token(user, path, get_jwt_secret()),
        "expires_in": STREAM_EXPIRE_HOURS * 3600,
    }


@router.get("/reproducir")
async def reproducir(channel_id: int, message_id: int, user: Annotated[str, Depends(get_current_user)],
                     forzar: bool = False):
    """Si un archivo del catalogo se puede ver sin descargarlo.

    Contesta `{"modo": "ver", "path": "tg:<canal>:<msg>", "pistas": {...}}`
    —y el reproductor abre esa `path` como cualquier otra— o `{"modo":
    "descargar", "motivo": "..."}`. La primera vez lee unos KB de Telegram y
    pasa ffprobe (unos segundos); despues sale de la tabla `reproduccion`.
    """
    from app.services import reproduccion

    r = await reproduccion.comprobar(channel_id, message_id, forzar=forzar)
    logger.info("Ver sin descargar %s:%s -> %s", channel_id, message_id, reproduccion.resumen_para_log(r))
    return r
