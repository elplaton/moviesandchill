import logging

import asyncpg

logger = logging.getLogger("tmd")

_pool: asyncpg.Pool | None = None


def get_pool():
    return _pool


async def init_pool(dsn: str):
    global _pool
    _pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=5)
    await _ensure_tables()
    logger.info("PostgreSQL pool iniciado")


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def _ensure_tables():
    if not _pool:
        return
    async with _pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id          SERIAL PRIMARY KEY,
                username    VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role        VARCHAR(20) DEFAULT 'user',
                created_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS channels (
                id          SERIAL PRIMARY KEY,
                channel_id  BIGINT NOT NULL UNIQUE,
                name        VARCHAR(255) NOT NULL,
                active      BOOLEAN DEFAULT TRUE,
                added_at    TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS media_items (
                id              SERIAL PRIMARY KEY,
                channel_id      BIGINT NOT NULL,
                channel_name    VARCHAR(255),
                message_id      INTEGER NOT NULL,
                file_name       VARCHAR(500) NOT NULL,
                file_size       BIGINT,
                size_str        VARCHAR(50),
                clean_title     VARCHAR(300),
                media_type      VARCHAR(10),
                season          INTEGER,
                episode         INTEGER,
                tags            TEXT[],
                tmdb_id         INTEGER,
                tmdb_valid      BOOLEAN,
                tmdb_searched   BOOLEAN DEFAULT FALSE,
                indexed_at      TIMESTAMP DEFAULT NOW(),
                UNIQUE(channel_id, message_id)
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS tmdb_cache (
                tmdb_id         INTEGER PRIMARY KEY,
                media_type      VARCHAR(10) NOT NULL,
                title           VARCHAR(300),
                original_title  VARCHAR(300),
                year            INTEGER,
                rating          NUMERIC(4,2),
                poster          VARCHAR(500),
                backdrop        VARCHAR(500),
                overview        TEXT,
                genres          TEXT[],
                runtime         INTEGER,
                seasons_count   INTEGER,
                cached_at       TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS index_progress (
                channel_id      BIGINT PRIMARY KEY,
                last_message_id INTEGER DEFAULT 0,
                total_indexed   INTEGER DEFAULT 0,
                total_scanned   INTEGER DEFAULT 0,
                total_estimate  INTEGER DEFAULT 0,
                status          VARCHAR(20) DEFAULT 'pending'
            )
        """)
        # Registro de novedades: que ha llegado en vivo a cada canal y si se ha
        # indexado o no. Sirve para comprobar de un vistazo que la escucha de
        # mensajes nuevos funciona, cosa que antes solo se veia en los logs.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS novedades (
                id           SERIAL PRIMARY KEY,
                channel_id   BIGINT,
                channel_name VARCHAR(255),
                message_id   INTEGER,
                file_name    VARCHAR(500),
                media_type   VARCHAR(10),
                season       INTEGER,
                episode      INTEGER,
                clean_title  VARCHAR(300),
                indexed      BOOLEAN DEFAULT FALSE,
                reason       VARCHAR(120),
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_novedades_fecha ON novedades (created_at DESC)")

        # Ajustes que se editan desde el panel. Viven en la BD y no en el .env
        # porque en un despliegue tipo Coolify el .env lo regenera la plataforma
        # en cada redespliegue: lo que se guarde aqui es lo unico que sobrevive.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key        VARCHAR(100) PRIMARY KEY,
                value      TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id       INTEGER PRIMARY KEY REFERENCES users(id),
                liked_movies  INTEGER[],
                liked_series  INTEGER[],
                genres        JSONB,
                created_at    TIMESTAMP DEFAULT NOW()
            )
        """)
        # Favoritos por cuenta. media_type guarda el tipo de TMDB ('movie'/'tv')
        # porque peliculas y series tienen espacios de ids independientes: sin
        # el tipo, el favorito de tv/606 y el de movie/606 serian el mismo.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_favorites (
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                tmdb_id     INTEGER NOT NULL,
                media_type  VARCHAR(10) NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, tmdb_id, media_type)
            )
        """)
        # Por donde va cada cuenta en cada archivo. La clave es la ruta
        # **relativa** a la biblioteca: la absoluta cambia entre Docker y el
        # modo de desarrollo, y entonces el mismo video seria otro.
        #
        # `grupo` es la carpeta del titulo (la de primer nivel dentro de la
        # biblioteca) y es lo que hace que "Continuar viendo" enseñe **una
        # tarjeta por titulo**: los episodios de una serie y las dos calidades
        # de una pelicula comparten grupo, asi que solo sale el mas reciente.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS playback_progress (
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                path       VARCHAR(1000) NOT NULL,
                grupo      VARCHAR(500) NOT NULL,
                title      VARCHAR(500),
                subtitle   VARCHAR(300),
                poster     VARCHAR(500),
                backdrop   VARCHAR(500),
                tmdb_id    INTEGER,
                tmdb_type  VARCHAR(10),
                season     INTEGER,
                episode    INTEGER,
                position   DOUBLE PRECISION NOT NULL DEFAULT 0,
                duration   DOUBLE PRECISION NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, path)
            )
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_progress_reciente
            ON playback_progress (user_id, updated_at DESC)
        """)
        # Series que sigue cada cuenta, para avisar de los episodios nuevos.
        #
        # Una fila desactivada (`active = false`) NO es lo mismo que no tener
        # fila: es "ya le dije que no". Hace falta porque el seguimiento tambien
        # se activa solo al ver un episodio, y sin esa marca la serie que
        # alguien dejo de seguir volveria a seguirse en cuanto reprodujera algo.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS series_follows (
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                tmdb_id    INTEGER NOT NULL,
                active     BOOLEAN DEFAULT TRUE,
                auto       BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, tmdb_id)
            )
        """)
        # Donde mandar los avisos. Una cuenta tiene tantas como aparatos: el
        # telefono, la PWA instalada y el navegador del escritorio son
        # suscripciones distintas, y el `endpoint` es su identidad (por eso es
        # unico: volver a suscribirse en el mismo aparato no crea otra fila).
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                endpoint   VARCHAR(500) NOT NULL UNIQUE,
                p256dh     VARCHAR(200) NOT NULL,
                auth       VARCHAR(100) NOT NULL,
                app        VARCHAR(10) DEFAULT 'web',
                created_at TIMESTAMP DEFAULT NOW(),
                last_ok    TIMESTAMP,
                failures   INTEGER DEFAULT 0
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id)")
        # De que episodios ya se ha avisado. Sin esto, cada pasada del vigilante
        # volveria a anunciar lo mismo: lo que hace "nuevo" a un episodio no es
        # su fecha, es que esta cuenta todavia no lo sabe.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS series_avisos (
                user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                tmdb_id  INTEGER NOT NULL,
                season   INTEGER NOT NULL DEFAULT 0,
                episode  INTEGER NOT NULL,
                sent_at  TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, tmdb_id, season, episode)
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS downloads (
                id          SERIAL PRIMARY KEY,
                owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                folder_name VARCHAR(500) NOT NULL,
                folder_path VARCHAR(1000) NOT NULL,
                base_name   VARCHAR(500),
                message_id  INTEGER,
                channel_id  BIGINT,
                size_bytes  BIGINT DEFAULT 0,
                status      VARCHAR(20) DEFAULT 'downloading',
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        # Varios episodios comparten carpeta de temporada: la ruta ya no es unica.
        try:
            await conn.execute("ALTER TABLE downloads DROP CONSTRAINT IF EXISTS downloads_folder_path_key")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_downloads_path ON downloads (folder_path)")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_downloads_msg ON downloads (channel_id, message_id)")
        except Exception as e:
            logger.warning("Migracion de downloads: %s", e)
        await _migrate_tmdb_keys(conn)
        try:
            await conn.execute("ALTER TABLE index_progress ADD COLUMN IF NOT EXISTS total_scanned INTEGER DEFAULT 0")
            await conn.execute("ALTER TABLE index_progress ADD COLUMN IF NOT EXISTS total_estimate INTEGER DEFAULT 0")
            await conn.execute("ALTER TABLE index_progress ADD COLUMN IF NOT EXISTS phase VARCHAR(20) DEFAULT 'pending'")
            await conn.execute("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS tmdb_searched BOOLEAN DEFAULT FALSE")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'")
            # Cuota de disco por cuenta (NULL = sin limite) y si puede entrar.
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_bytes BIGINT")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE")
            await conn.execute("ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS liked_years INTEGER[] DEFAULT '{}'")
            # Fecha de estreno completa. Con solo el año, "Novedades" no podia
            # distinguir lo de este mes de lo de enero y salia siempre igual.
            await conn.execute("ALTER TABLE tmdb_cache ADD COLUMN IF NOT EXISTS release_date DATE")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_tmdb_estreno ON tmdb_cache (release_date DESC)")
            # Para encontrar la ficha por el nombre de la carpeta cuando una
            # fila de progreso no guardo el tmdb_id (ver database/progress.py).
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_tmdb_titulo ON tmdb_cache (title)")
            # Lo que llega en vivo se consulta por fecha para avisar de los
            # episodios nuevos: sin indice es un barrido de media_items entero.
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_media_indexado ON media_items (indexed_at DESC)")
        except Exception:
            pass


async def _migrate_tmdb_keys(conn):
    """tmdb_cache estaba indexada solo por tmdb_id, pero en TMDB peliculas y
    series tienen ids independientes: la serie "Ed, Edd y Eddy" es tv/606 y
    "Memorias de Africa" es movie/606, y cada una pisaba la cache de la otra.
    La clave pasa a ser (tmdb_id, media_type) y media_items guarda el tipo."""
    try:
        await conn.execute("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS tmdb_type VARCHAR(10)")
        await conn.execute("ALTER TABLE tmdb_cache ADD COLUMN IF NOT EXISTS vote_count INTEGER")
        cols = await conn.fetchval("""
            SELECT COUNT(*) FROM information_schema.key_column_usage
            WHERE table_name = 'tmdb_cache' AND constraint_name = 'tmdb_cache_pkey'
        """)
        if cols == 1:
            await conn.execute("ALTER TABLE tmdb_cache DROP CONSTRAINT tmdb_cache_pkey")
            await conn.execute("ALTER TABLE tmdb_cache ADD PRIMARY KEY (tmdb_id, media_type)")
            logger.info("tmdb_cache: clave primaria migrada a (tmdb_id, media_type)")
        # Lo que ya estaba validado (tipo detectado == tipo TMDB) conserva su id
        # con el tipo que le corresponde; el resto se resuelve al reclasificar.
        await conn.execute("""
            UPDATE media_items
            SET tmdb_type = CASE media_type WHEN 'series' THEN 'tv' ELSE 'movie' END
            WHERE tmdb_id IS NOT NULL AND tmdb_type IS NULL AND tmdb_valid IS TRUE
        """)
        await conn.execute("""
            UPDATE media_items mi SET tmdb_type = tc.media_type
            FROM tmdb_cache tc
            WHERE tc.tmdb_id = mi.tmdb_id AND mi.tmdb_id IS NOT NULL AND mi.tmdb_type IS NULL
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_tmdb ON media_items (tmdb_id, tmdb_type)")
    except Exception as e:
        logger.error("Migracion de tmdb_cache fallo: %s", e)


from app.database.users import get_user_by_username, get_user_by_id, create_user, list_users, update_user, delete_user, update_password_hash
from app.database.channels_db import get_all_channels, get_active_channels, upsert_channel, set_active_channels, remove_channel
from app.database.media import (insert_media_item, insert_media_items, update_media_tmdb, update_media_tmdb_many,
    search_media, get_media_by_tmdb, get_media_without_tmdb, get_media_by_channel, mark_batch_tmdb_searched,
    fetch_all_media_for_reclassify, bulk_update_parsed, reset_tmdb_for_ids, get_missing_cache_pairs)
from app.database.tmdb_cache import get_tmdb_cached, upsert_tmdb_cache
from app.database.favorites import list_favorites, favorite_keys, add_favorite, remove_favorite
from app.database.follows import (list_follows, follow_keys, set_follow, auto_follow,
    followers_of, followed_series_ids)
from app.database.push import (add_subscription, remove_subscription, subscriptions_for,
    drop_subscription_by_id, mark_subscription_ok)
from app.database.index_progress import get_index_progress, upsert_index_progress, bump_index_progress, get_index_stats, set_index_phase, reset_all_index_progress, get_index_status


# ---------------------------------------------------------------------------
# app_settings: ajustes editables desde el panel de administracion
# ---------------------------------------------------------------------------

async def get_app_settings() -> dict[str, str]:
    """Todo lo guardado desde el panel. Devuelve {} si aun no hay pool o tabla:
    lo llama el arranque, antes de que nada este garantizado."""
    if not _pool:
        return {}
    try:
        async with _pool.acquire() as conn:
            rows = await conn.fetch("SELECT key, value FROM app_settings")
        return {r["key"]: r["value"] for r in rows}
    except Exception as e:
        logger.warning("No se pudieron leer los ajustes guardados: %s", e)
        return {}


async def set_app_settings(values: dict[str, str]) -> None:
    if not _pool or not values:
        return
    async with _pool.acquire() as conn:
        for key, value in values.items():
            await conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
                """,
                key, str(value),
            )


# ---------------------------------------------------------------------------
# novedades: que ha ido llegando en vivo a los canales
# ---------------------------------------------------------------------------

NOVEDADES_MAX = 2000


async def log_novedad(channel_id: int, channel_name: str, message_id: int, file_name: str,
                      indexed: bool, reason: str = "", media_type: str = None,
                      season: int = None, episode: int = None, clean_title: str = None) -> None:
    """Deja constancia de un mensaje nuevo, se haya indexado o no. El motivo
    del descarte es justo lo que hacia falta para saber por que una pelicula
    no aparecia: sin el, un mensaje ignorado no dejaba ni rastro."""
    if not _pool:
        return
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO novedades (channel_id, channel_name, message_id, file_name,
                                       media_type, season, episode, clean_title, indexed, reason)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                channel_id, channel_name, message_id, (file_name or "")[:500], media_type,
                season, episode, (clean_title or None), indexed, (reason or "")[:120],
            )
            # Se poda de vez en cuando para que la tabla no crezca sin fin.
            if message_id % 50 == 0:
                await conn.execute(
                    """
                    DELETE FROM novedades WHERE id < (
                        SELECT MIN(id) FROM (
                            SELECT id FROM novedades ORDER BY id DESC LIMIT $1
                        ) AS ultimas
                    )
                    """,
                    NOVEDADES_MAX,
                )
    except Exception as e:
        logger.warning("No se pudo registrar la novedad: %s", e)


async def get_novedades(limit: int = 100, only_indexed: bool = False) -> list[dict]:
    if not _pool:
        return []
    where = "WHERE n.indexed" if only_indexed else ""
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT n.*, c.title AS tmdb_title, c.poster, c.year
            FROM novedades n
            LEFT JOIN media_items mi
                   ON mi.channel_id = n.channel_id AND mi.message_id = n.message_id
            -- Por las dos columnas: tv/606 y movie/606 son titulos distintos.
            LEFT JOIN tmdb_cache c
                   ON c.tmdb_id = mi.tmdb_id AND c.media_type = mi.tmdb_type
            {where}
            ORDER BY n.created_at DESC
            LIMIT $1
            """,
            limit,
        )
    return [dict(r) for r in rows]
