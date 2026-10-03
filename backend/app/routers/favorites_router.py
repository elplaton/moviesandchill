from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.routers.browse_router import item_from_row

router = APIRouter(prefix="/api", tags=["favorites"])


class FavoriteRequest(BaseModel):
    tmdb_id: int
    media_type: str


def _tipo_tmdb(media_type: str) -> str:
    """Los clientes hablan de 'series' y TMDB de 'tv'. Se guarda el de TMDB,
    que es con el que se junta la tabla tmdb_cache."""
    return "tv" if media_type in ("series", "tv") else "movie"


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


@router.get("/favorites")
async def get_favorites(user: Annotated[str, Depends(get_current_user)], keys_only: bool = False):
    """La lista de favoritos de la cuenta.

    Con `keys_only` solo devuelve los pares id+tipo, que es lo que basta para
    pintar el corazon en cada caratula sin traerse 200 fichas enteras.
    """
    from app.database.favorites import favorite_keys, list_favorites

    uid = await _user_id(user)
    if uid is None:
        return {"items": [], "keys": []}

    if keys_only:
        return {"keys": [{"tmdb_id": i, "media_type": "series" if t == "tv" else "movie"}
                         for i, t in await favorite_keys(uid)]}

    rows = await list_favorites(uid)
    items = [item_from_row(r) for r in rows]
    return {"items": items, "keys": [{"tmdb_id": i["tmdb_id"], "media_type": i["media_type"]} for i in items]}


@router.post("/favorites")
async def post_favorite(req: FavoriteRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.favorites import add_favorite

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    await add_favorite(uid, req.tmdb_id, _tipo_tmdb(req.media_type))
    return {"favorite": True}


@router.delete("/favorites")
async def delete_favorite(req: FavoriteRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.favorites import remove_favorite

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    await remove_favorite(uid, req.tmdb_id, _tipo_tmdb(req.media_type))
    return {"favorite": False}
