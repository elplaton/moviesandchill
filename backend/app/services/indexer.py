import asyncio
import logging
import re
import time

from app.services.tmdb import clean_title
from app.database.connection import (
    get_pool, get_active_channels,
    insert_media_item, update_media_tmdb,
    upsert_tmdb_cache, upsert_index_progress, get_index_progress,
)

logger = logging.getLogger("tmd")

TAG_PATTERNS = {
    "1080p": r'\b1080p\b', "720p": r'\b720p\b', "2160p": r'\b2160p\b',
    "4K": r'\b4[Kk]\b',
    "x264": r'\bx264\b', "x265": r'\bx265\b', "HEVC": r'\bhevc\b',
    "HDR": r'\bhdr\b', "DV": r'\bdv\b', "DoVi": r'\bdovi\b',
    "DTS": r'\bdts\b', "AC3": r'\bac3\b', "EAC3": r'\beac3\b',
    "AAC": r'\baac\b', "TrueHD": r'\btruehd\b',
    "BluRay": r'\bbluray\b', "BDRip": r'\bbdrip\b', "WebDL": r'\bweb.dl\b',
    "REMUX": r'\bremux\b',
    "español": r'\bespañola?\b', "latino": r'\blatino\b', "english": r'\benglish\b',
}


def extract_tags(filename: str) -> list[str]:
    tags = []
    seen = set()
    for tag, pattern in TAG_PATTERNS.items():
        if re.search(pattern, filename, re.IGNORECASE) and tag.lower() not in seen:
            seen.add(tag.lower())
            tags.append(tag)
    return tags


def detect_media_type(filename: str):
    m = re.search(r'(\d{1,2})x(\d{2})', filename, re.IGNORECASE)
    if m:
        return "series", int(m.group(1)), int(m.group(2))
    m = re.search(r'[sS](\d{2})[eE](\d{2})', filename)
    if m:
        return "series", int(m.group(1)), int(m.group(2))
    return "movie", None, None


def validate_media_type(filename: str, tmdb_type: str) -> bool:
    detected, _, _ = detect_media_type(filename)
    expected = "tv" if detected == "series" else "movie"
    return tmdb_type == expected


async def _enrich_batch(api_key: str, items: list[dict]):
    if not api_key or not items:
        return
    from app.services.tmdb import search as tmdb_search, get_details as tmdb_details
    from app.database.connection import mark_batch_tmdb_searched

    episodes = [i for i in items if i.get("season") is not None and i.get("episode") is not None]
    regular = [i for i in items if i.get("season") is None or i.get("episode") is None]

    sem = asyncio.Semaphore(5)
    enriched = 0
    lock = asyncio.Lock()

    async def _enrich_one(item):
        nonlocal enriched
        async with sem:
            t0 = time.time()
            ctitle = clean_title(item["file_name"])
            if not ctitle or len(ctitle) < 2:
                return
            try:
                result = await tmdb_search(api_key, ctitle)
                if not result:
                    return
                valid = validate_media_type(item["file_name"], result["media_type"])
                await update_media_tmdb(item["channel_id"], item["message_id"], result["tmdb_id"], valid)
                details = await tmdb_details(api_key, result["tmdb_id"], result["media_type"])
                if details:
                    await upsert_tmdb_cache(details)
                async with lock:
                    enriched += 1
                    t1 = time.time() - t0
                    if enriched % 10 == 0:
                        logger.info("  TMDB: %d enriched | last: %.2fs | %s -> %s",
                            enriched, t1, ctitle[:40], result.get("title", "?")[:40])
            except Exception as e:
                logger.warning("  TMDB error %s: %s", ctitle[:40], str(e)[:60])

    async def _enrich_episode_groups():
        nonlocal enriched
        if not episodes:
            return
        logger.info("  TMDB: processing %d episodes in groups", len(episodes))
        groups: dict[tuple, dict] = {}
        for ep in episodes:
            ctitle = clean_title(ep["file_name"])
            if not ctitle or len(ctitle) < 2:
                continue
            words = ctitle.split()
            for word_count in [3, 2]:
                if len(words) >= word_count:
                    group_name = " ".join(words[:word_count])
                    break
            else:
                group_name = ctitle
            key = (ep["channel_id"], group_name.lower())
            if key not in groups:
                groups[key] = {"title": group_name, "episodes": [], "channel_id": ep["channel_id"]}
            groups[key]["episodes"].append(ep)

        sem2 = asyncio.Semaphore(5)
        logger.info("  TMDB: %d episode groups to search", len(groups))
        async def _enrich_group(key, group):
            nonlocal enriched
            async with sem2:
                try:
                    title = group["title"]
                    result = await tmdb_search(api_key, title)
                    if not result:
                        words = title.split()
                        for wc in [3, 2, 1]:
                            if 0 < wc < len(words):
                                fallback = " ".join(words[:wc])
                                result = await tmdb_search(api_key, fallback)
                                if result:
                                    title = fallback
                                    break
                    if not result:
                        return
                    details = await tmdb_details(api_key, result["tmdb_id"], result["media_type"])
                    if details:
                        await upsert_tmdb_cache(details)
                    for ep in group["episodes"]:
                        valid = validate_media_type(ep["file_name"], result["media_type"])
                        await update_media_tmdb(ep["channel_id"], ep["message_id"], result["tmdb_id"], valid)
                    async with lock:
                        enriched += 1
                    logger.info("  TMDB series: %s (%d episodes) -> %s",
                                group["title"], len(group["episodes"]), result.get("title", "?"))
                except Exception as e:
                    logger.warning("  TMDB series error %s: %s", group["title"][:40], str(e)[:60])

        tasks = [_enrich_group(key, grp) for key, grp in groups.items()]
        await asyncio.gather(*tasks, return_exceptions=True)

    regular_task = asyncio.gather(*[_enrich_one(item) for item in regular], return_exceptions=True)
    episodes_task = _enrich_episode_groups()
    await asyncio.gather(regular_task, episodes_task)

    await mark_batch_tmdb_searched(items)

    return enriched


async def scan_channel(downloader, channel_id: int, channel_name: str, api_key: str = "",
                       broadcast=None, total_estimate: int = 0, stop_flag: asyncio.Event = None):
    pool = get_pool()
    if not pool:
        return

    entity = downloader.channels.get(channel_id, {}).get("entity")
    if not entity:
        logger.warning("No se pudo resolver canal %d", channel_id)
        return

    progress = await get_index_progress()
    prog = next((p for p in progress if p["channel_id"] == channel_id), {})
    offset = prog.get("last_message_id", 0) or 0
    total_indexed = prog.get("total_indexed", 0) or 0
    total_scanned = prog.get("total_scanned", 0) or 0
    batch_items = []
    batch_size = 500
    first_batch = offset == 0

    if not total_estimate:
        total_estimate = prog.get("total_estimate", 0) or 0

    await upsert_index_progress(channel_id, offset, total_indexed, "scanning", phase="scanning",
                                total_estimate=total_estimate)

    if broadcast:
        await broadcast({
            "type": "index_channel_start",
            "channel_id": channel_id,
            "channel_name": channel_name,
            "indexed": total_indexed,
            "total_estimate": total_estimate,
        })

    logger.info("Escaneando canal %s desde offset=%d (ya indexados: %d, total: %d)",
                channel_name, offset, total_indexed, total_estimate)

    had_error = False
    while True:
        if stop_flag and stop_flag.is_set():
            logger.info("Indexacion detenida en canal %s (offset=%d)", channel_name, offset)
            await upsert_index_progress(channel_id, offset, total_indexed, "stopped", phase="stopped",
                                        total_scanned=total_scanned, total_estimate=total_estimate)
            return

        kwargs = {"limit": batch_size, "reverse": True}
        if offset > 0:
            kwargs["offset_id"] = offset
        last_id = offset
        msg_count = 0

        try:
            async for msg in downloader.client.iter_messages(entity, **kwargs):
                msg_count += 1
                last_id = msg.id
                if not msg.media:
                    continue
                file_name = downloader._get_file_name(msg)
                if not file_name or not downloader._is_downloadable(file_name):
                    continue
                size = downloader._get_file_size(msg)
                if size == 0:
                    continue
                ctitle = clean_title(file_name)
                mtype, season, episode = detect_media_type(file_name)
                item = {
                    "channel_id": channel_id, "channel_name": channel_name,
                    "message_id": msg.id, "file_name": file_name,
                    "file_size": size, "size_str": downloader._format_size(size),
                    "clean_title": ctitle, "media_type": mtype,
                    "season": season, "episode": episode,
                }
                batch_items.append(item)
        except Exception as e:
            logger.error("Error escaneando canal %d: %s", channel_id, e)
            had_error = True
            break

        offset = last_id
        total_scanned += msg_count

        if batch_items:
            for item in batch_items:
                await insert_media_item(item)

            total_indexed += len(batch_items)

            if api_key:
                t0 = time.time()
                enriched = await _enrich_batch(api_key, batch_items)
                if enriched:
                    logger.info("  %s: batch %d items | TMDB %d enriched (%.1fs)",
                                channel_name, len(batch_items), enriched, time.time() - t0)

        await upsert_index_progress(channel_id, offset, total_indexed, "scanning", phase="scanning",
                                    total_scanned=total_scanned, total_estimate=total_estimate)

        pct = round((total_scanned / max(total_estimate, 1)) * 100, 1)
        logger.info("  %s: %d media / %d scanned / %d total (%s%%) offset=%d",
                    channel_name, total_indexed, total_scanned, total_estimate, pct, offset)

        if broadcast:
            await broadcast({
                "type": "index_progress",
                "channel_id": channel_id,
                "channel_name": channel_name,
                "indexed": total_indexed,
                "scanned": total_scanned,
                "total_estimate": total_estimate,
                "progress": pct,
                "phase": "scanning",
            })

        batch_items = []
        if msg_count < batch_size:
            break

    if had_error:
        await upsert_index_progress(channel_id, offset, total_indexed, "error", phase="error",
                                    total_scanned=total_scanned, total_estimate=total_estimate)
        logger.warning("Canal %s: error durante escaneo (offset=%d)", channel_name, offset)
        return total_indexed

    final_estimate = total_scanned
    await upsert_index_progress(channel_id, offset, total_indexed, "done", phase="done",
                                total_scanned=total_scanned, total_estimate=final_estimate)

    if broadcast:
        await broadcast({
            "type": "index_channel_done",
            "channel_id": channel_id,
            "channel_name": channel_name,
            "total_indexed": total_indexed,
            "total_scanned": total_scanned,
            "total_estimate": final_estimate,
        })

    logger.info("Canal %s completado: %d items indexados, %d/%d scanned",
                channel_name, total_indexed, total_scanned, final_estimate)
    return total_indexed


async def run_full_index(downloader, config, broadcast=None, stop_flag: asyncio.Event = None, force: bool = False):
    api_key = config.get("tmdb_api_key", "")
    tmdb_enabled = config.get("tmdb_enabled", False) and bool(api_key)

    logger.info("=== Indexacion completa iniciada (TMDB=%s, force=%s) ===", "ON" if tmdb_enabled else "OFF", force)

    if force:
        from app.database.connection import reset_all_index_progress
        await reset_all_index_progress()
        logger.info("Progreso reseteado (force)")
        if broadcast:
            await broadcast({"type": "index_phase", "phase": "resetting"})

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "estimating"})

    from app.services.index_estimator import estimate_channels
    estimated = await estimate_channels(downloader, broadcast=broadcast)

    existing_progress = await get_index_progress()
    done_ids = {p["channel_id"] for p in existing_progress if p["status"] == "done"}

    if stop_flag and stop_flag.is_set():
        logger.info("Indexacion detenida tras estimacion")
        return

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "scanning"})

    total_channels = len(estimated)
    scanned = 0
    skipped = 0
    for i, ch_info in enumerate(estimated):
        if stop_flag and stop_flag.is_set():
            logger.info("Indexacion detenida antes del canal %s", ch_info["channel_name"])
            return

        if ch_info["channel_id"] in done_ids:
            logger.info("--- Canal %d/%d: %s (%s mensajes) — ya completado, omitiendo ---",
                        i + 1, total_channels, ch_info["channel_name"], ch_info["total_estimate"])
            skipped += 1
            continue

        scanned += 1
        logger.info("--- Canal %d/%d: %s (%s mensajes) ---",
                    i + 1, total_channels, ch_info["channel_name"], ch_info["total_estimate"])

        await scan_channel(
            downloader,
            ch_info["channel_id"],
            ch_info["channel_name"],
            api_key=api_key if tmdb_enabled else "",
            broadcast=broadcast,
            total_estimate=ch_info["total_estimate"],
            stop_flag=stop_flag,
        )

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "done"})

    logger.info("=== Indexacion completa finalizada (scanned=%d, skipped=%d) ===", scanned, skipped)


async def enrich_all_missing_tmdb(api_key: str, broadcast=None):
    if not api_key:
        return

    total_enriched = 0
    batch_num = 0
    consecutive_empty = 0
    t_start = time.time()

    while True:
        from app.database.connection import get_media_without_tmdb
        items = await get_media_without_tmdb(limit=300)
        if not items:
            break

        batch_num += 1
        logger.info("TMDB: batch %d — %d items pendientes", batch_num, len(items))

        if broadcast:
            await broadcast({"type": "index_phase", "phase": "enriching"})

        enriched = await _enrich_batch(api_key, items)
        if enriched:
            total_enriched += enriched
            consecutive_empty = 0
        else:
            consecutive_empty += 1

        elapsed = time.time() - t_start
        logger.info("TMDB: batch %d completado — %d enriquecidos (%d total en %.1fs)",
                    batch_num, enriched or 0, total_enriched, elapsed)

        if consecutive_empty >= 5:
            logger.info("TMDB: %d batches consecutivos sin enriquecer — deteniendo", consecutive_empty)
            break

        await asyncio.sleep(1)

    logger.info("TMDB: enriquecimiento finalizado — %d items en %d batches (%.1fs)",
                total_enriched, batch_num, time.time() - t_start)

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "done"})

    return total_enriched
