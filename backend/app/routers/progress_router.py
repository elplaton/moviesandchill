"""Por donde va cada cuenta en cada video, y la fila "Continuar viendo".

Vive en el servidor y no en el localStorage de cada aparato para que el punto
sea el mismo en la web, el movil y la tele: empezar una pelicula en el salon y
seguirla en el movil es justo lo que se espera de esto.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.services.continuar import (FIN, MIN_SEGUNDOS, continuar_viendo, grupo_de,
                                    ruta_relativa, temporada_y_episodio)

router = APIRouter(prefix="/api", tags=["progress"])


class ProgressRequest(BaseModel):
    path: str
    position: float
    duration: float = 0
    title: str | None = None
    subtitle: str | None = None
    poster: str | None = None
    backdrop: str | None = None
    tmdb_id: int | None = None
    media_type: str | None = None


def _tipo_tmdb(media_type: str | None) -> str | None:
    """Los clientes hablan de 'series' y TMDB de 'tv'."""
    if media_type is None:
        return None
    return "tv" if media_type in ("series", "tv") else "movie"


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


async def _seguir_si_toca(uid: int, req: ProgressRequest, episodio: int | None) -> None:
    """Ver un episodio es seguir la serie.

    Es la mitad del seguimiento: lo otro es el boton de la ficha. Asi no hay
    que acordarse de marcar nada para que avisen del capitulo siguiente. Solo
    cuenta si de verdad se ha empezado a ver (treinta segundos) y nunca pisa lo
    que la cuenta haya decidido: `auto_follow` respeta la fila que ya exista,
    incluida la de una serie que se dejo de seguir a proposito.
    """
    from app.database.follows import auto_follow

    if not req.tmdb_id or episodio is None:
        return
    if _tipo_tmdb(req.media_type) != "tv":
        return
    if req.position < MIN_SEGUNDOS:
        return
    try:
        await auto_follow(uid, req.tmdb_id)
    except Exception:
        # Guardar el progreso es lo importante; el seguimiento es un extra.
        pass


async def _guardar(uid: int, req: ProgressRequest) -> bool:
    from app.database.progress import save_progress

    rel = ruta_relativa(req.path)
    if rel is None:
        return False
    temporada, episodio = temporada_y_episodio(rel)
    await save_progress(
        uid, rel, grupo_de(rel), req.position, req.duration,
        title=req.title, subtitle=req.subtitle, poster=req.poster, backdrop=req.backdrop,
        tmdb_id=req.tmdb_id, tmdb_type=_tipo_tmdb(req.media_type),
        season=temporada, episode=episodio,
    )
    await _seguir_si_toca(uid, req, episodio)
    return True


@router.get("/progress")
async def get_progress_list(user: Annotated[str, Depends(get_current_user)], limit: int = 20):
    """La fila "Continuar viendo": una tarjeta por titulo.

    Lo que la cuenta ha marcado como visto no sale: decir "ya me la he visto" y
    seguir viendola en la portada es contradictorio. Y los episodios marcados a
    mano no se ofrecen como siguiente, aunque esten en disco sin reproducir.
    """
    import asyncio

    from app.database.progress import list_progress
    from app.database.watched import episodios_vistos_todos, titulos_vistos

    uid = await _user_id(user)
    if uid is None:
        return {"items": []}
    filas, vistos, marcados = await asyncio.gather(
        list_progress(uid), titulos_vistos(uid), episodios_vistos_todos(uid))
    filas = [f for f in filas
             if (f.get("tmdb_id"), f.get("tmdb_type")) not in vistos]
    return {"items": continuar_viendo(filas, limit, marcados)}


@router.get("/progress/point")
async def get_progress_point(path: str, user: Annotated[str, Depends(get_current_user)]):
    """Por donde iba este archivo en concreto. Es lo que pide el reproductor al
    abrirse, para arrancar donde se quedo."""
    from app.database.progress import get_progress

    uid = await _user_id(user)
    rel = ruta_relativa(path)
    if uid is None or rel is None:
        return {"position": 0, "duration": 0}

    fila = await get_progress(uid, rel)
    if not fila:
        return {"position": 0, "duration": 0}

    posicion, duracion = float(fila["position"]), float(fila["duration"])
    # Lo ya visto arranca de cero: reanudar en el minuto 119 de 120 es peor que
    # volver a empezar.
    if duracion > 0 and (posicion < MIN_SEGUNDOS or posicion / duracion >= FIN):
        posicion = 0
    return {"position": posicion, "duration": duracion}


@router.post("/progress")
async def post_progress(req: ProgressRequest, user: Annotated[str, Depends(get_current_user)]):
    uid = await _user_id(user)
    if uid is None:
        return {"saved": False}
    return {"saved": await _guardar(uid, req)}


@router.delete("/progress")
async def delete_progress_entry(user: Annotated[str, Depends(get_current_user)],
                                path: str = "", grupo: str = "", todo: bool = False):
    """Quitar de la fila. Con `grupo` (la carpeta del titulo) se olvida el
    titulo entero: borrando solo el episodio en curso la tarjeta volveria a
    salir con el anterior. Con `todo`, el historial completo de la cuenta."""
    from app.database.progress import delete_progress

    uid = await _user_id(user)
    if uid is None:
        return {"deleted": 0}
    if todo:
        return {"deleted": await delete_progress(uid, todo=True)}
    if grupo:
        return {"deleted": await delete_progress(uid, grupo=grupo)}
    rel = ruta_relativa(path)
    if rel is None:
        return {"deleted": 0}
    # Quitar una pelicula de la fila es olvidar su titulo, no solo ese archivo:
    # si no, la otra calidad la haria volver.
    return {"deleted": await delete_progress(uid, grupo=grupo_de(rel))}
