"""Seguimiento de series: /api/follows.

El seguimiento es de series y nada mas, asi que aqui no viaja el tipo. Lo
unico que se traduce en la frontera es el id: el cliente habla de la serie que
tiene abierta y eso es un `tmdb_id` de TMDB con tipo `tv`.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.routers.browse_router import item_from_row

router = APIRouter(prefix="/api", tags=["follows"])


class FollowRequest(BaseModel):
    tmdb_id: int


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


@router.get("/follows")
async def get_follows(user: Annotated[str, Depends(get_current_user)], keys_only: bool = False):
    """Las series que sigue la cuenta.

    Con `keys_only` solo los ids, que es lo que basta para pintar la campana en
    la ficha sin traerse las fichas enteras.
    """
    from app.database.follows import follow_keys, list_follows

    uid = await _user_id(user)
    if uid is None:
        return {"items": [], "keys": []}

    if keys_only:
        return {"keys": await follow_keys(uid)}

    rows = await list_follows(uid)
    items = [item_from_row(r) for r in rows]
    return {"items": items, "keys": [i["tmdb_id"] for i in items]}


@router.post("/follows")
async def post_follow(req: FollowRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.follows import set_follow

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    await set_follow(uid, req.tmdb_id, True)
    return {"following": True}


@router.delete("/follows")
async def delete_follow(req: FollowRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.follows import set_follow

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    # No se borra la fila: queda desactivada para que el seguimiento
    # automatico (ver un episodio) no la vuelva a encender.
    await set_follow(uid, req.tmdb_id, False)
    return {"following": False}
