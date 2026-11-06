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
                          channel_id: int | None = None, q: str = "", offset: int = 0, limit: int = 30,
                          sugeridas: bool = False):
    from app.services import revision

    return await revision.listar(motivo, channel_id, q, max(offset, 0), min(max(limit, 1), 100), sugeridas)


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


# --- Revision automatica (services/revision_auto.py) ---------------------------

@router.get("/admin/revision/auto")
async def revision_auto_lista(user: Annotated[str, Depends(get_current_admin)], offset: int = 0, limit: int = 30):
    """Lo que se ha corregido solo, lo mas nuevo primero, con su estado."""
    from app.services import revision_auto

    return {**await revision_auto.aplicadas(max(offset, 0), min(max(limit, 1), 100)),
            "estado": await revision_auto.estado()}


@router.post("/admin/revision/auto/lanzar")
async def revision_auto_lanzar(user: Annotated[str, Depends(get_current_admin)]):
    """«Revisar ahora»: mira los grupos que aun no se han mirado."""
    from app.routers.peticiones_router import _api_key
    from app.services import revision_auto
    from app.tasks import spawn

    api_key = _api_key()
    if not api_key:
        raise HTTPException(status_code=409, detail="TMDB está desactivado")
    if not revision_auto._cerrojo.locked():
        spawn(revision_auto.pasada(api_key), "revision_auto_manual")
    return {"ok": True}


class Id(BaseModel):
    id: int


@router.post("/admin/revision/auto/deshacer")
async def revision_auto_deshacer(req: Id, user: Annotated[str, Depends(get_current_admin)]):
    from app.services import revision_auto

    n = await revision_auto.deshacer(req.id)
    if not n:
        raise HTTPException(status_code=404, detail="Eso ya no está aplicado")
    return {"ok": True, "archivos": n}


@router.post("/admin/revision/sugerencia/aceptar")
async def revision_sugerencia_aceptar(req: Clave, user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.peticiones_router import _api_key
    from app.services import revision_auto

    api_key = _api_key()
    if not api_key:
        raise HTTPException(status_code=409, detail="TMDB está desactivado")
    try:
        n = await revision_auto.aceptar(req.clave, api_key)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not n:
        raise HTTPException(status_code=404, detail="Esa sugerencia ya no está: vuelve a cargar la lista")
    return {"ok": True, "archivos": n}


@router.post("/admin/revision/sugerencia/descartar")
async def revision_sugerencia_descartar(req: Clave, user: Annotated[str, Depends(get_current_admin)]):
    from app.services import revision_auto

    if not await revision_auto.descartar(req.clave):
        raise HTTPException(status_code=404, detail="Esa sugerencia ya no está")
    return {"ok": True}
