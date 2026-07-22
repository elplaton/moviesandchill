import argparse
import asyncio
import json
import os
import sys
import uvicorn

from dotenv import load_dotenv
from telegram_client import TelegramDownloader

CONFIG_FILE = "config.json"


def load_config():
    if not os.path.exists(CONFIG_FILE):
        print("[!] config.json no encontrado. Ejecuta primero: python main.py setup")
        sys.exit(1)
    with open(CONFIG_FILE) as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


def _apply_env_overrides(cfg):
    env_map = {
        "api_id": ("TMD_API_ID", int),
        "api_hash": ("TMD_API_HASH", str),
        "phone": ("TMD_PHONE", str),
        "channels": ("TMD_CHANNELS", json.loads),
        "download_path": ("TMD_DOWNLOAD_PATH", str),
        "extract_path": ("TMD_EXTRACT_PATH", str),
        "server_host": ("TMD_SERVER_HOST", str),
        "server_port": ("TMD_SERVER_PORT", int),
        "download_parallel": ("TMD_DOWNLOAD_PARALLEL", int),
        "stream_max": ("TMD_STREAM_MAX", int),
    }
    for key, (env_var, cast) in env_map.items():
        val = os.getenv(env_var)
        if val is not None:
            try:
                cfg[key] = cast(val)
            except (ValueError, json.JSONDecodeError):
                print(f"[!] Valor invalido para {env_var}: {val}")

    for bool_key, env_var in [
        ("delete_archives_after_extract", "TMD_DELETE_ARCHIVES"),
        ("convert_dts_to_ac3", "TMD_CONVERT_DTS"),
    ]:
        val = os.getenv(env_var)
        if val is not None:
            cfg[bool_key] = val.lower() in ("1", "true", "yes", "s", "si")

    log_level = os.getenv("LOG_LEVEL")
    if log_level:
        cfg["log_level"] = log_level.upper()


async def cmd_setup():
    print("=" * 50)
    print("  TELEGRAM MOVIE DOWNLOADER - Configuracion inicial")
    print("=" * 50)
    print()

    cfg = {}
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            cfg = json.load(f)
        print("(config.json existente detectado. Se usaran sus valores como predeterminados)")
        print()

    api_id = input(f"API ID [{cfg.get('api_id', '')}]: ").strip()
    cfg["api_id"] = int(api_id) if api_id else cfg.get("api_id")

    api_hash = input(f"API Hash [{cfg.get('api_hash', '')}]: ").strip()
    cfg["api_hash"] = api_hash if api_hash else cfg.get("api_hash", "")

    phone = input(f"Numero de telefono (con prefijo, ej: +34123456789) [{cfg.get('phone', '')}]: ").strip()
    cfg["phone"] = phone if phone else cfg.get("phone", "")

    print()
    print("Configuracion de canales de Telegram.")
    print("  Si no sabes los IDs, ejecuta: python main.py list-channels")
    print("  Deben ser numeros, ej: -1001234567890")
    channels = cfg.get("channels", [])
    if not channels and cfg.get("channel_id"):
        channels = [{"id": cfg["channel_id"], "name": "Canal principal"}]
    if channels:
        print("  Canales actuales:")
        for c in channels:
            print(f"    {c['id']} - {c['name']}")
    while True:
        ch_id_str = input(f"  ID del canal (Enter para terminar): ").strip()
        if not ch_id_str:
            break
        ch_name = input(f"  Nombre del canal: ").strip() or f"Canal {ch_id_str}"
        channels.append({"id": int(ch_id_str), "name": ch_name})
    cfg["channels"] = channels
    cfg.pop("channel_id", None)

    download_path = input(f"Ruta de descarga temporal [{cfg.get('download_path', '/mnt/disco/descargas')}]: ").strip()
    cfg["download_path"] = download_path if download_path else cfg.get("download_path", "/mnt/disco/descargas")

    extract_path = input(f"Ruta de destino final (HDD) [{cfg.get('extract_path', '/mnt/disco/peliculas')}]: ").strip()
    cfg["extract_path"] = extract_path if extract_path else cfg.get("extract_path", "/mnt/disco/peliculas")

    host = input(f"Host del servidor [{cfg.get('server_host', '0.0.0.0')}]: ").strip()
    cfg["server_host"] = host if host else cfg.get("server_host", "0.0.0.0")

    port_str = input(f"Puerto del servidor [{cfg.get('server_port', 8000)}]: ").strip()
    cfg["server_port"] = int(port_str) if port_str else cfg.get("server_port", 8000)

    delete = input(f"Borrar archivos comprimidos tras extraer? (s/n) [{'s' if cfg.get('delete_archives_after_extract', True) else 'n'}]: ").strip().lower()
    if delete in ("s", "si", "n", "no"):
        cfg["delete_archives_after_extract"] = delete in ("s", "si")

    save_config(cfg)
    print()
    print("[OK] config.json guardado.")

    if not cfg.get("api_id") or not cfg.get("api_hash") or not cfg.get("phone"):
        print("[!] API ID, API Hash y telefono son obligatorios. Completa config.json manualmente.")
        return

    print()
    print("--- Iniciando sesion en Telegram ---")
    os.makedirs("session", exist_ok=True)
    downloader = TelegramDownloader(cfg)
    await downloader.login_interactive()
    await downloader.stop()

    print()
    print("=" * 50)
    print("  Configuracion completada.")
    print(f"  Para arrancar el servidor: python main.py serve")
    print(f"  Luego abre: http://<ip-raspberry>:{cfg['server_port']}")
    print("=" * 50)


async def cmd_list_channels():
    cfg = load_config()
    _apply_env_overrides(cfg)
    if not cfg.get("api_id") or not cfg.get("api_hash"):
        print("[!] API ID y API Hash son obligatorios. Ejecuta: python main.py setup")
        return

    print("Conectando a Telegram...")
    os.makedirs("session", exist_ok=True)
    downloader = TelegramDownloader(cfg)

    session_file = os.path.join("session", "user")
    from telethon import TelegramClient
    downloader.client = TelegramClient(session_file, cfg["api_id"], cfg["api_hash"])
    await downloader.client.start(phone=cfg["phone"])

    print()
    print("=" * 80)
    print(f"{'ID':<20} {'Tipo':<12} Nombre")
    print("=" * 80)

    async for dialog in downloader.client.iter_dialogs():
        tipo = "Canal" if dialog.is_channel else ("Grupo" if dialog.is_group else "Chat")
        print(f"{dialog.id:<20} {tipo:<12} {dialog.name}")

    print("=" * 80)
    print()
    print("Busca tu canal privado en la lista. El ID que necesitas es el numero de la primera columna.")
    print("Copialo y usalo en: python main.py setup")
    await downloader.stop()


def cmd_serve():
    cfg = load_config()
    _apply_env_overrides(cfg)
    print("=" * 50)
    print("  TELEGRAM MOVIE DOWNLOADER")
    print("=" * 50)
    print(f"  Servidor: http://{cfg['server_host']}:{cfg['server_port']}")
    print(f"  Descargas temporales: {cfg['download_path']}")
    print(f"  Destino final:        {cfg['extract_path']}")
    print("=" * 50)
    print()

    uvicorn.run(
        "web_server:app",
        host=cfg["server_host"],
        port=cfg["server_port"],
        reload=False,
    )


def main():
    load_dotenv()
    commands = ["setup", "list-channels", "serve"]
    parser = argparse.ArgumentParser(
        description="Telegram Movie Downloader - Descarga peliculas y series desde canales de Telegram"
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=commands,
        help="Comando a ejecutar",
    )
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if args.command == "setup":
        asyncio.run(cmd_setup())
    elif args.command == "list-channels":
        asyncio.run(cmd_list_channels())
    elif args.command == "serve":
        cmd_serve()


if __name__ == "__main__":
    main()
