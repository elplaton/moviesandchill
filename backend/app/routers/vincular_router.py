"""Entrar en la tele escaneando un QR con el movil (ver services/vincular.py).

  tele  POST /api/auth/qr/start            -> codigo, secreto y la URL del QR
  tele  GET  /api/auth/qr/poll?secreto=    -> pendiente | aprobado (+tokens) | ...
  movil GET  /api/auth/qr/info?codigo=     -> que aparato pide entrar
  movil POST /api/auth/qr/approve          -> aprobar o rechazar

Las dos de la tele no llevan sesion (es justo lo que les falta); las del movil
si, y aprobar es lo unico que convierte un codigo en una sesion.
"""
import logging
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.auth.service import create_access_token, create_refresh_token
from app.config import get_jwt_secret, load_config
from app.services import vincular

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api/auth/qr", tags=["auth"])

# Cada cuanto pregunta la tele. Dos segundos: entre escanear y pulsar
# «Entrar» en el movil pasan varios, y no hace falta mas precision.
INTERVALO_S = 2


def _origen_publico(request: Request) -> str:
    """De donde se abre el enlace del QR.

    Tiene que ser la direccion en la que el **movil** tiene la sesion, no la
    que usa la tele: la tele habla con el servidor por la IP de casa, pero el
    movil entra por el dominio (y con datos, fuera de casa, la IP no le
    llegaria). Por eso va en `TMD_PUBLIC_URL`; sin ella se usa la direccion
    por la que ha llegado la peticion, que vale cuando todo va por el mismo
    sitio.
    """
    publica = (load_config().get("public_url") or "").rstrip("/")
    if publica:
        return publica
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


class Inicio(BaseModel):
    aparato: str = ""


@router.post("/start")
async def empezar(req: Inicio, request: Request):
    p = vincular.crear(req.aparato)
    if not p:
        raise HTTPException(status_code=503, detail="Demasiados códigos pendientes, prueba en un momento")
    return {
        "codigo": p.codigo,
        "secreto": p.secreto,
        "url": f"{_origen_publico(request)}/m/vincular?c={quote(p.codigo)}",
        "caduca_en": vincular.segundos_restantes(p),
        "intervalo": INTERVALO_S,
    }


@router.get("/poll")
async def consultar(secreto: str = ""):
    # Siempre 200, tambien al caducar: un 401 aqui haria que el cliente de la
    # tele creyera que se le ha caducado la sesion y la mandara al login, que
    # es justo donde ya esta.
    estado, usuario = vincular.consultar(secreto)
    if estado != "aprobado":
        return {"estado": estado}
    secret = get_jwt_secret()
    logger.info("Entrada por QR | user=%s", usuario)
    return {
        "estado": estado,
        "username": usuario,
        "access_token": create_access_token(usuario, secret),
        "refresh_token": create_refresh_token(usuario, secret),
    }


@router.get("/info")
async def info(codigo: str, user: Annotated[str, Depends(get_current_user)]):
    p = vincular.buscar(codigo)
    if not p:
        raise HTTPException(status_code=404, detail="Ese código no existe o ya ha caducado. Pide otro en la tele.")
    return {"codigo": p.codigo, "aparato": p.aparato, "caduca_en": vincular.segundos_restantes(p)}


class Respuesta(BaseModel):
    codigo: str
    aprobar: bool = True


@router.post("/approve")
async def responder(req: Respuesta, user: Annotated[str, Depends(get_current_user)]):
    if not req.aprobar:
        vincular.rechazar(req.codigo)
        return {"status": "ok"}
    # El token del movil puede seguir vivo una hora despues de que el admin
    # desactive la cuenta; dejar que esa cuenta abra sesiones nuevas en otros
    # aparatos seria saltarse la desactivacion.
    from app.database.users import get_user_by_username
    db_user = await get_user_by_username(user)
    if db_user and not db_user.get("active", True):
        raise HTTPException(status_code=403, detail="Esta cuenta está desactivada")
    if not vincular.aprobar(req.codigo, user):
        raise HTTPException(status_code=404, detail="Ese código no existe o ya ha caducado. Pide otro en la tele.")
    logger.info("Tele vinculada por QR | user=%s", user)
    return {"status": "ok"}
