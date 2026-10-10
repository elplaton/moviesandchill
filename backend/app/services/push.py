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
    """El `sub` de la firma VAPID: a quien escribir si los avisos dan guerra.

    **Apple lo valida** y rechaza el aviso entero (403 `BadJwtToken`) si no le
    parece una direccion de verdad. El valor de reserva era
    `mailto:admin@moviesandchill.local`, y con el los avisos funcionaban en
    Chrome y no llegaban **nunca** al iPhone. Sin `TMD_PUSH_CONTACT` se usa la
    direccion publica (`TMD_PUBLIC_URL`), que es una URL https real y Apple la
    acepta igual que un correo.
    """
    from app.config import load_config
    config = load_config()
    valor = (config.get("push_contact") or "").strip()
    if valor:
        return valor if valor.startswith(("mailto:", "https:")) else f"mailto:{valor}"
    publica = (config.get("public_url") or "").strip().rstrip("/")
    if publica.startswith("https://"):
        return publica
    return "mailto:admin@moviesandchill.local"


def _motivo(e) -> str:
    """Lo que dice el servicio de push al rechazar, que es lo unico que explica
    el fallo: Apple contesta `{"reason": "BadJwtToken"}` y sin leerlo un 403 no
    dice nada."""
    res = getattr(e, "response", None)
    texto = ""
    try:
        texto = (res.text or "").strip() if res is not None else ""
        texto = json.loads(texto).get("reason") or texto
    except Exception:
        pass
    return (texto or str(e))[:160]


def _enviar_uno(sub: dict, cuerpo: str, privada: str, contacto: str) -> tuple[int, str]:
    """Un envio, en un hilo. Devuelve el codigo HTTP (0 si ni se intento) y,
    si no ha ido bien, el motivo."""
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
        return getattr(res, "status_code", 201), ""
    except WebPushException as e:
        codigo = getattr(e.response, "status_code", 0)
        motivo = _motivo(e)
        if codigo not in (404, 410):
            logger.warning("Aviso rechazado por %s (%s): %s", _servicio(sub["endpoint"]),
                           codigo or "sin respuesta", motivo)
        return codigo, motivo
    except Exception as e:
        logger.warning("Aviso fallido (%s): %s", _servicio(sub["endpoint"]), str(e)[:160])
        return 0, str(e)[:160]


def _servicio(endpoint: str) -> str:
    """'web.push.apple.com', 'fcm.googleapis.com'...: en un registro, de quien
    es el aparato dice mas que el endpoint entero."""
    from urllib.parse import urlparse
    return urlparse(endpoint).hostname or "?"


async def enviar(user_id: int, payload: dict) -> int:
    """Manda un aviso a todos los aparatos de una cuenta. Devuelve a cuantos llego."""
    llegados, _ = await enviar_con_motivo(user_id, payload)
    return llegados


async def enviar_con_motivo(user_id: int, payload: dict) -> tuple[int, str]:
    """Como `enviar()`, pero diciendo por que no ha llegado si no ha llegado.

    Las suscripciones que el servicio de push da por muertas (404/410) se
    borran aqui: son aparatos donde se desinstalo la app. Un 401/403, en
    cambio, **no es culpa del aparato** sino de nuestra firma, y no cuenta
    como fallo: antes sumaba, a los cinco avisos rechazados se borraba la
    suscripcion y el telefono seguia diciendo «Avisos activados» sin que el
    servidor supiera ya de el.
    """
    global _avisado_sin_libreria
    from app.database.push import (drop_subscription_by_id, mark_subscription_fail,
                                   mark_subscription_ok, subscriptions_for)

    subs = await subscriptions_for(user_id)
    if not subs:
        return 0, "El servidor no tiene ningún aparato tuyo dado de alta."

    try:
        import pywebpush  # noqa: F401
    except ImportError:
        if not _avisado_sin_libreria:
            logger.error("Los avisos necesitan pywebpush (pip install -r requirements.txt)")
            _avisado_sin_libreria = True
        return 0, "Al servidor le falta pywebpush."

    try:
        _, privada = await claves()
    except Exception as e:
        logger.error("Sin claves de aviso: %s", e)
        return 0, "El servidor no tiene claves de aviso."

    cuerpo = json.dumps(payload, ensure_ascii=False)
    contacto = _contacto()
    resultados = await asyncio.gather(
        *[asyncio.to_thread(_enviar_uno, s, cuerpo, privada, contacto) for s in subs],
        return_exceptions=True)

    llegados, motivos = 0, []
    for sub, resultado in zip(subs, resultados):
        if isinstance(resultado, Exception):
            await mark_subscription_fail(sub["id"])
            motivos.append(str(resultado)[:160])
            continue
        codigo, motivo = resultado
        if codigo in (404, 410):
            await drop_subscription_by_id(sub["id"])
            logger.info("Suscripcion de aviso caducada, borrada (%s)", sub["app"])
            motivos.append("La suscripción había caducado: vuelve a activar los avisos.")
        elif 200 <= codigo < 300:
            await mark_subscription_ok(sub["id"])
            llegados += 1
        elif codigo in (401, 403):
            logger.error("%s rechaza la firma de los avisos (%s, contacto %s): %s",
                         _servicio(sub["endpoint"]), codigo, contacto, motivo)
            motivos.append(f"{_servicio(sub['endpoint'])} rechaza el aviso: {motivo}")
        else:
            await mark_subscription_fail(sub["id"])
            motivos.append(f"{_servicio(sub['endpoint'])} ({codigo or 'sin respuesta'}): {motivo}")
    return llegados, "" if llegados else "; ".join(dict.fromkeys(motivos))
