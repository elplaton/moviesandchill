import argparse
import asyncio
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

ENV_FILE = ".env"
CHANNELS_FILE = "channels.json"


def _read_env_file() -> list[str]:
    if os.path.isfile(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            return f.readlines()
    return []


def _write_env_file(lines: list[str]):
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(lines)


def _set_env_var(lines: list[str], key: str, value: str):
    key_eq = f"{key}="
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(key_eq) or stripped.startswith(f"# {key_eq}") or stripped.startswith(f"#{key_eq}"):
            lines[i] = f"{key_eq}{value}\n"
            return
    lines.append(f"{key_eq}{value}\n")


def _get_env_var(key: str) -> str | None:
    val = os.getenv(key)
    if val is not None:
        return val
    lines = _read_env_file()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(f"{key}=") and not stripped.startswith("#"):
            return stripped.split("=", 1)[1].strip()
    return None


def _load_channels() -> list[dict]:
    try:
        from app.database.connection import get_pool
        import asyncio
        if get_pool():
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                future = concurrent.futures.Future()

                async def _get():
                    from app.database.connection import get_active_channels
                    return await get_active_channels()

                return asyncio.ensure_future(_get()).result()
            else:
                from app.database.connection import get_active_channels
                return asyncio.run(get_active_channels()) if asyncio.iscoroutinefunction(get_active_channels) else []
    except Exception:
        pass
    if os.path.isfile(CHANNELS_FILE):
        with open(CHANNELS_FILE) as f:
            return json.load(f)
    channels_str = os.getenv("TMD_CHANNELS")
    if channels_str:
        try:
            return json.loads(channels_str)
        except json.JSONDecodeError:
            pass
    return []


def _save_channels(channels: list[dict]):
    with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
        json.dump(channels, f, indent=2)


async def cmd_setup():
    print("=" * 50)
    print("  TELEGRAM MOVIE DOWNLOADER - Configuracion inicial")
    print("=" * 50)
    print()
    print("Este asistente crea/actualiza tu archivo .env con la configuracion necesaria.")
    print()

    lines = _read_env_file() if os.path.isfile(ENV_FILE) else []

    def _prompt(label, key, default=""):
        current = _get_env_var(key) or default
        val = input(f"{label} [{current}]: ").strip()
        final = val if val else current
        if final:
            _set_env_var(lines, key, final)
        return final

    _prompt("API ID", "TMD_API_ID")
    _prompt("API Hash", "TMD_API_HASH")
    _prompt("Telefono con prefijo (+34...)", "TMD_PHONE")

    print()
    print("Canales de Telegram (IDs, ej: -1001234567890).")
    print("  Puedes anadirlos mas tarde desde la web en /channels.")
    existing = _load_channels()
    if existing:
        print("  Canales actuales:")
        for c in existing:
            print(f"    {c['id']} - {c['name']}")
    channels = []
    while True:
        ch_id_str = input("  ID del canal (Enter para terminar): ").strip()
        if not ch_id_str:
            break
        ch_name = input("  Nombre del canal: ").strip() or f"Canal {ch_id_str}"
        channels.append({"id": int(ch_id_str), "name": ch_name})
    if channels:
        _set_env_var(lines, "TMD_CHANNELS", json.dumps(channels))
        _save_channels(channels)

    _prompt("Ruta descargas temporales", "TMD_DOWNLOAD_PATH", "/app/downloads")
    _prompt("Ruta destino final", "TMD_EXTRACT_PATH", "/app/movies")
    _prompt("Host", "TMD_SERVER_HOST", "0.0.0.0")
    _prompt("Puerto", "TMD_SERVER_PORT", "8000")
    _prompt("JWT Secret", "TMD_JWT_SECRET", "cambiar-por-secreto-largo")
    _prompt("Database URL", "TMD_DATABASE_URL", "postgresql://movieapp:movieapp123@db:5432/moviesandchill")
    _prompt("TMDB API Key", "TMD_TMBD_API_KEY")

    lines = [l for l in lines if "TMD_ORACLE" not in l.upper()]

    _write_env_file(lines)
    print()
    print("[OK] .env guardado.")

    api_id_val = _get_env_var("TMD_API_ID")
    api_hash_val = _get_env_var("TMD_API_HASH")
    phone_val = _get_env_var("TMD_PHONE")

    if not api_id_val or not api_hash_val or not phone_val:
        print("[!] API ID, API Hash y telefono son obligatorios.")
        return

    print()
    print("--- Iniciando sesion en Telegram ---")
    session_dir = os.path.join(os.path.dirname(__file__), "..", "session")
    os.makedirs(session_dir, exist_ok=True)
    from app.config import load_config
    cfg = load_config()
    from app.services.telegram_client import TelegramDownloader
    downloader = TelegramDownloader(cfg)
    downloader.session_dir = session_dir
    await downloader.login_interactive()
    await downloader.stop()

    print()
    print("=" * 50)
    print("  Configuracion completada.")
    print(f"  Arranca con: python main.py serve")
    print(f"  Abre: http://<ip>:{_get_env_var('TMD_SERVER_PORT') or '8000'}")
    print("=" * 50)


async def cmd_list_channels():
    api_id_val = _get_env_var("TMD_API_ID")
    api_hash_val = _get_env_var("TMD_API_HASH")
    phone_val = _get_env_var("TMD_PHONE")
    if not api_id_val or not api_hash_val or not phone_val:
        print("[!] API ID, API Hash y telefono son obligatorios. Ejecuta: python main.py setup")
        return

    print("Conectando a Telegram...")
    os.makedirs("session", exist_ok=True)
    from telethon import TelegramClient

    session_file = os.path.join("session", "user")
    client = TelegramClient(session_file, int(api_id_val), api_hash_val)
    await client.start(phone=phone_val)

    print()
    print("=" * 80)
    print(f"{'ID':<20} {'Tipo':<12} Nombre")
    print("=" * 80)

    async for dialog in client.iter_dialogs():
        tipo = "Canal" if dialog.is_channel else ("Grupo" if dialog.is_group else "Chat")
        print(f"{dialog.id:<20} {tipo:<12} {dialog.name}")

    print("=" * 80)
    print()
    print("El ID que necesitas es el numero de la primera columna.")
    print("Anadelo con: python main.py add-channel <ID>")
    await client.disconnect()


async def cmd_add_channel(url_or_id: str):
    api_id_val = _get_env_var("TMD_API_ID")
    api_hash_val = _get_env_var("TMD_API_HASH")
    phone_val = _get_env_var("TMD_PHONE")
    if not api_id_val or not api_hash_val or not phone_val:
        print("[!] API ID, API Hash y telefono son obligatorios. Ejecuta: python main.py setup")
        return

    match = re.match(r'(?:https?://)?t\.me/(c/)?(-?\d+)(?:/\d+)?', url_or_id.strip())
    if match:
        if match.group(1) == "c/" or match.group(2):
            entity_input = int(f"-100{match.group(2)}" if not match.group(2).startswith("-") else match.group(2))
        else:
            entity_input = match.group(1)
    else:
        try:
            entity_input = int(url_or_id.strip())
        except ValueError:
            match = re.match(r'(?:https?://)?t\.me/([a-zA-Z][\w]+)', url_or_id.strip())
            if match:
                entity_input = match.group(1)
            else:
                print(f"[!] Formato no valido: {url_or_id}")
                print("    Formatos soportados: URL de Telegram, ID numerico, o @username")
                return

    print("Conectando a Telegram...")
    from telethon import TelegramClient
    os.makedirs("session", exist_ok=True)
    client = TelegramClient(os.path.join("session", "user"), int(api_id_val), api_hash_val)
    await client.start(phone=phone_val)

    try:
        entity = await client.get_entity(entity_input)
        name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Sin nombre"
        ch_id = entity.id
    except Exception as e:
        print(f"[!] No se pudo resolver el canal: {e}")
        await client.disconnect()
        return

    await client.disconnect()

    channels = _load_channels()
    existing = [c for c in channels if c.get("id") == ch_id]
    if existing:
        print(f"[i] El canal '{existing[0]['name']}' (ID: {ch_id}) ya existe. Actualizando nombre.")
        existing[0]["name"] = name
    else:
        channels.append({"id": ch_id, "name": name})
        print(f"[+] Canal anadido: {name} (ID: {ch_id})")

    _save_channels(channels)
    lines = _read_env_file() if os.path.isfile(ENV_FILE) else []
    _set_env_var(lines, "TMD_CHANNELS", json.dumps(channels))
    _write_env_file(lines)


def cmd_serve():
    from app.config import load_config
    cfg = load_config()
    print("=" * 50)
    print("  TELEGRAM MOVIE DOWNLOADER")
    print("=" * 50)
    print(f"  Servidor: http://{cfg['server_host']}:{cfg['server_port']}")
    print(f"  Descargas temporales: {cfg['download_path']}")
    print(f"  Destino final:        {cfg['extract_path']}")
    print("=" * 50)
    print()

    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=cfg["server_host"],
        port=cfg["server_port"],
        reload=False,
    )


def main():
    commands = ["setup", "list-channels", "add-channel", "serve"]
    parser = argparse.ArgumentParser(
        description="Telegram Movie Downloader"
    )
    parser.add_argument("command", nargs="?", choices=commands, help="Comando a ejecutar")
    parser.add_argument("url", nargs="?", help="URL o ID del canal (solo para add-channel)")
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if args.command == "setup":
        asyncio.run(cmd_setup())
    elif args.command == "list-channels":
        asyncio.run(cmd_list_channels())
    elif args.command == "add-channel":
        if not args.url:
            print("[!] Debes pasar la URL o ID del canal. Ej: python main.py add-channel https://t.me/c/123/456")
            return
        asyncio.run(cmd_add_channel(args.url))
    elif args.command == "serve":
        cmd_serve()


if __name__ == "__main__":
    main()
