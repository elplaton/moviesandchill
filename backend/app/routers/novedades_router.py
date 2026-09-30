"""Registro de lo que va llegando en vivo a los canales.

La escucha de mensajes nuevos solo se veia en los logs del contenedor, que en
Docker hay que ir a buscar. Aqui queda lo que ha llegado, si se ha indexado y,
si no, por que: sin el motivo, un mensaje descartado no dejaba ni rastro y no
habia forma de saber por que una pelicula no aparecia en la Home.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import get_current_admin

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api/admin", tags=["novedades"])


@router.get("/novedades")
async def novedades(
    user: Annotated[str, Depends(get_current_admin)],
    limit: int = Query(100, ge=1, le=500),
    only_indexed: bool = False,
):
    from app.database.connection import get_novedades

    rows = await get_novedades(limit=limit, only_indexed=only_indexed)
    items = [
        {
            "id": r["id"],
            "channel_id": r["channel_id"],
            "channel": r["channel_name"] or "",
            "message_id": r["message_id"],
            "file_name": r["file_name"] or "",
            "media_type": r["media_type"],
            "season": r["season"],
            "episode": r["episode"],
            "title": r["tmdb_title"] or r["clean_title"] or "",
            "poster": r["poster"],
            "year": r["year"],
            "indexed": r["indexed"],
            "reason": r["reason"] or "",
            "at": str(r["created_at"]),
        }
        for r in rows
    ]
    return {
        "items": items,
        "total": len(items),
        "indexed": sum(1 for i in items if i["indexed"]),
    }


@router.get("/novedades/estado")
async def estado(user: Annotated[str, Depends(get_current_admin)]):
    """Si la escucha esta viva y sobre cuantos canales. Un canal que Telethon
    no consigue resolver se sigue escuchando (el filtro va por la lista de
    canales activos), pero no se puede escanear hacia atras."""
    from app.routers.download import downloader

    if downloader is None:
        return {"listening": False, "channels": 0, "unresolved": []}

    client = downloader.client
    listening = bool(client) and client.is_connected() and await client.is_user_authorized()
    activos = list(downloader.channel_ids or [])
    sin_resolver = [ch["name"] for ch in activos if ch["id"] not in downloader.channels]

    return {
        "listening": listening,
        "channels": len(activos),
        "resolved": len(downloader.channels),
        "unresolved": sin_resolver,
    }
