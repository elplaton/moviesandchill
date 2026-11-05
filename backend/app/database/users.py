from app.database.connection import get_pool

COLS = "id, username, password_hash, role, quota_bytes, active, must_change_password, created_at"


def _row(row) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"], "username": row["username"], "password_hash": row["password_hash"],
        "role": row["role"] or "user", "quota_bytes": row["quota_bytes"], "active": row["active"] is not False,
        "must_change_password": bool(row["must_change_password"]),
        "created_at": row["created_at"],
    }


async def get_user_by_username(username: str):
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        return _row(await conn.fetchrow(f"SELECT {COLS} FROM users WHERE username = $1", username))


async def get_user_by_id(user_id: int):
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        return _row(await conn.fetchrow(f"SELECT {COLS} FROM users WHERE id = $1", user_id))


async def update_password_hash(username: str, password_hash: str, must_change: bool | None = None):
    """Cambia el hash. `must_change` None deja la marca como estaba (la
    migracion de hashes antiguos al entrar no debe tocarla)."""
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        if must_change is None:
            await conn.execute("UPDATE users SET password_hash = $1 WHERE username = $2", password_hash, username)
        else:
            await conn.execute("UPDATE users SET password_hash = $1, must_change_password = $3 WHERE username = $2",
                               password_hash, username, must_change)


async def create_user(username: str, password_hash: str, role: str = "user", quota_bytes: int | None = None,
                      must_change: bool = False):
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        return await conn.fetchval("""
            INSERT INTO users (username, password_hash, role, quota_bytes, must_change_password)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (username) DO NOTHING RETURNING id
        """, username, password_hash, role, quota_bytes, must_change)


async def list_users():
    """Cuentas con el disco que ocupa cada una (solo descargas vivas)."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT u.id, u.username, u.role, u.quota_bytes, u.active, u.must_change_password, u.last_seen_at, u.created_at,
                   COALESCE(SUM(d.size_bytes) FILTER (WHERE d.status IN ('downloading','paused','done')), 0) AS used_bytes,
                   COUNT(d.id) FILTER (WHERE d.status = 'done') AS downloads
            FROM users u LEFT JOIN downloads d ON d.owner_id = u.id
            GROUP BY u.id ORDER BY u.created_at
        """)
        return [dict(r) for r in rows]


async def update_user(user_id: int, **fields):
    """Campos admitidos: role, quota_bytes, active, password_hash, must_change_password."""
    allowed = {"role", "quota_bytes", "active", "password_hash", "must_change_password"}
    sets = {k: v for k, v in fields.items() if k in allowed}
    pool = get_pool()
    if not pool or not sets:
        return
    assigns = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(sets))
    async with pool.acquire() as conn:
        await conn.execute(f"UPDATE users SET {assigns} WHERE id = $1", user_id, *sets.values())


async def delete_user(user_id: int):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM user_preferences WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)
