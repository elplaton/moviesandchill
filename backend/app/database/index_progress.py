from app.database.connection import get_pool


async def get_index_progress():
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ip.*, c.name as channel_name FROM index_progress ip
            JOIN channels c ON ip.channel_id = c.channel_id
            ORDER BY c.name
        """)
        return [dict(r) for r in rows]


async def upsert_index_progress(channel_id: int, last_message_id: int, total_indexed: int = 0,
                                 status: str = "running", total_scanned: int = 0, total_estimate: int = 0,
                                 phase: str = "scanning"):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO index_progress (channel_id, last_message_id, total_indexed, status, total_scanned, total_estimate, phase)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (channel_id) DO UPDATE SET
                last_message_id=EXCLUDED.last_message_id,
                total_indexed=EXCLUDED.total_indexed,
                total_scanned=EXCLUDED.total_scanned,
                total_estimate=EXCLUDED.total_estimate,
                status=EXCLUDED.status,
                phase=EXCLUDED.phase
        """, channel_id, last_message_id, total_indexed, status, total_scanned, total_estimate, phase)


async def set_index_phase(channel_id: int, phase: str):
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO index_progress (channel_id, last_message_id, total_indexed, status, total_scanned, total_estimate, phase)
            VALUES ($1, 0, 0, 'pending', 0, 0, $2)
            ON CONFLICT (channel_id) DO UPDATE SET phase = EXCLUDED.phase
        """, channel_id, phase)


async def reset_all_index_progress():
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM index_progress")


async def get_index_status():
    pool = get_pool()
    if not pool:
        return {"phase": "idle", "channels": [], "overall_progress": 0}
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ip.*, c.name as channel_name FROM index_progress ip
            JOIN channels c ON ip.channel_id = c.channel_id
            ORDER BY c.name
        """)
        channels = []
        total_scanned_sum = 0
        total_indexed_sum = 0
        total_estimate = 0
        phases = set()
        for r in rows:
            d = dict(r)
            total_indexed_sum += d.get("total_indexed", 0) or 0
            total_scanned_sum += d.get("total_scanned", 0) or 0
            total_estimate += d.get("total_estimate", 0) or 0
            phases.add(d.get("phase", "idle"))
            channels.append({
                "channel_id": d["channel_id"],
                "channel_name": d.get("channel_name", ""),
                "total_indexed": d.get("total_indexed", 0),
                "total_estimate": d.get("total_estimate", 0),
                "total_scanned": d.get("total_scanned", 0),
                "status": d.get("status", "pending"),
                "phase": d.get("phase", "idle"),
            })
        if not channels:
            return {"phase": "idle", "channels": [], "overall_progress": 0}
        if "scanning" in phases:
            current_phase = "scanning"
        elif "estimating" in phases:
            current_phase = "estimating"
        elif "done" in phases:
            if phases == {"done"}:
                current_phase = "done"
            else:
                current_phase = "scanning"
        else:
            current_phase = "idle"
        overall = round((total_scanned_sum / max(total_estimate, 1)) * 100, 1)
        return {"phase": current_phase, "channels": channels, "overall_progress": overall,
                "total_scanned": total_scanned_sum, "total_indexed": total_indexed_sum, "total_estimate": total_estimate}


async def get_index_stats():
    pool = get_pool()
    if not pool:
        return {"total": 0, "movies": 0, "series": 0, "by_channel": []}
    async with pool.acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM media_items")
        movies = await conn.fetchval("SELECT COUNT(*) FROM media_items WHERE media_type='movie'")
        series = await conn.fetchval("SELECT COUNT(*) FROM media_items WHERE media_type='series'")
        with_tmdb = await conn.fetchval("SELECT COUNT(*) FROM media_items WHERE tmdb_id IS NOT NULL")
        tmdb_searched = await conn.fetchval("SELECT COUNT(*) FROM media_items WHERE tmdb_searched = TRUE")
        by_channel = await conn.fetch("""
            SELECT channel_id, channel_name, COUNT(*) as cnt
            FROM media_items GROUP BY channel_id, channel_name ORDER BY cnt DESC
        """)
        return {
            "total": total, "movies": movies, "series": series,
            "with_tmdb": with_tmdb, "tmdb_searched": tmdb_searched,
            "by_channel": [{"channel_id": r["channel_id"], "channel_name": r["channel_name"], "count": r["cnt"]} for r in by_channel],
        }
