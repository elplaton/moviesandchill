"""Donde empiezan los creditos de un enlace (ver services/creditos.py)."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_admin, get_current_user

router = APIRouter(prefix="/api", tags=["creditos"])


@router.get("/creditos")
async def creditos(path: str, user: Annotated[str, Depends(get_current_user)],
                   duracion: float | None = None, tmdb_id: int | None = None,
                   media_type: str | None = None, season: int | None = None):
    """`{inicio, origen, fuente, postcreditos}` para el reproductor.

    `duracion` es la del video que se esta viendo (el reproductor la sabe):
    con ella se predice el inicio a partir de otro enlace del mismo titulo.
    `tmdb_id`/`media_type`/`season` solo hacen falta para lo descargado; lo
    de Telegram ya sabe de que titulo es."""
    from app.routers.download import config
    from app.services.creditos import consultar
    from app.services.proceso_creditos import al_reproducir
    from app.tasks import spawn

    # Apagado desde el panel: como si no se supiera, que es lo que hace al
    # reproductor volver a su regla fija. Y sin lanzar nada que gaste Telegram.
    if not (config or {}).get("creditos_activos", True):
        return {"inicio": None, "origen": None, "fuente": None, "postcreditos": False}

    r = await consultar(path, duracion, tmdb_id=tmdb_id, tmdb_type=media_type, temporada=season)
    # Abrir algo es lo que pone en marcha averiguar sus creditos: sin dato, el
    # proceso de su titulo o temporada; con dato previsto, comprobarlo. En
    # segundo plano y en una cola de uno en uno: para cuando se llegue al
    # final ya suele estar (un episodio tarda ~10 s en medirse).
    spawn(al_reproducir(path, r, tmdb_id=tmdb_id, tmdb_type=media_type, temporada=season),
          "creditos-al-reproducir")
    return r


class Manual(BaseModel):
    path: str
    duracion: float
    # Segundo en que empiezan; None con `sin_creditos` = no tiene.
    inicio: float | None = None
    sin_creditos: bool = False
    postcreditos: bool = False
    tmdb_id: int | None = None
    media_type: str | None = None
    season: int | None = None


@router.post("/admin/creditos")
async def creditos_a_mano(req: Manual, user: Annotated[str, Depends(get_current_admin)]):
    """Poner a mano donde empiezan los creditos de un enlace. Manda sobre los
    capitulos y el analisis, y pasa a ser la referencia de su titulo."""
    from app.services.creditos import guardar_medicion

    if req.duracion <= 0:
        raise HTTPException(status_code=400, detail="La duracion tiene que ser positiva")
    if req.sin_creditos:
        inicio, estado = None, "sin_creditos"
    else:
        if req.inicio is None or not 0 < req.inicio < req.duracion:
            raise HTTPException(status_code=400, detail="El inicio tiene que caer dentro del video")
        inicio, estado = req.inicio, "medido"
    await guardar_medicion(req.path, inicio=inicio, duracion=req.duracion, fuente="manual", estado=estado,
                           postcreditos=req.postcreditos, tmdb_id=req.tmdb_id,
                           tmdb_type=req.media_type, temporada=req.season)
    return {"ok": True}


class Pasada(BaseModel):
    accion: str     # "lanzar" | "pausar"


@router.get("/admin/creditos/pasada")
async def ver_pasada(user: Annotated[str, Depends(get_current_admin)]):
    """Como va la pasada completa de creditos (services/pasada_creditos.py)."""
    from app.services import pasada_creditos
    return await pasada_creditos.resumen()


@router.post("/admin/creditos/pasada")
async def mandar_pasada(req: Pasada, user: Annotated[str, Depends(get_current_admin)]):
    """Lanzar o pausar la pasada completa. Lanzada, sigue sola tras un
    reinicio; pausada, termina lo que tenia a medias y para."""
    from app.services import pasada_creditos
    if req.accion == "lanzar":
        return await pasada_creditos.lanzar()
    if req.accion == "pausar":
        return await pasada_creditos.pausar()
    raise HTTPException(status_code=400, detail="Acción desconocida")


@router.get("/admin/creditos/resumen")
async def creditos_resumen(user: Annotated[str, Depends(get_current_admin)]):
    """Cuantos titulos y enlaces tienen el dato, y de donde ha salido."""
    from app.database.creditos import resumen

    return await resumen()
