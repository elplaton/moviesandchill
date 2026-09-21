import json
import logging
import os

from dotenv import load_dotenv

ENV_FILE = ".env"

logger = logging.getLogger("tmd")

# Secretos que nunca deben usarse en produccion: si TMD_JWT_SECRET vale uno de
# estos (o es demasiado corto) cualquiera podria firmarse un token de admin.
INSECURE_JWT_SECRETS = {
    "",
    "default-secret-change-me",
    "cambia-este-secreto-por-algo-aleatorio-y-muy-largo",
}
MIN_JWT_SECRET_LEN = 16

_cached_config: dict | None = None


def _find_env() -> str | None:
    for base in [os.getcwd(), os.path.dirname(os.path.dirname(__file__))]:
        path = os.path.join(base, ENV_FILE)
        if os.path.isfile(path):
            return path
    return None


def load_config(force_reload: bool = False) -> dict:
    """Devuelve la configuracion. Se cachea porque se consulta en cada peticion
    (via get_jwt_secret) y releer el .env cada vez es I/O de disco inutil."""
    global _cached_config
    if _cached_config is not None and not force_reload:
        return _cached_config

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
        "jwt_secret": os.getenv("TMD_JWT_SECRET", ""),
        "database_url": os.getenv("TMD_DATABASE_URL", "postgresql://movieapp:movieapp123@db:5432/moviesandchill"),
        "tmdb_api_key": os.getenv("TMD_TMBD_API_KEY", ""),
        "tmdb_enabled": _env_bool("TMD_TMDB_ENABLED", False),
        "state_dir": os.getenv("TMD_STATE_DIR", ""),
        "cors_origins": _env_list("TMD_CORS_ORIGINS", ["*"]),
        "log_unit": os.getenv("TMD_LOG_UNIT", "telegram-movie"),
    }

    log_level = os.getenv("LOG_LEVEL")
    if log_level:
        cfg["log_level"] = log_level.upper()
        logging.getLogger().setLevel(getattr(logging, log_level.upper(), logging.INFO))

    _cached_config = cfg
    return cfg


def get_jwt_secret() -> str:
    """Secreto para firmar JWT. Aborta si no esta configurado: arrancar con un
    secreto por defecto permitiria a cualquiera emitirse tokens de admin."""
    secret = load_config().get("jwt_secret", "")
    if secret in INSECURE_JWT_SECRETS or len(secret) < MIN_JWT_SECRET_LEN:
        raise RuntimeError(
            "TMD_JWT_SECRET no esta configurado o es demasiado debil "
            f"(minimo {MIN_JWT_SECRET_LEN} caracteres). Genera uno con:\n"
            '  python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
    return secret


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


def _env_list(key: str, default: list[str]) -> list[str]:
    val = os.getenv(key)
    if val is not None:
        items = [v.strip() for v in val.split(",") if v.strip()]
        if items:
            return items
    return default


def _env_json(key: str, default):
    val = os.getenv(key)
    if val is not None:
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            logger.warning("JSON invalido para %s: %s", key, val)
    return default
