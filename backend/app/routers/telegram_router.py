"""Alta de la sesion de Telegram desde la interfaz.

Hasta ahora esto solo se podia hacer con `python main.py setup`, que pide el
codigo de verificacion por consola. En un contenedor no hay consola: Telethon
escribia "Please enter the code you received", se encontraba con un EOF y el
backend se quedaba con un cliente conectado pero sin autenticar. A partir de
ahi todo lo que tocaba Telegram fallaba con "The key is not registered in the
system" y la indexacion encontraba cero mensajes.

Estos endpoints parten aquel dialogo en dos peticiones (mandar codigo, canjear
codigo) y reutilizan el mismo cliente de Telethon que ya tiene el backend, de
forma que al terminar no hace falta reiniciar nada: se resuelven los canales y
arranca la indexacion.
"""
import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from telethon import TelegramClient
from telethon.errors import (
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberInvalidError,
    SessionPasswordNeededError,
)

from app.auth.dependencies import get_current_admin

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api/admin/telegram", tags=["telegram"])

# Hash que devuelve send_code_request y que hay que presentar al canjear el
# codigo. Vive en memoria porque solo tiene sentido entre las dos peticiones.
_pending: dict = {}


class SignInRequest(BaseModel):
    code: str
    password: str | None = None


class CredentialsRequest(BaseModel):
    api_id: int
    api_hash: str
    phone: str


def _mask_phone(phone: str) -> str:
    """+34633453385 -> +34·····3385. El numero ya esta en el .env, pero no hay
    razon para repetirlo entero en cada respuesta de la API."""
    if len(phone) < 8:
        return phone
    return f"{phone[:3]}{'·' * (len(phone) - 7)}{phone[-4:]}"


def _mask_hash(value: str) -> str:
    """Igual que en /api/config: se enmascara en vez de ocultarse para que la
    interfaz sepa que hay algo puesto sin llegar a enseñarlo."""
    return f"{'*' * 8}{value[-4:]}" if value else ""


def _credentials_out(config: dict) -> dict:
    return {
        "api_id": config.get("api_id") or 0,
        "api_hash": _mask_hash(config.get("api_hash", "")),
        "phone": config.get("phone", ""),
    }


def _ctx():
    from app.routers.download import downloader, config
    if downloader is None:
        raise HTTPException(status_code=503, detail="El backend aun esta arrancando")
    return downloader, config


def _configured(config: dict) -> bool:
    return bool(config.get("api_id") and config.get("api_hash") and config.get("phone"))


async def _ensure_client(downloader, config) -> tuple[TelegramClient, bool]:
    """Devuelve el cliente de Telethon listo para hablar, y si lo hemos creado
    nosotros. Reutilizamos el del backend siempre que exista: es el que tiene
    enganchado el handler de mensajes nuevos."""
    created = False
    if downloader.client is None:
        session_file = downloader._session_path()
        os.makedirs(os.path.dirname(session_file), exist_ok=True)
        downloader.client = TelegramClient(session_file, config["api_id"], config["api_hash"])
        created = True
    if not downloader.client.is_connected():
        await downloader.client.connect()
    return downloader.client, created


@router.get("/status")
async def telegram_status(user: Annotated[str, Depends(get_current_admin)]):
    downloader, config = _ctx()

    if not _configured(config):
        return {
            "configured": False, "authorized": False, "code_sent": False,
            "phone": "", "channels_resolved": 0,
            "credentials": _credentials_out(config),
            "detail": "Faltan el API ID, el API Hash o el telefono.",
        }

    authorized = False
    try:
        client, _ = await _ensure_client(downloader, config)
        authorized = await client.is_user_authorized()
    except Exception as e:
        logger.warning("No se pudo comprobar la sesion de Telegram: %s", e)

    return {
        "configured": True,
        "authorized": authorized,
        "code_sent": bool(_pending),
        "phone": _mask_phone(config.get("phone", "")),
        "channels_resolved": len(downloader.channels),
        "credentials": _credentials_out(config),
    }


@router.post("/send-code")
async def send_code(user: Annotated[str, Depends(get_current_admin)]):
    downloader, config = _ctx()

    if not _configured(config):
        raise HTTPException(
            status_code=400,
            detail="Faltan TMD_API_ID, TMD_API_HASH o TMD_PHONE en la configuracion.",
        )

    client, _ = await _ensure_client(downloader, config)

    if await client.is_user_authorized():
        return {"authorized": True, "code_sent": False,
                "detail": "Esta sesion ya estaba iniciada."}

    phone = config["phone"]
    try:
        sent = await client.send_code_request(phone)
    except PhoneNumberInvalidError:
        raise HTTPException(status_code=400, detail=f"Telegram no acepta el numero {_mask_phone(phone)}.")
    except Exception as e:
        logger.error("Error pidiendo el codigo de Telegram: %s", e)
        raise HTTPException(status_code=502, detail=f"Telegram no ha aceptado la peticion: {e}")

    _pending.clear()
    _pending.update({"phone": phone, "hash": sent.phone_code_hash})
    logger.info("Codigo de Telegram enviado a %s", _mask_phone(phone))

    return {"authorized": False, "code_sent": True, "phone": _mask_phone(phone),
            "detail": "Telegram te ha mandado un codigo. Miralo en la app y escribelo aqui."}


@router.post("/sign-in")
async def sign_in(req: SignInRequest, user: Annotated[str, Depends(get_current_admin)]):
    downloader, config = _ctx()

    if not _pending:
        raise HTTPException(status_code=409,
                            detail="No hay ningun codigo pendiente. Pide uno nuevo.")

    client, created = await _ensure_client(downloader, config)
    code = req.code.strip().replace(" ", "").replace("-", "")

    try:
        await client.sign_in(_pending["phone"], code, phone_code_hash=_pending["hash"])
    except SessionPasswordNeededError:
        # Cuenta con verificacion en dos pasos: el codigo era correcto pero
        # falta la contrasena. Se pide en una segunda vuelta del formulario.
        if not req.password:
            raise HTTPException(
                status_code=428,
                detail="Esta cuenta tiene verificacion en dos pasos. Escribe tambien tu contrasena.",
            )
        try:
            await client.sign_in(password=req.password)
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Contrasena de dos pasos incorrecta: {e}")
    except PhoneCodeInvalidError:
        raise HTTPException(status_code=400, detail="El codigo no es correcto.")
    except PhoneCodeExpiredError:
        _pending.clear()
        raise HTTPException(status_code=400, detail="El codigo ha caducado. Pide uno nuevo.")
    except Exception as e:
        logger.error("Error iniciando sesion en Telegram: %s", e)
        raise HTTPException(status_code=502, detail=f"Telegram ha rechazado el acceso: {e}")

    _pending.clear()
    logger.info("Sesion de Telegram iniciada desde el panel de administracion")

    resolved, indexing = await _after_login(downloader, config, created)

    return {"authorized": True, "channels_resolved": resolved, "indexing": indexing,
            "detail": "Sesion iniciada. Ya se estan resolviendo los canales."}


async def _after_login(downloader, config, client_was_created: bool) -> tuple[int, bool]:
    """Deja el backend como si hubiera arrancado con la sesion ya puesta:
    canales resueltos, escucha de mensajes nuevos e indexacion en marcha."""
    from app.database.connection import get_active_channels

    try:
        channels = await get_active_channels()
        if channels:
            config["channels"] = channels
            await downloader.load_channels_from_list(channels)
    except Exception as e:
        logger.error("No se pudieron resolver los canales tras el login: %s", e)

    # main.py solo engancha el handler de mensajes nuevos si habia cliente al
    # arrancar. Si el cliente lo hemos creado aqui, no lo habia.
    if client_was_created:
        try:
            from app.services.indexer import index_live_message
            from app.routers.ws_router import _broadcast_index
            api_key = config.get("tmdb_api_key", "") if config.get("tmdb_enabled") else ""

            async def _on_new(ch_id, msg):
                await index_live_message(downloader, ch_id, msg, api_key=api_key,
                                         broadcast=_broadcast_index)

            downloader.watch_new_messages(_on_new)
        except Exception as e:
            logger.warning("No se pudo enganchar la escucha de mensajes nuevos: %s", e)

    indexing = False
    try:
        from app.routers.index_router import _do_start
        result = await _do_start(force=False)
        indexing = result.get("status") == "started"
    except Exception as e:
        logger.error("No se pudo arrancar la indexacion tras el login: %s", e)

    return len(downloader.channels), indexing


@router.post("/credentials")
async def save_credentials(req: CredentialsRequest, user: Annotated[str, Depends(get_current_admin)]):
    """Guarda API ID, API Hash y telefono en la base de datos.

    No se tocan variables de entorno: en un despliegue tipo Coolify el .env lo
    regenera la plataforma en cada redespliegue y lo escrito aqui se perderia.
    La tabla `app_settings` manda sobre el .env al arrancar.
    """
    downloader, config = _ctx()

    api_hash = req.api_hash.strip()
    # La interfaz sirve el hash enmascarado; si vuelve tal cual es que no lo
    # han tocado. Sin esto se guardaria "********1204" como credencial.
    if api_hash.startswith("****"):
        api_hash = config.get("api_hash", "")

    phone = req.phone.strip().replace(" ", "")

    if req.api_id <= 0:
        raise HTTPException(status_code=400, detail="El API ID tiene que ser un numero positivo.")
    if not api_hash:
        raise HTTPException(status_code=400, detail="Falta el API Hash.")
    if not phone.startswith("+"):
        raise HTTPException(status_code=400,
                            detail="El telefono va con prefijo internacional, por ejemplo +34600112233.")

    # Cambiar de aplicacion de Telegram invalida la sesion: la clave guardada
    # pertenece al api_id anterior y Telegram la rechazaria con el mismo
    # "The key is not registered in the system" de siempre.
    app_changed = (req.api_id != config.get("api_id")) or (api_hash != config.get("api_hash"))

    from app.database.connection import set_app_settings
    await set_app_settings({"api_id": req.api_id, "api_hash": api_hash, "phone": phone})

    config["api_id"] = req.api_id
    config["api_hash"] = api_hash
    config["phone"] = phone
    # El downloader se quedo con una copia al construirse.
    downloader.api_id = req.api_id
    downloader.api_hash = api_hash
    downloader.phone = phone

    _pending.clear()

    if app_changed:
        await _reset_client(downloader)

    logger.info("Credenciales de Telegram actualizadas por %s (app nueva: %s)", user, app_changed)

    return {
        "saved": True,
        "session_reset": app_changed,
        "credentials": _credentials_out(config),
        "detail": ("Credenciales guardadas. Como has cambiado de aplicacion de Telegram, "
                   "hay que iniciar sesion otra vez.")
        if app_changed else "Credenciales guardadas.",
    }


async def _reset_client(downloader) -> None:
    """Desconecta el cliente y aparta el fichero de sesion, que pertenece a la
    aplicacion anterior. Se renombra en vez de borrarse: si el cambio fue un
    error, el fichero sigue ahi."""
    import time

    if downloader.client is not None:
        try:
            await downloader.client.disconnect()
        except Exception as e:
            logger.warning("No se pudo desconectar el cliente anterior: %s", e)
        downloader.client = None

    downloader.channels = {}

    session_file = f"{downloader._session_path()}.session"
    if os.path.isfile(session_file):
        backup = f"{session_file}.bak-{int(time.time())}"
        try:
            os.rename(session_file, backup)
            logger.info("Sesion anterior apartada en %s", os.path.basename(backup))
        except OSError as e:
            logger.warning("No se pudo apartar la sesion anterior: %s", e)
