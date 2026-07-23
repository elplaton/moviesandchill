import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Query, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.service import decode_token
from app.config import load_config

logger = logging.getLogger("tmd")

security = HTTPBearer(auto_error=False)


def _get_secret() -> str:
    return load_config().get("jwt_secret", "default-secret-change-me")


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
