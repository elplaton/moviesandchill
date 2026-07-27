import asyncio
import logging

from app.database.connection import get_active_channels, upsert_index_progress, set_index_phase

logger = logging.getLogger("tmd")


async def estimate_channels(downloader, broadcast=None):
    channels = await get_active_channels()
    if not channels:
        logger.info("Sin canales para estimar")
        return []

    logger.info("Fase 0: estimando total de mensajes para %d canales...", len(channels))
    results = []

    for i, ch in enumerate(channels):
        ch_id = ch["id"]
        ch_name = ch["name"]
        total = await downloader.get_total_messages(ch_id)
        results.append({"channel_id": ch_id, "channel_name": ch_name, "total_estimate": total})
        logger.info("  Canal %s: ~%d mensajes totales", ch_name, total)

        from app.database.connection import get_index_progress
        progress = await get_index_progress()
        prog = next((p for p in progress if p["channel_id"] == ch_id), {})
        existing_offset = prog.get("last_message_id", 0) or 0
        existing_indexed = prog.get("total_indexed", 0) or 0
        await upsert_index_progress(
            channel_id=ch_id,
            last_message_id=existing_offset,
            total_indexed=existing_indexed,
            total_scanned=existing_offset,
            status="pending",
            total_estimate=total,
            phase="estimating",
        )

        if broadcast:
            await broadcast({
                "type": "index_phase",
                "phase": "estimating",
                "channel_index": i + 1,
                "total_channels": len(channels),
            })
            await broadcast({
                "type": "index_progress",
                "channel_id": ch_id,
                "channel_name": ch_name,
                "indexed": 0,
                "total_estimate": total,
                "progress": 0,
                "phase": "estimating",
            })

        if i < len(channels) - 1:
            await asyncio.sleep(2)

    total_msgs = sum(r["total_estimate"] for r in results)
    logger.info("Estimacion completada: %d mensajes en %d canales", total_msgs, len(results))

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "estimate_done"})

    return results
