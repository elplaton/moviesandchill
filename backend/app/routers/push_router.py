"""Suscripciones de aviso: /api/push.

El navegador necesita la clave publica del servidor (VAPID) para suscribirse,
y despues nos manda el `endpoint` y sus dos claves. Eso es todo el alta; el
resto (cifrar, firmar, reintentar, limpiar lo caducado) esta en
`services/push.py`.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["push"])


class SubKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: SubKeys
    # 'm' para la PWA del movil y 'web' para el escritorio: solo sirve para
    # saber de donde salio cada suscripcion al leer los logs.
    app: str = "web"


class UnsubscribeRequest(BaseModel):
    endpoint: str


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


@router.get("/push/key")
async def get_push_key(user: Annotated[str, Depends(get_current_user)]):
    """La clave publica con la que el navegador se suscribe, y si la cuenta
    tiene ya algun aparato dado de alta."""
    from app.database.push import count_subscriptions
    from app.services.push import clave_publica

    uid = await _user_id(user)
    clave = await clave_publica()
    return {"key": clave, "available": bool(clave),
            "devices": await count_subscriptions(uid) if uid else 0}


@router.post("/push/subscribe")
async def post_subscribe(req: SubscribeRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.push import add_subscription

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    await add_subscription(uid, req.endpoint, req.keys.p256dh, req.keys.auth, req.app)
    logger.info("Aparato suscrito a avisos (%s) para la cuenta %d", req.app, uid)
    return {"subscribed": True}


@router.delete("/push/subscribe")
async def delete_subscribe(req: UnsubscribeRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.push import remove_subscription

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    await remove_subscription(uid, req.endpoint)
    return {"subscribed": False}


@router.post("/push/test")
async def post_test(user: Annotated[str, Depends(get_current_user)]):
    """Un aviso de prueba. Existe porque el camino tiene seis piezas (permiso,
    service worker, suscripcion, claves, cifrado, servicio de push) y sin esto
    la unica forma de saber si funciona es esperar a que estrene una serie."""
    from app.services.push import enviar_con_motivo

    uid = await _user_id(user)
    if uid is None:
        return {"error": "Usuario no encontrado"}
    llegados, motivo = await enviar_con_motivo(uid, {
        "title": "Movies & Chill",
        "body": "Los avisos funcionan. Te diremos cuándo llegue un episodio nuevo.",
        "tag": "prueba",
    })
    # El motivo viaja hasta el telefono: «no se ha podido enviar» a secas no
    # deja arreglar nada, y quien pulsa el boton no va a leer los registros.
    return {"sent": llegados, "error": motivo or None}
