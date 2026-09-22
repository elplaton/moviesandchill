import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Query, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.service import decode_token
from app.config import get_jwt_secret

logger = logging.getLogger("tmd")

security = HTTPBearer(auto_error=False)


def _get_secret() -> str:
    return get_jwt_secret()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    token: Annotated[str | None, Query()] = None,
):
    secret = _get_secret()

    if credentials:
        payload = decode_token(credentials.credentials, secret)
    elif token:
        payload = decode_token(token, secret)
    else:
        payload = None

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalido o expirado",
        )

    return payload["sub"]


async def get_current_admin(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    token: Annotated[str | None, Query()] = None,
):
    username = await get_current_user(credentials=credentials, token=token)

    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    if not user or user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores",
        )

    return username


async def get_current_user_ws(
    websocket: WebSocket,
    token: Annotated[str | None, Query()] = None,
) -> str | None:
    if not token:
        return None
    secret = _get_secret()
    payload = decode_token(token, secret)
    if not payload:
        return None
    return payload["sub"]


async def get_current_account(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    token: Annotated[str | None, Query()] = None,
) -> dict:
    """La cuenta completa (id, rol, cuota). Una cuenta desactivada no entra."""
    username = await get_current_user(credentials=credentials, token=token)
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cuenta no encontrada")
    if not user.get("active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cuenta desactivada")
    return user
