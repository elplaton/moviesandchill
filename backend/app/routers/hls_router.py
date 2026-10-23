"""HLS al vuelo para ver sin descargar lo que el aparato no abre o no oye
(ver services/hls.py).

Tres URLs, todas con la misma entrada de reproduccion que `/api/stream`
(`path=tg:...&token=...`): la lista, el init y cada trozo. La lista escribe esa
consulta detras de cada URI porque el reproductor no la añade solo.
"""
import gzip
import logging
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response

from app.auth.dependencies import get_stream_user

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api/hls", tags=["hls"])


async def _sesion(path: str):
    from app.services import hls

    try:
        return await hls.sesion(path)
    except hls.SinHls as e:
        raise HTTPException(status_code=409, detail=f"No se puede adaptar al vuelo: {e}")


@router.get("/index.m3u8")
async def lista(request: Request, user: Annotated[str, Depends(get_stream_user)], path: str = "",
                token: Annotated[str | None, Query()] = None):
    from app.services import hls

    s = await _sesion(path)
    consulta = urlencode({"path": path, "token": token or ""})
    cuerpo = hls.lista(s, consulta).encode()
    cabeceras = {"Cache-Control": "no-store"}
    # Comprimida: un trozo por fotograma clave y la entrada en cada linea dan
    # listas de varios MB (un MP4 con un fotograma clave cada medio segundo son
    # 8.000 trozos), y la entrada repetida se comprime casi entera.
    if "gzip" in request.headers.get("accept-encoding", ""):
        cuerpo = gzip.compress(cuerpo, 6)
        cabeceras["Content-Encoding"] = "gzip"
        cabeceras["Vary"] = "Accept-Encoding"
    return Response(cuerpo, media_type="application/vnd.apple.mpegurl", headers=cabeceras)


@router.get("/init.mp4")
async def init(user: Annotated[str, Depends(get_stream_user)], path: str = ""):
    from app.services import hls

    s = await _sesion(path)
    try:
        ruta = await hls.init(s)
    except hls.SinHls as e:
        raise HTTPException(status_code=504, detail=str(e))
    return FileResponse(ruta, media_type="video/mp4")


@router.get("/{n}.m4s")
async def trozo(n: int, user: Annotated[str, Depends(get_stream_user)], path: str = ""):
    from app.services import hls

    s = await _sesion(path)
    try:
        ruta = await hls.trozo(s, n)
    except hls.SinHls as e:
        logger.warning("HLS al vuelo %s: trozo %d: %s", path, n, e)
        raise HTTPException(status_code=504, detail=str(e))
    return FileResponse(ruta, media_type="video/iso.segment")
