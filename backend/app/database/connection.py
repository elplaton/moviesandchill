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
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id       INTEGER PRIMARY KEY REFERENCES users(id),
                liked_movies  INTEGER[],
                liked_series  INTEGER[],
                genres        JSONB,
                created_at    TIMESTAMP DEFAULT NOW()
            )
        """)
        try:
            await conn.execute("ALTER TABLE index_progress ADD COLUMN IF NOT EXISTS total_scanned INTEGER DEFAULT 0")
            await conn.execute("ALTER TABLE index_progress ADD COLUMN IF NOT EXISTS total_estimate INTEGER DEFAULT 0")
            await conn.execute("ALTER TABLE index_progress ADD COLUMN IF NOT EXISTS phase VARCHAR(20) DEFAULT 'pending'")
            await conn.execute("ALTER TABLE media_items ADD COLUMN IF NOT EXISTS tmdb_searched BOOLEAN DEFAULT FALSE")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'")
            await conn.execute("ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS liked_years INTEGER[] DEFAULT '{}'")
        except Exception:
            pass


from app.database.users import get_user_by_username, create_user
from app.database.channels_db import get_all_channels, get_active_channels, upsert_channel, set_active_channels, remove_channel
from app.database.media import insert_media_item, update_media_tmdb, search_media, get_media_without_tmdb, get_media_by_channel, mark_batch_tmdb_searched
from app.database.tmdb_cache import get_tmdb_cached, upsert_tmdb_cache
from app.database.index_progress import get_index_progress, upsert_index_progress, get_index_stats, set_index_phase, reset_all_index_progress, get_index_status
