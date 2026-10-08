"""Lo que ya se ha visto: /api/watched.

Es por **titulo**, y en las series tambien por episodio. No se guarda en
`playback_progress` porque eso va por ruta de disco: "ya me he visto esta
pelicula" tiene que valer aunque no este descargada.

Lo que se marca aqui hace tres cosas: pinta el visto en la ficha, saca el
titulo de "Continuar viendo" y **mueve las recomendaciones**, que suman los
generos de lo visto a los del onboarding.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.services import cache

router = APIRouter(prefix="/api", tags=["watched"])


class WatchedRequest(BaseModel):
    tmdb_id: int
    media_type: str
    # Sin temporada ni episodio es el titulo entero: la pelicula, o la serie
    # completa ("ya me la he visto").
    season: int | None = None
    episode: int | None = None


def _tipo_tmdb(media_type: str | None) -> str:
    """Los clientes hablan de 'series' y TMDB de 'tv'."""
    return "tv" if media_type in ("series", "tv") else "movie"


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


@router.get("/watched")
async def get_watched(user: Annotated[str, Depends(get_current_user)],
                      tmdb_id: int = 0, media_type: str = "", keys_only: bool = False):
    from app.database.watched import titulos_vistos, visto_de_titulo

    uid = await _user_id(user)
    if uid is None:
        return {"whole": False, "episodes": [], "keys": []}

    if keys_only or not tmdb_id:
        # Los titulos vistos enteros, con la misma clave que usan las tarjetas
        # ('s' o 'm' delante del id).
        claves = [f"{'s' if t == 'tv' else 'm'}{i}" for i, t in await titulos_vistos(uid)]
        return {"keys": claves}

    return await visto_de_titulo(uid, tmdb_id, _tipo_tmdb(media_type))


@router.post("/watched")
async def post_watched(req: WatchedRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.watched import marcar_visto

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    await marcar_visto(uid, req.tmdb_id, _tipo_tmdb(req.media_type),
                       req.season or 0, req.episode or 0)
    # Lo marcado mueve las recomendaciones, y la portada va cacheada.
    cache.cambio_de_cuenta(uid)
    return {"watched": True}


@router.delete("/watched")
async def delete_watched(req: WatchedRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.watched import desmarcar_visto

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    await desmarcar_visto(uid, req.tmdb_id, _tipo_tmdb(req.media_type),
                          req.season or 0, req.episode or 0)
    cache.cambio_de_cuenta(uid)
    return {"watched": False}
