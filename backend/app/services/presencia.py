"""Cuándo ha usado cada cuenta la aplicación por última vez.

Lo apuntan las dependencias de autenticación (auth/dependencies.py) en cada
petición con token: navegar, buscar, reproducir (cada tramo del vídeo pide con
la entrada de reproducción, así que ver una película también cuenta) y el
WebSocket de progreso. Apuntar es poner una hora en un diccionario, sin tocar la
base de datos: escribir en `users` en cada petición sería una escritura por
cada tramo de vídeo. Una vez por minuto se vuelca lo nuevo a
`users.last_seen_at`, que es lo que sobrevive a un reinicio.

«En línea» es haber hecho algo en los últimos `EN_LINEA_S`. Un reproductor en
marcha pide tramos sin parar y una portada abierta reconecta el WebSocket, así
que quien está mirando la app no se cae de la lista; quien la ha cerrado, sí.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger("tmd")

EN_LINEA_S = 5 * 60
VOLCAR_CADA_S = 60
# Las peticiones que hace el propio servidor (ffprobe, el HLS al vuelo, el
# análisis de créditos) llevan una entrada de reproducción a su nombre.
NO_ES_NADIE = {"sistema"}

# cuenta -> epoch de lo último que ha hecho
_vistos: dict[str, float] = {}
# Lo que aún no se ha escrito en la base de datos.
_pendientes: set[str] = set()


def ver(usuario: str | None) -> None:
    if not usuario or usuario in NO_ES_NADIE:
        return
    _vistos[usuario] = time.time()
    _pendientes.add(usuario)


def ultima_vez(usuario: str, en_bd: datetime | None) -> datetime | None:
    """Lo más reciente entre lo guardado y lo que aún está en memoria."""
    t = _vistos.get(usuario)
    en_memoria = datetime.fromtimestamp(t, timezone.utc) if t else None
    if en_bd is not None and en_bd.tzinfo is None:
        en_bd = en_bd.replace(tzinfo=timezone.utc)
    candidatos = [x for x in (en_bd, en_memoria) if x is not None]
    return max(candidatos) if candidatos else None


def en_linea(ultima: datetime | None) -> bool:
    return ultima is not None and (datetime.now(timezone.utc) - ultima).total_seconds() < EN_LINEA_S


def cuantos_en_linea() -> int:
    """Cuentas con algo hecho en los últimos EN_LINEA_S (solo hace falta la
    memoria: nadie puede estar en línea desde antes del último arranque)."""
    limite = time.time() - EN_LINEA_S
    return sum(1 for t in _vistos.values() if t >= limite)


async def volcar() -> None:
    """Escribe lo pendiente. Si falla, se queda pendiente para la siguiente."""
    if not _pendientes:
        return
    from app.database.connection import get_pool
    pool = get_pool()
    if not pool:
        return
    lote = [(u, _vistos[u]) for u in list(_pendientes) if u in _vistos]
    try:
        async with pool.acquire() as conn:
            # Nunca hacia atrás: si dos procesos escribieran, gana la más nueva.
            await conn.executemany("""
                UPDATE users SET last_seen_at = to_timestamp($2)
                WHERE username = $1 AND (last_seen_at IS NULL OR last_seen_at < to_timestamp($2))
            """, lote)
        for u, t in lote:
            if _vistos.get(u) == t:
                _pendientes.discard(u)
    except Exception as e:
        logger.warning("No se pudo guardar la última conexión de %d cuentas: %s", len(lote), e)


async def bucle() -> None:
    while True:
        await asyncio.sleep(VOLCAR_CADA_S)
        await volcar()
