"""Avisos al movil (Web Push).

Como funciona, en corto: el navegador se suscribe a su propio servicio de push
(Apple, Google...) y nos da un `endpoint` y dos claves; nosotros ciframos el
mensaje para esas claves y lo firmamos con un par propio (VAPID) que identifica
al servidor. El aparato recibe el aviso aunque la app este cerrada, porque lo
despierta el service worker.

Dos decisiones:

* **Las claves VAPID viven en `app_settings`, no en el `.env`.** La publica
  queda grabada en cada suscripcion del navegador: si cambia, todas las
  suscripciones existentes dejan de valer de golpe. En Coolify el `.env` lo
  regenera la plataforma en cada redespliegue, asi que ahi se habrian perdido;
  en la base de datos sobreviven. Se generan solas la primera vez.
* **Enviar es bloqueante** (`pywebpush` va con `requests`), asi que cada envio
  pasa por un hilo. Un aviso no debe frenar el event loop, y menos con un
  servicio de push lento.

El iPhone pone condiciones que no estan en nuestra mano: solo recibe avisos si
la PWA esta instalada en la pantalla de inicio (iOS 16.4+) y el permiso se pide
con el dedo del usuario. En Safari a secas no hay forma.
"""
import asyncio
import base64
import json
import logging

logger = logging.getLogger("tmd")

CLAVE_PUBLICA = "vapid_public"
CLAVE_PRIVADA = "vapid_private"

# A las 12 horas un aviso de "hay episodio nuevo" ya no interesa.
TTL = 12 * 3600

_avisado_sin_libreria = False


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _generar() -> tuple[str, str]:
    """Par de claves VAPID (curva P-256).

    La privada se guarda como el escalar en crudo en base64url (32 bytes), que
    es lo que `pywebpush` acepta sin tocar archivos; la publica, como el punto
    sin comprimir (65 bytes), que es exactamente lo que espera
    `pushManager.subscribe({applicationServerKey})`.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    priv = ec.generate_private_key(ec.SECP256R1())
    privada = priv.private_numbers().private_value.to_bytes(32, "big")
    publica = priv.public_key().public_bytes(serialization.Encoding.X962,
                                             serialization.PublicFormat.UncompressedPoint)
    return _b64u(publica), _b64u(privada)


async def claves() -> tuple[str, str]:
    """La pareja (publica, privada), creandola la primera vez."""
    from app.database.connection import get_app_settings, set_app_settings

    guardado = await get_app_settings()
    publica, privada = guardado.get(CLAVE_PUBLICA), guardado.get(CLAVE_PRIVADA)
    if publica and privada:
        return publica, privada

    publica, privada = _generar()
    await set_app_settings({CLAVE_PUBLICA: publica, CLAVE_PRIVADA: privada})
    logger.info("Claves de aviso (VAPID) generadas y guardadas")
    return publica, privada


async def clave_publica() -> str:
    try:
        publica, _ = await claves()
        return publica
    except Exception as e:
        logger.error("No se pudieron preparar las claves de aviso: %s", e)
        return ""


def _contacto() -> str:
    from app.config import load_config
    valor = load_config().get("push_contact") or "admin@moviesandchill.local"
    return valor if valor.startswith("mailto:") else f"mailto:{valor}"


def _enviar_uno(sub: dict, cuerpo: str, privada: str, contacto: str) -> int:
    """Un envio, en un hilo. Devuelve el codigo HTTP (o 0 si ni se intento)."""
    from pywebpush import WebPushException, webpush

    info = {"endpoint": sub["endpoint"],
            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
    try:
        res = webpush(info, data=cuerpo, vapid_private_key=privada,
                      # Las reclamaciones se copian en cada llamada: pywebpush
                      # escribe `aud` y `exp` dentro del diccionario que se le
                      # pasa, y reutilizarlo firmaria el segundo aviso con el
                      # destinatario del primero.
                      vapid_claims={"sub": contacto}, ttl=TTL, timeout=10)
        return getattr(res, "status_code", 201)
    except WebPushException as e:
        codigo = getattr(e.response, "status_code", 0)
        if codigo not in (404, 410):
            logger.warning("Aviso rechazado (%s): %s", codigo or "sin respuesta", str(e)[:160])
        return codigo
    except Exception as e:
        logger.warning("Aviso fallido: %s", str(e)[:160])
        return 0


async def enviar(user_id: int, payload: dict) -> int:
    """Manda un aviso a todos los aparatos de una cuenta.

    Devuelve a cuantos llego. Las suscripciones que el servicio de push da por
    muertas (404/410) se borran aqui: son aparatos donde se desinstalo la app.
    """
    global _avisado_sin_libreria
    from app.database.push import (drop_subscription_by_id, mark_subscription_fail,
                                   mark_subscription_ok, subscriptions_for)

    subs = await subscriptions_for(user_id)
    if not subs:
        return 0

    try:
        import pywebpush  # noqa: F401
    except ImportError:
        if not _avisado_sin_libreria:
            logger.error("Los avisos necesitan pywebpush (pip install -r requirements.txt)")
            _avisado_sin_libreria = True
        return 0

    try:
        _, privada = await claves()
    except Exception as e:
        logger.error("Sin claves de aviso: %s", e)
        return 0

    cuerpo = json.dumps(payload, ensure_ascii=False)
    contacto = _contacto()
    codigos = await asyncio.gather(
        *[asyncio.to_thread(_enviar_uno, s, cuerpo, privada, contacto) for s in subs],
        return_exceptions=True)

    llegados = 0
    for sub, codigo in zip(subs, codigos):
        if isinstance(codigo, Exception):
            await mark_subscription_fail(sub["id"])
            continue
        if codigo in (404, 410):
            await drop_subscription_by_id(sub["id"])
            logger.info("Suscripcion de aviso caducada, borrada (%s)", sub["app"])
        elif 200 <= codigo < 300:
            await mark_subscription_ok(sub["id"])
            llegados += 1
        else:
            await mark_subscription_fail(sub["id"])
    return llegados
