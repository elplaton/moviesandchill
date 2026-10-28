"""Admin -> Revision: lo mal indexado, agrupado, para verlo y corregirlo
(ver services/revision.py). Solo admin."""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_admin

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["revision"])


@router.get("/admin/revision/resumen")
async def revision_resumen(user: Annotated[str, Depends(get_current_admin)]):
    from app.services import revision

    return await revision.resumen()


@router.get("/admin/revision")
async def revision_listar(user: Annotated[str, Depends(get_current_admin)], motivo: str = "sin_ficha",
                          channel_id: int | None = None, q: str = "", offset: int = 0, limit: int = 30):
    from app.services import revision

    return await revision.listar(motivo, channel_id, q, max(offset, 0), min(max(limit, 1), 100))


class Asignar(BaseModel):
    clave: str
    tmdb_id: int
    media_type: str     # "movie" | "series" (o "tv")


@router.post("/admin/revision/asignar")
async def revision_asignar(req: Asignar, user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.peticiones_router import _api_key
    from app.services import revision

    api_key = _api_key()
    if not api_key:
        raise HTTPException(status_code=409, detail="TMDB está desactivado")
    try:
        n = await revision.asignar(req.clave, req.tmdb_id, req.media_type, api_key)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not n:
        raise HTTPException(status_code=404, detail="Ese grupo ya no está en la lista: vuelve a cargarla")
    return {"ok": True, "archivos": n}


class Clave(BaseModel):
    clave: str


@router.post("/admin/revision/ignorar")
async def revision_ignorar(req: Clave, user: Annotated[str, Depends(get_current_admin)]):
    from app.services import revision

    n = await revision.ignorar(req.clave)
    if not n:
        raise HTTPException(status_code=404, detail="Ese grupo ya no está en la lista: vuelve a cargarla")
    return {"ok": True, "archivos": n}
