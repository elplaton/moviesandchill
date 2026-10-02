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


def _cubre(autorizada: str, pedida: str) -> bool:
    """Si una entrada emitida para `autorizada` sirve para `pedida`.

    Vale para el video y para sus subtitulos sueltos, que son ficheros
    distintos al lado (`<video>.<idioma>.vtt`): pedir una entrada por cada
    pista seria una vuelta mas al servidor por nada. No vale para otra cosa.
    """
    if not autorizada or not pedida:
        return False
    if autorizada == pedida:
        return True
    if not pedida.lower().endswith(".vtt"):
        return False
    raiz = autorizada.rsplit(".", 1)[0]
    return pedida.startswith(raiz + ".")


async def get_stream_user(
    path: Annotated[str, Query()] = "",
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)] = None,
    token: Annotated[str | None, Query()] = None,
):
    """Como `get_current_user`, pero acepta tambien una entrada de reproduccion.

    La usan `/api/stream` y `/api/subtitle`, que son los dos sitios donde la
    URL viaja con el token dentro y la lee alguien que no puede renovarlo: el
    elemento `<video>`, o directamente un Apple TV por AirPlay. La entrada
    vale solo para la ruta que lleva escrita, asi que filtrarse no da acceso
    a nada mas.
    """
    secret = _get_secret()

    if credentials:
        payload = decode_token(credentials.credentials, secret)
        if payload:
            return payload["sub"]

    if token:
        payload = decode_token(token, secret)
        if payload:
            return payload["sub"]
        entrada = decode_token(token, secret, expected_type="stream")
        if entrada and _cubre(entrada.get("path") or "", path):
            return entrada["sub"]

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token invalido o expirado",
    )


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
