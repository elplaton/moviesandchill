import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.auth.schemas import LoginRequest, RefreshRequest, TokenResponse
from app.auth.service import (
    authenticate,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.config import get_jwt_secret

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
    secret = get_jwt_secret()
    access_token = create_access_token(username, secret)
    refresh_token = create_refresh_token(username, secret)
    logger.info("Login exitoso | user=%s", username)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest):
    secret = get_jwt_secret()
    payload = decode_token(req.refresh_token, secret, expected_type="refresh")
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token invalido o expirado",
        )
    username = payload["sub"]
    access_token = create_access_token(username, secret)
    refresh_token = create_refresh_token(username, secret)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.get("/me")
async def me(user: Annotated[str, Depends(get_current_user)]):
    from app.database.users import get_user_by_username
    db_user = await get_user_by_username(user)
    return {"username": user, "role": db_user.get("role", "user") if db_user else "user"}
