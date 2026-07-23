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


async def get_user_by_username(username: str):
    if not _pool:
        return None
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, username, password_hash FROM users WHERE username = $1",
            username,
        )
        if row:
            return {"id": row["id"], "username": row["username"], "password_hash": row["password_hash"]}
    return None


async def create_user(username: str, password_hash: str):
    if not _pool:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            username, password_hash,
        )


async def get_all_channels():
    if not _pool:
        return []
    async with _pool.acquire() as conn:
        rows = await conn.fetch("SELECT channel_id, name, active FROM channels ORDER BY name")
        return [{"id": r["channel_id"], "name": r["name"], "active": r["active"]} for r in rows]


async def get_active_channels():
    if not _pool:
        return []
    async with _pool.acquire() as conn:
        rows = await conn.fetch("SELECT channel_id, name FROM channels WHERE active = TRUE ORDER BY name")
        return [{"id": r["channel_id"], "name": r["name"]} for r in rows]


async def upsert_channel(channel_id: int, name: str):
    if not _pool:
        return False
    async with _pool.acquire() as conn:
        existing = await conn.fetchval("SELECT id FROM channels WHERE channel_id = $1", channel_id)
        if existing:
            await conn.execute("UPDATE channels SET name = $1 WHERE channel_id = $2", name, channel_id)
            return False
        else:
            await conn.execute(
                "INSERT INTO channels (channel_id, name, active) VALUES ($1, $2, TRUE)",
                channel_id, name,
            )
            return True


async def set_active_channels(channel_ids: list[int]):
    if not _pool:
        return
    async with _pool.acquire() as conn:
        await conn.execute("UPDATE channels SET active = FALSE")
        for cid in channel_ids:
            await conn.execute("UPDATE channels SET active = TRUE WHERE channel_id = $1", cid)


async def remove_channel(channel_id: int):
    if not _pool:
        return
    async with _pool.acquire() as conn:
        await conn.execute("DELETE FROM channels WHERE channel_id = $1", channel_id)
