"""Estado de la interfaz que es de la cuenta: /api/state.

Ahora mismo solo lo ultimo que se busco. Antes vivia en el almacenamiento del
navegador, con dos problemas: se queda escrito en un aparato que puede ser de
mas gente, y no sirve de nada en el resto (buscas en el movil y en la tele no
esta).
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["state"])


class StateRequest(BaseModel):
    last_search: str | None = None


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


@router.get("/state")
async def get_state(user: Annotated[str, Depends(get_current_user)]):
    from app.database.user_state import leer_estado

    uid = await _user_id(user)
    return await leer_estado(uid) if uid else {}


@router.put("/state")
async def put_state(req: StateRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.user_state import guardar_estado

    uid = await _user_id(user)
    if uid is None:
        return {}
    # exclude_unset: lo que el cliente no manda no se toca. Mandar
    # `last_search: ""` si es para borrarlo.
    return await guardar_estado(uid, req.model_dump(exclude_unset=True))
