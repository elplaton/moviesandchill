import asyncio
import logging
import os
import re
from datetime import datetime, timedelta

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

from app.services.storage import _detect_multipart, suggest_folder_name, create_movie_folder

logger = logging.getLogger("tmd")


class TelegramDownloader:
    def __init__(self, config):
        self.api_id = config["api_id"]
        self.api_hash = config["api_hash"]
        self.phone = config["phone"]
        self.download_path = config["download_path"]
        self.client = None
        self.active_batches = {}
        self.channel_ids = []
        self.channels = {}
        self._config_channels = config.get("channels") or []
        self.session_dir = None

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

    async def start(self):
        session_file = self._session_path()
        os.makedirs(os.path.dirname(session_file), exist_ok=True)
        self.client = TelegramClient(session_file, self.api_id, self.api_hash)
        await self.client.start(phone=self.phone)
        for ch in self.channel_ids:
            try:
                ref = self._resolve_channel_id(ch["id"])
                entity = await self.client.get_entity(ref)
                self.channels[ch["id"]] = {"entity": entity, "name": ch["name"]}
            except Exception as e:
                logger.warning("No se pudo resolver canal %d: %s", ch["id"], e)

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

    async def stop(self):
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

        if base is None:
            folder_name = suggest_folder_name(file_name)
            return file_name, folder_name, [{
                "message_id": message_id,
                "file_name": file_name,
                "part_num": 0,
                "size": self._get_file_size(msg),
            }]

        parts_found = {}
        size = self._get_file_size(msg)
        parts_found[part_num] = {
            "message_id": message_id,
            "file_name": file_name,
            "part_num": part_num,
            "size": size,
        }

        base_lower = base.lower()
        for ch_id, ch in self.channels.items():
            try:
                ch_entity = ch["entity"]
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
                        }
            except Exception:
                continue

        parts = [parts_found[p] for p in sorted(parts_found.keys())]
        folder_name = suggest_folder_name(base)
        return base, folder_name, parts

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
        if os.path.isfile(file_path) and os.path.getsize(file_path) > 0:
            return file_path

        os.makedirs(folder, exist_ok=True)

        def progress(current, total):
            if progress_callback:
                progress_callback(message_id, current, total)

        await self.client.download_media(msg, file=file_path, progress_callback=progress)
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
