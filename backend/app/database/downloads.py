"""Descargas con dueño.

Cada descarga (una carpeta en extract_path) pertenece a la cuenta que la pidió:
todos pueden verla, solo su dueño (o un admin) puede borrarla, y nadie puede
volver a bajar lo mismo. El tamaño en disco de lo que posee cada cuenta es lo
que se compara con su cuota.
"""
import os
from app.database.connection import get_pool

ACTIVE_STATES = ("downloading", "paused", "done")


async def create_download(owner_id: int, folder_name: str, folder_path: str, base_name: str,
                          message_id: int, channel_id: int | None, size_bytes: int, status: str = "downloading"):
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        return await conn.fetchval("""
            INSERT INTO downloads (owner_id, folder_name, folder_path, base_name, message_id, channel_id, size_bytes, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (folder_path) DO UPDATE SET
                owner_id = EXCLUDED.owner_id, base_name = EXCLUDED.base_name, message_id = EXCLUDED.message_id,
                channel_id = EXCLUDED.channel_id, size_bytes = EXCLUDED.size_bytes, status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING id
        """, owner_id, folder_name, folder_path, base_name, message_id, channel_id, size_bytes, status)


async def set_download_status(folder_path: str, status: str, size_bytes: int | None = None):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        if size_bytes is None:
            await conn.execute("UPDATE downloads SET status=$2, updated_at=NOW() WHERE folder_path=$1", folder_path, status)
        else:
            await conn.execute("UPDATE downloads SET status=$2, size_bytes=$3, updated_at=NOW() WHERE folder_path=$1",
                               folder_path, status, size_bytes)


async def delete_download(folder_path: str):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM downloads WHERE folder_path=$1", folder_path)


async def get_download_by_path(folder_path: str):
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT d.*, u.username AS owner FROM downloads d LEFT JOIN users u ON u.id = d.owner_id
            WHERE d.folder_path = $1
        """, folder_path)
        return dict(row) if row else None


async def find_existing(message_id: int, channel_id: int | None, folder_path: str):
    """Descarga ya hecha o en curso del mismo archivo (o de la misma carpeta)."""
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT d.*, u.username AS owner FROM downloads d LEFT JOIN users u ON u.id = d.owner_id
            WHERE d.status = ANY($4::text[])
              AND ((d.message_id = $1 AND d.channel_id IS NOT DISTINCT FROM $2) OR d.folder_path = $3)
            ORDER BY d.created_at LIMIT 1
        """, message_id, channel_id, folder_path, list(ACTIVE_STATES))
        return dict(row) if row else None


async def usage_by_user(user_id: int) -> int:
    pool = get_pool()
    if not pool:
        return 0
    async with pool.acquire() as conn:
        return await conn.fetchval("""
            SELECT COALESCE(SUM(size_bytes), 0) FROM downloads
            WHERE owner_id = $1 AND status = ANY($2::text[])
        """, user_id, list(ACTIVE_STATES)) or 0


async def owners_by_path():
    """{folder_path: {owner_id, owner, status}} para etiquetar la biblioteca."""
    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT d.folder_path, d.owner_id, d.status, d.size_bytes, u.username AS owner
            FROM downloads d LEFT JOIN users u ON u.id = d.owner_id
        """)
        return {r["folder_path"]: dict(r) for r in rows}


async def owner_of_path(target: str):
    """Fila de la descarga que contiene esta ruta (carpeta o archivo dentro)."""
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT d.*, u.username AS owner FROM downloads d LEFT JOIN users u ON u.id = d.owner_id
            WHERE $1 = d.folder_path OR $1 LIKE d.folder_path || '/%'
            ORDER BY length(d.folder_path) DESC LIMIT 1
        """, target)
        return dict(row) if row else None


async def list_downloads():
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT d.id, d.folder_name, d.folder_path, d.base_name, d.size_bytes, d.status, d.created_at,
                   d.owner_id, u.username AS owner
            FROM downloads d LEFT JOIN users u ON u.id = d.owner_id
            ORDER BY d.created_at DESC
        """)
        return [dict(r) for r in rows]


async def reassign_downloads(from_user_id: int, to_user_id: int):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("UPDATE downloads SET owner_id=$2 WHERE owner_id=$1", from_user_id, to_user_id)


def dir_size(path: str) -> int:
    total = 0
    if os.path.isfile(path):
        return os.path.getsize(path)
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


async def adopt_orphans(extract_path: str, admin_id: int) -> int:
    """Lo que ya estaba en disco antes de existir los dueños pasa al admin.
    Tambien se descartan filas de carpetas que ya no existen."""
    pool = get_pool()
    if not pool or not os.path.isdir(extract_path):
        return 0
    base = os.path.realpath(extract_path)
    known = await owners_by_path()
    added = 0
    async with pool.acquire() as conn:
        for entry in sorted(os.listdir(base)):
            full = os.path.join(base, entry)
            if entry.startswith(".") or full in known:
                continue
            if not (os.path.isdir(full) or os.path.isfile(full)):
                continue
            await conn.execute("""
                INSERT INTO downloads (owner_id, folder_name, folder_path, base_name, message_id, channel_id, size_bytes, status)
                VALUES ($1, $2, $3, $2, 0, NULL, $4, 'done') ON CONFLICT (folder_path) DO NOTHING
            """, admin_id, entry, full, dir_size(full))
            added += 1
        for path, row in known.items():
            if row["status"] == "done" and not os.path.exists(path):
                await conn.execute("DELETE FROM downloads WHERE folder_path=$1", path)
    return added
