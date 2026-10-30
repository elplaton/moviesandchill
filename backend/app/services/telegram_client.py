import asyncio
import logging
import os
import re
import time
from datetime import datetime, timedelta

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

from app.services import descarga_paralela
from app.services.storage import _detect_multipart, suggest_folder_name, create_movie_folder

# Lo que se esta bajando lleva esto detras hasta que esta entero.
SUFIJO_PARCIAL = ".parcial"

# Cuanto se espera a Telegram al buscar las partes de un archivo en un canal.
BUSQUEDA_PARTES_S = 8


async def _partes_en_catalogo(channel_id, base):
    """Mensajes del catalogo de ese canal cuyo nombre empieza por `base`."""
    from app.database.connection import get_pool
    pool = get_pool()
    if not pool or not channel_id:
        return []
    patron = base.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    try:
        async with pool.acquire() as conn:
            return await conn.fetch("""
                SELECT channel_id, message_id, file_name, file_size FROM media_items
                WHERE channel_id = $1 AND file_name ILIKE $2 LIMIT 200
            """, channel_id, patron)
    except Exception as e:
        logger.warning("Buscando partes de %s en el catalogo: %s", base, e)
        return []

logger = logging.getLogger("tmd")


class TelegramDownloader:
    def __init__(self, config):
        self.api_id = config["api_id"]
        self.api_hash = config["api_hash"]
        self.phone = config["phone"]
        self.download_path = config["download_path"]
        # Conexiones por archivo (ver services/descarga_paralela.py). 1 = como
        # antes, un trozo detras de otro.
        self.conexiones = max(1, config.get("download_conexiones", 6))
        self.client = None
        # None hasta preguntarselo a Telegram al arrancar.
        self.premium = None
        self.active_batches = {}
        self.channel_ids = []
        self.channels = {}
        self._config_channels = config.get("channels") or []
        self.session_dir = None
        # Lo pone stop(): apagando, el vigilante no debe volver a conectar.
        self._parado = False
        self._canales_intentados = 0.0

    def _session_path(self):
        if self.session_dir:
            return os.path.join(self.session_dir, "user")
        for base in [os.getcwd(), os.path.join(os.path.dirname(__file__), "..", "..", "..")]:
            d = os.path.join(base, "session")
            if os.path.isdir(d):
                return os.path.join(d, "user")
        d = os.path.join(os.getcwd(), "session")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "user")

    async def load_channels_from_list(self, channels: list[dict]):
        if not channels:
            channels = self._config_channels
        self.channel_ids = [{"id": ch["id"], "name": ch["name"]} for ch in channels]
        if self.client:
            for ch in self.channel_ids:
                try:
                    ref = self._resolve_channel_id(ch["id"])
                    entity = await self.client.get_entity(ref)
                    self.channels[ch["id"]] = {"entity": entity, "name": ch["name"]}
                except Exception as e:
                    logger.warning("No se pudo resolver canal %d: %s", ch["id"], e)

    def _resolve_channel_id(self, ch_id):
        if ch_id > 0:
            return int(f"-100{ch_id}")
        return ch_id

    async def get_total_messages(self, channel_id: int):
        ch_data = self.channels.get(channel_id)
        if not ch_data:
            return 0
        try:
            msgs = await self.client.get_messages(ch_data["entity"], limit=1)
            if msgs:
                if hasattr(msgs, 'id'):
                    return msgs.id
                if isinstance(msgs, (list, tuple)) and len(msgs) > 0:
                    return msgs[0].id
        except Exception as e:
            logger.warning("No se pudo obtener total de mensajes del canal %d: %s", channel_id, e)
        return 0

    async def start(self):
        """Conecta con la sesion que haya guardada. Si no hay, se queda
        conectado pero sin autenticar y lo dice.

        Antes esto llamaba a `client.start(phone=...)`, que en un contenedor
        hacia dos destrozos: pedia el codigo por consola (y moria con un EOF,
        sin sesion igualmente) y, de camino, **gastaba un envio de codigo en
        cada arranque**. Con varios redespliegues seguidos Telegram acababa
        respondiendo "all available options for this type of number were
        already used", y el hash que dejaba cacheado convertia la siguiente
        peticion del panel en un reenvio en vez de un envio nuevo.
        """
        session_file = self._session_path()
        os.makedirs(os.path.dirname(session_file), exist_ok=True)
        self.client = TelegramClient(session_file, self.api_id, self.api_hash)
        await self.client.connect()

        if not await self.client.is_user_authorized():
            logger.warning("Sin sesion de Telegram: inicia sesion en el panel de "
                           "administracion, pestaña Telegram. No se pide ningun codigo "
                           "desde aqui para no gastar los envios disponibles.")
            return

        # Sin Premium Telegram limita la velocidad de descarga de la cuenta; con
        # Premium no. No hay nada que ajustar aqui, pero si las descargas van
        # lentas lo primero es saber cual de las dos es.
        try:
            yo = await self.client.get_me()
            self.premium = bool(getattr(yo, "premium", False))
            logger.info("Cuenta de Telegram: %s | Premium: %s | Cifrado: %s | Conexiones por archivo: %d",
                        getattr(yo, "username", None) or getattr(yo, "phone", "?"),
                        "si" if self.premium else "no",
                        descarga_paralela.motor_cifrado(), self.conexiones)
            if descarga_paralela.motor_cifrado() == "python":
                logger.warning("Telethon esta descifrando en Python puro: las descargas no pasaran "
                               "de ~1 MB/s. Falta el paquete cryptg en la imagen.")
        except Exception as e:
            logger.warning("No se pudo saber si la cuenta de Telegram es Premium: %s", e)

        await self.resolver_canales()

    async def resolver_canales(self) -> int:
        """Resuelve los canales que aun no lo estan. Devuelve cuantos hay."""
        self._canales_intentados = time.monotonic()
        for ch in self.channel_ids:
            if ch["id"] in self.channels:
                continue
            try:
                ref = self._resolve_channel_id(ch["id"])
                entity = await self.client.get_entity(ref)
                self.channels[ch["id"]] = {"entity": entity, "name": ch["name"]}
            except Exception as e:
                logger.warning("No se pudo resolver canal %d: %s", ch["id"], e)
        return len(self.channels)

    async def vigilar_conexion(self, cada: float = 30):
        """Vuelve a conectar con Telegram si la conexion se ha caido.

        Telethon reconecta solo tras un corte corto, pero no si el primer
        `connect()` falla (al arrancar el servidor sin red todavia) ni cuando
        agota sus reintentos: el cliente se queda desconectado para siempre y
        todo lo que pasa por el falla con "Cannot send requests while
        disconnected". Paso tras un reinicio del servidor: 16 horas sin «Ver»
        en nada que no estuviera descargado y sin indexar lo nuevo, con el
        cliente marcado como autorizado y 0 canales resueltos.
        """
        while not self._parado:
            await asyncio.sleep(cada)
            c = self.client
            if c is None or self._parado:
                continue
            try:
                if not c.is_connected():
                    await c.connect()
                    if not await c.is_user_authorized():
                        continue
                    logger.warning("Telegram estaba desconectado: conexion recuperada")
                    await self.resolver_canales()
                # Canales sin resolver con la conexion viva (uno privado, o
                # Telegram fallando justo al resolver): se reintenta cada 10
                # minutos, no cada vuelta.
                elif (len(self.channels) < len(self.channel_ids)
                      and time.monotonic() - self._canales_intentados > 600
                      and await c.is_user_authorized()):
                    await self.resolver_canales()
            except Exception as e:
                logger.warning("No se pudo reconectar con Telegram: %s", e)

    async def add_channel(self, ch_id, name):
        for ch in self.channel_ids:
            if ch["id"] == ch_id:
                ch["name"] = name
                return False
        self.channel_ids.append({"id": ch_id, "name": name})
        try:
            ref = self._resolve_channel_id(ch_id)
            entity = await self.client.get_entity(ref)
            self.channels[ch_id] = {"entity": entity, "name": name}
        except Exception:
            pass
        return True

    async def refresh_from_db(self, db_channels: list[dict]):
        self.channel_ids = [{"id": ch["id"], "name": ch["name"]} for ch in db_channels]
        new_channels = {}
        for ch in self.channel_ids:
            cid = ch["id"]
            if cid in self.channels:
                new_channels[cid] = self.channels[cid]
                new_channels[cid]["name"] = ch["name"]
            elif self.client:
                try:
                    ref = self._resolve_channel_id(cid)
                    entity = await self.client.get_entity(ref)
                    new_channels[cid] = {"entity": entity, "name": ch["name"]}
                except Exception:
                    pass
        self.channels = new_channels

    def channel_name(self, ch_id: int) -> str:
        """Nombre del canal, resuelto o no. `self.channels` solo tiene los que
        Telethon ha conseguido resolver; `self.channel_ids` los tiene todos."""
        resolved = self.channels.get(ch_id, {}).get("name")
        if resolved:
            return resolved
        for ch in self.channel_ids:
            if ch["id"] == ch_id:
                return ch["name"]
        return ""

    def watch_new_messages(self, callback):
        """Llama a callback(channel_id, msg) por cada mensaje nuevo en un canal
        activo. Telethon ya mantiene la conexion abierta para las descargas,
        asi que escuchar actualizaciones no cuesta peticiones extra. El filtro
        se evalua en cada evento para que los canales añadidos despues cuenten.

        Se compara contra `channel_ids` (todos los canales activos) y no contra
        `channels` (solo los que Telethon ha resuelto): si `get_entity` fallaba
        para un canal, sus mensajes nuevos se descartaban en silencio y lo que
        se publicara ahi no se indexaba nunca.
        """
        from telethon import events

        async def _handler(event):
            chat_id = event.chat_id  # viene como -100XXXXXXXXXX
            for ch in list(self.channel_ids):
                ch_id = ch["id"]
                if self._resolve_channel_id(ch_id) == chat_id:
                    try:
                        await callback(ch_id, event.message)
                    except Exception as e:
                        logger.warning("Error procesando mensaje nuevo del canal %d: %s", ch_id, e)
                    return

        self.client.add_event_handler(_handler, events.NewMessage())
        logger.info("Escuchando mensajes nuevos en %d canales", len(self.channel_ids))

    async def stop(self):
        self._parado = True
        if self.client:
            await self.client.disconnect()

    async def login_interactive(self):
        session_file = self._session_path()
        os.makedirs(os.path.dirname(session_file), exist_ok=True)
        self.client = TelegramClient(session_file, self.api_id, self.api_hash)
        await self.client.connect()

        if not await self.client.is_user_authorized():
            await self.client.send_code_request(self.phone)
            code = input("Introduce el codigo de verificacion de Telegram: ").strip()
            try:
                await self.client.sign_in(self.phone, code)
            except SessionPasswordNeededError:
                password = input("Introduce tu contrasena de verificacion en dos pasos: ").strip()
                await self.client.sign_in(password=password)

        for ch in self.channel_ids:
            await self.client.get_entity(self._resolve_channel_id(ch["id"]))
        print("Login correcto. Sesion guardada en session/user.session")

    async def list_dialogs(self):
        dialogs = []
        async for dialog in self.client.iter_dialogs():
            if dialog.is_user:
                continue
            dialogs.append({
                "id": dialog.id,
                "name": dialog.name,
                "is_channel": dialog.is_channel,
                "is_group": dialog.is_group,
                "is_megagroup": dialog.is_channel and getattr(dialog.entity, "megagroup", False),
            })
        return dialogs

    async def search_messages(self, query, limit=50, offset_id=0, reverse=False, channel_ids=None):
        if channel_ids is None:
            channel_ids = list(self.channels.keys())

        async def _search_one(ch_id):
            ch = self.channels[ch_id]
            msgs = []
            kwargs = {"search": query, "limit": limit, "reverse": reverse}
            if offset_id > 0:
                kwargs["offset_id"] = offset_id
            async for msg in self.client.iter_messages(ch["entity"], **kwargs):
                if msg.media:
                    size = self._get_file_size(msg)
                    if size == 0:
                        continue
                    file_name = self._get_file_name(msg)
                    if not file_name or not self._is_downloadable(file_name):
                        continue
                    msgs.append({
                        "id": msg.id,
                        "date": str(msg.date) if msg.date else "",
                        "text": (msg.text or "")[:200],
                        "file_name": file_name,
                        "size": size,
                        "size_str": self._format_size(size),
                        "channel_id": ch_id,
                        "channel_name": ch["name"],
                    })
            return msgs

        tasks = [_search_one(cid) for cid in channel_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        merged = []
        for r in results:
            if isinstance(r, list):
                merged.extend(r)
        merged.sort(key=lambda x: x["id"], reverse=not reverse)
        return merged[:limit]

    async def get_message(self, message_id):
        for ch_id, ch in self.channels.items():
            try:
                msg = await self.client.get_messages(ch["entity"], ids=message_id)
                if msg:
                    size = self._get_file_size(msg)
                    return {
                        "id": msg.id,
                        "date": str(msg.date) if msg.date else "",
                        "text": (msg.text or "")[:200],
                        "file_name": self._get_file_name(msg),
                        "size": size,
                        "size_str": self._format_size(size),
                        "channel_id": ch_id,
                        "channel_name": ch["name"],
                    }
            except Exception:
                continue
        return None

    async def find_related_parts(self, message_id, channel_id=None):
        msg = None
        ch_data = None
        if channel_id and channel_id in self.channels:
            ch_data = self.channels[channel_id]
            msg = await self.client.get_messages(ch_data["entity"], ids=message_id)
        if not msg:
            for ch_id, ch in self.channels.items():
                try:
                    msg = await self.client.get_messages(ch["entity"], ids=message_id)
                    if msg:
                        ch_data = ch
                        break
                except Exception:
                    continue
        if not msg:
            return None, None, []
        entity = ch_data["entity"]

        file_name = self._get_file_name(msg)
        if not file_name:
            return None, None, []

        base, part_num, archive_type = _detect_multipart(file_name)

        # Cada parte lleva su canal: el message_id se repite entre canales y
        # descargar "el primero que aparezca" traia el archivo equivocado.
        own_channel = next((cid for cid, ch in self.channels.items() if ch is ch_data), channel_id)

        if base is None:
            folder_name = suggest_folder_name(file_name)
            return file_name, folder_name, [{
                "message_id": message_id,
                "file_name": file_name,
                "part_num": 0,
                "size": self._get_file_size(msg),
                "channel_id": own_channel,
            }]

        parts_found = {}
        size = self._get_file_size(msg)
        parts_found[part_num] = {
            "message_id": message_id,
            "file_name": file_name,
            "part_num": part_num,
            "size": size,
            "channel_id": own_channel,
        }

        base_lower = base.lower()

        # Las demas partes, primero en el catalogo. Antes se buscaban siempre
        # en Telegram, una busqueda por canal y una detras de otra: Telegram
        # raciona mucho las busquedas y, al pasarse, Telethon se duerme en
        # silencio hasta un minuto por llamada (FloodWait). El boton de
        # "Descargar" se quedaba sin contestar y parecia que no hacia nada.
        for r in await _partes_en_catalogo(own_channel, base):
            b, p, a = _detect_multipart(r["file_name"])
            if b and b.lower() == base_lower and p not in parts_found:
                parts_found[p] = {
                    "message_id": r["message_id"],
                    "file_name": r["file_name"],
                    "part_num": p,
                    "size": r["file_size"] or 0,
                    "channel_id": r["channel_id"],
                }
        if len(parts_found) > 1:
            parts = [parts_found[p] for p in sorted(parts_found.keys())]
            return base, suggest_folder_name(base), parts

        # Si el catalogo no las tiene (canal sin indexar todavia), Telegram;
        # con tiempo limitado por canal para no colgar la peticion.
        for ch_id, ch in self.channels.items():
            try:
                await asyncio.wait_for(self._buscar_partes(ch_id, ch["entity"], base, base_lower, message_id, parts_found),
                                       timeout=BUSQUEDA_PARTES_S)
            except asyncio.TimeoutError:
                logger.warning("Buscando partes de %s: el canal %s no contesta a tiempo", base, ch.get("name", ch_id))
            except Exception:
                continue

        parts = [parts_found[p] for p in sorted(parts_found.keys())]
        folder_name = suggest_folder_name(base)
        return base, folder_name, parts

    async def _buscar_partes(self, ch_id, ch_entity, base, base_lower, message_id, parts_found):
        async for m in self.client.iter_messages(ch_entity, search=base, limit=100):
            fname = self._get_file_name(m)
            if not fname or m.id == message_id:
                continue
            b, p, a = _detect_multipart(fname)
            if b and b.lower() == base_lower and p not in parts_found:
                parts_found[p] = {
                    "message_id": m.id,
                    "file_name": fname,
                    "part_num": p,
                    "size": self._get_file_size(m),
                    "channel_id": ch_id,
                }

    async def download_to_folder(self, message_id, folder, progress_callback=None, channel_id=None):
        msg = None
        if channel_id and channel_id in self.channels:
            msg = await self.client.get_messages(self.channels[channel_id]["entity"], ids=message_id)
        if not msg:
            for ch_id, ch in self.channels.items():
                try:
                    msg = await self.client.get_messages(ch["entity"], ids=message_id)
                    if msg and msg.media:
                        break
                except Exception:
                    continue
        if not msg or not msg.media:
            raise ValueError("El mensaje no tiene archivo adjunto")

        file_name = self._get_file_name(msg) or f"file_{message_id}"
        file_path = os.path.join(folder, file_name)
        # Ya bajado solo si mide lo que dice Telegram. Bastaba con que pesara
        # algo, y un archivo a medias tambien pesa: una segunda descarga del
        # mismo lote encontraba el que la primera estaba escribiendo, lo daba
        # por hecho y a los tres segundos dejaba en la biblioteca una pelicula
        # cortada.
        esperado = self._get_file_size(msg)
        if os.path.isfile(file_path):
            if esperado and os.path.getsize(file_path) == esperado:
                return file_path
            os.remove(file_path)

        os.makedirs(folder, exist_ok=True)

        def progress(current, total):
            if progress_callback:
                progress_callback(message_id, current, total)

        # Se baja a `<nombre>.parcial` y solo se renombra al acabar: en paralelo
        # el ultimo trozo puede escribirse antes que los del medio, y entonces
        # el archivo mide lo que tiene que medir sin estar entero. Con el
        # nombre final solo existe lo que esta completo.
        parcial = file_path + SUFIJO_PARCIAL
        if self.conexiones > 1:
            try:
                await descarga_paralela.bajar(self.client, msg, parcial, self.conexiones, progress)
                os.replace(parcial, file_path)
                return file_path
            except descarga_paralela.SinParalelo as e:
                logger.warning("Descarga en paralelo no disponible para %s (%s): se baja de la forma normal",
                               file_name, e)

        await self.client.download_media(msg, file=parcial, progress_callback=progress)
        os.replace(parcial, file_path)
        return file_path

    def _get_file_name(self, msg):
        if hasattr(msg, "file") and msg.file and msg.file.name:
            return msg.file.name
        if hasattr(msg, "document") and msg.document:
            for attr in msg.document.attributes:
                if hasattr(attr, "file_name") and attr.file_name:
                    return attr.file_name
        return None

    def _get_file_size(self, msg):
        if hasattr(msg, "document") and msg.document:
            return getattr(msg.document, "size", 0)
        if hasattr(msg, "file") and msg.file:
            return getattr(msg.file, "size", 0)
        return 0

    @staticmethod
    def _is_downloadable(file_name):
        f = file_name.lower()
        if f.endswith(('.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts',
                       '.rar', '.zip', '.7z',
                       '.tar.gz', '.tar.bz2', '.tar', '.tgz', '.tbz2')):
            return True
        if '.part' in f and f.endswith('.rar'):
            return True
        if re.search(r'\.r\d{2,}$', f):
            return True
        if re.search(r'\.\d{3,}$', f):
            return True
        return False

    @staticmethod
    def _format_size(bytes_val):
        if bytes_val is None or bytes_val == 0:
            return "0 B"
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if bytes_val < 1024:
                return f"{bytes_val:.1f} {unit}"
            bytes_val /= 1024
        return f"{bytes_val:.1f} PB"
