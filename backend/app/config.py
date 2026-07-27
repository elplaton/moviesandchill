import json
import logging
import os

from dotenv import load_dotenv

ENV_FILE = ".env"

logger = logging.getLogger("tmd")


def _find_env() -> str | None:
    for base in [os.getcwd(), os.path.dirname(os.path.dirname(__file__))]:
        path = os.path.join(base, ENV_FILE)
        if os.path.isfile(path):
            return path
    return None


def load_config() -> dict:
    env_path = _find_env()
    if env_path:
        load_dotenv(env_path)
    else:
        load_dotenv()

    cfg = {
        "api_id": _env_int("TMD_API_ID", 0),
        "api_hash": os.getenv("TMD_API_HASH", ""),
        "phone": os.getenv("TMD_PHONE", ""),
        "channels": _env_json("TMD_CHANNELS", []),
        "download_path": os.getenv("TMD_DOWNLOAD_PATH", "/app/downloads"),
        "extract_path": os.getenv("TMD_EXTRACT_PATH", "/app/movies"),
        "server_host": os.getenv("TMD_SERVER_HOST", "0.0.0.0"),
        "server_port": _env_int("TMD_SERVER_PORT", 8000),
        "download_parallel": _env_int("TMD_DOWNLOAD_PARALLEL", 3),
        "stream_max": _env_int("TMD_STREAM_MAX", 3),
        "delete_archives_after_extract": _env_bool("TMD_DELETE_ARCHIVES", True),
        "convert_dts_to_ac3": _env_bool("TMD_CONVERT_DTS", True),
        "jwt_secret": os.getenv("TMD_JWT_SECRET", "default-secret-change-me"),
        "database_url": os.getenv("TMD_DATABASE_URL", "postgresql://movieapp:movieapp123@db:5432/moviesandchill"),
        "tmdb_api_key": os.getenv("TMD_TMBD_API_KEY", ""),
        "tmdb_enabled": _env_bool("TMD_TMDB_ENABLED", False),
    }

    log_level = os.getenv("LOG_LEVEL")
    if log_level:
        cfg["log_level"] = log_level.upper()
        logging.getLogger().setLevel(getattr(logging, log_level.upper(), logging.INFO))

    return cfg


def _env_int(key: str, default: int) -> int:
    val = os.getenv(key)
    if val is not None:
        try:
            return int(val)
        except ValueError:
            logger.warning("Valor invalido para %s: %s", key, val)
    return default


def _env_bool(key: str, default: bool) -> bool:
    val = os.getenv(key)
    if val is not None:
        return val.lower() in ("1", "true", "yes", "s", "si")
    return default


def _env_json(key: str, default):
    val = os.getenv(key)
    if val is not None:
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            logger.warning("JSON invalido para %s: %s", key, val)
    return default
