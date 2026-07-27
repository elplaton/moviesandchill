from app.database.connection import get_pool


async def get_user_by_username(username: str):
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, username, password_hash, role FROM users WHERE username = $1",
            username,
        )
        if row:
            return {"id": row["id"], "username": row["username"], "password_hash": row["password_hash"], "role": row["role"]}
    return None


async def create_user(username: str, password_hash: str, role: str = "user"):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            username, password_hash, role,
        )
