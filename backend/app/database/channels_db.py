from app.database.connection import get_pool


async def get_all_channels():
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT channel_id, name, active FROM channels ORDER BY name")
        return [{"id": r["channel_id"], "name": r["name"], "active": r["active"]} for r in rows]


async def get_active_channels():
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT channel_id, name FROM channels WHERE active = TRUE ORDER BY name")
        return [{"id": r["channel_id"], "name": r["name"]} for r in rows]


async def upsert_channel(channel_id: int, name: str):
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
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
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("UPDATE channels SET active = FALSE")
        for cid in channel_ids:
            await conn.execute("UPDATE channels SET active = TRUE WHERE channel_id = $1", cid)


async def remove_channel(channel_id: int):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM channels WHERE channel_id = $1", channel_id)
