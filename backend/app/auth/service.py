import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from app.database.connection import get_user_by_username

logger = logging.getLogger("tmd")

ALGORITHM = "HS256"
ACCESS_EXPIRE_MINUTES = 60
REFRESH_EXPIRE_DAYS = 7

PBKDF2_ITERATIONS = 240_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        parts = password_hash.split("$")
        if len(parts) == 4 and parts[0] == "pbkdf2_sha256":
            _, iterations, salt, expected = parts
            dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations))
            return hmac.compare_digest(dk.hex(), expected)
        # Formato heredado (salt$sha256). Se acepta para no invalidar los usuarios
        # ya existentes; authenticate() lo reescribe a PBKDF2 al primer login.
        if len(parts) == 2:
            salt, expected = parts
            computed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
            return hmac.compare_digest(computed, expected)
    except Exception:
        return False
    return False


def needs_rehash(password_hash: str) -> bool:
    return not password_hash.startswith("pbkdf2_sha256$")


def create_access_token(username: str, secret: str) -> str:
    payload = {
        "sub": username,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def create_refresh_token(username: str, secret: str) -> str:
    payload = {
        "sub": username,
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_token(token: str, secret: str, expected_type: str = "access") -> dict | None:
    """Valida un JWT. `expected_type` debe coincidir con el claim `type`.

    Usar expected_type="refresh" para los refresh tokens: con el valor por
    defecto ("access") siempre devolverian None.
    """
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        # ExpiredSignatureError hereda de InvalidTokenError
        return None
    if expected_type and payload.get("type") != expected_type:
        return None
    if not payload.get("sub"):
        return None
    return payload


async def authenticate(username: str, password: str) -> str | None:
    user = await get_user_by_username(username)
    if not user or not verify_password(password, user["password_hash"]):
        return None
    if needs_rehash(user["password_hash"]):
        try:
            from app.database.users import update_password_hash
            await update_password_hash(username, hash_password(password))
            logger.info("Hash de contrasena migrado a PBKDF2 | user=%s", username)
        except Exception as e:
            logger.warning("No se pudo migrar el hash de %s: %s", username, e)
    return username
