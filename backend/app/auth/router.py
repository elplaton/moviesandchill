import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_user_pendiente
from app.auth.schemas import LoginRequest, RefreshRequest, TokenResponse
from app.auth.service import (
    authenticate,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.config import get_jwt_secret
from app.services import presencia

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    username = await authenticate(req.username, req.password)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contrasena incorrectos",
        )
    logger.info("Login exitoso | user=%s", username)
    presencia.ver(username)
    return await _tokens(username)


async def _tokens(username: str) -> TokenResponse:
    """Tokens nuevos con la marca de la cuenta tal como esta ahora en la base
    de datos: al entrar, al renovar y justo despues de cambiar la contraseña."""
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    cambiar = bool(user and user.get("must_change_password"))
    secret = get_jwt_secret()
    return TokenResponse(access_token=create_access_token(username, secret, cambiar=cambiar),
                         refresh_token=create_refresh_token(username, secret),
                         must_change_password=cambiar)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest):
    secret = get_jwt_secret()
    payload = decode_token(req.refresh_token, secret, expected_type="refresh")
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token invalido o expirado",
        )
    # Se mira la cuenta y no se copia lo que dijera el token viejo: si el admin
    # ha restablecido la contraseña, la sesion abierta tambien tiene que
    # pasar por cambiarla.
    presencia.ver(payload["sub"])
    return await _tokens(payload["sub"])


@router.get("/me")
async def me(user: Annotated[str, Depends(get_user_pendiente)]):
    from app.database.users import get_user_by_username
    from app.database.downloads import usage_by_user
    db_user = await get_user_by_username(user)
    if not db_user:
        return {"username": user, "role": "user"}
    used = await usage_by_user(db_user["id"])
    return {
        "id": db_user["id"], "username": user, "role": db_user.get("role", "user"),
        "quota_bytes": db_user.get("quota_bytes"), "used_bytes": used, "active": db_user.get("active", True),
        "must_change_password": db_user.get("must_change_password", False),
    }


class PasswordChangeRequest(BaseModel):
    # Con la contraseña provisional no se pide: se acaba de escribir para
    # entrar, y el token ya lo demuestra.
    current_password: str = ""
    new_password: str


@router.post("/password")
async def change_password(req: PasswordChangeRequest, user: Annotated[str, Depends(get_user_pendiente)]):
    """Cada cuenta puede cambiar su propia contraseña. Devuelve tokens nuevos:
    con la provisional, los de antes solo servian para llegar aqui."""
    from app.auth.service import hash_password, verify_password
    from app.database.users import get_user_by_username, update_password_hash
    cuenta = await get_user_by_username(user)
    if not cuenta or not cuenta.get("active", True):
        raise HTTPException(status_code=401, detail="Cuenta no disponible")
    provisional = cuenta.get("must_change_password", False)
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="La contraseña nueva es demasiado corta")
    if not provisional and not await authenticate(user, req.current_password):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
    if provisional and verify_password(req.new_password, cuenta["password_hash"]):
        raise HTTPException(status_code=400, detail="La contraseña nueva tiene que ser distinta de la que te dieron")
    await update_password_hash(user, hash_password(req.new_password), must_change=False)
    logger.info("Contraseña cambiada | user=%s%s", user, " (era provisional)" if provisional else "")
    return {"status": "ok", **(await _tokens(user)).model_dump()}
