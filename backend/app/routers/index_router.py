import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_admin

router = APIRouter(prefix="/api", tags=["index"])

_index_stop_flag: asyncio.Event | None = None
_index_running = False


@router.get("/index/stats")
async def index_stats(user: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import get_index_stats
    return await get_index_stats()


@router.get("/index/status")
async def index_status(user: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import get_index_status
    global _index_running
    result = await get_index_status()
    result["running"] = _index_running or result["phase"] in ("scanning", "estimating")
    return result


@router.get("/index/progress")
async def index_progress(user: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import get_index_progress as db_progress
    return {"channels": await db_progress()}


async def _do_start(force: bool = False):
    from app.routers.download import downloader, config
    from app.services.indexer import run_full_index
    from app.routers.ws_router import _broadcast_index

    global _index_stop_flag, _index_running

    if _index_running:
        return {"status": "already_running"}

    _index_stop_flag = asyncio.Event()
    _index_running = True

    async def _task():
        global _index_running
        try:
            await run_full_index(downloader, config, broadcast=_broadcast_index,
                                 stop_flag=_index_stop_flag, force=force)
        finally:
            _index_running = False

    asyncio.create_task(_task())
    return {"status": "started", "tmdb_enabled": config.get("tmdb_enabled", False)}


@router.post("/index/start")
async def index_start(user: Annotated[str, Depends(get_current_admin)]):
    return await _do_start(force=False)


@router.post("/index/scan")
async def index_scan(user: Annotated[str, Depends(get_current_admin)]):
    return await _do_start(force=False)


@router.post("/index/rescan")
async def index_rescan(user: Annotated[str, Depends(get_current_admin)]):
    return await _do_start(force=True)


@router.post("/index/stop")
async def index_stop(user: Annotated[str, Depends(get_current_admin)]):
    global _index_stop_flag, _index_running
    if not _index_running:
        return {"status": "not_running"}
    _index_stop_flag.set()
    _index_running = False
    return {"status": "stopping"}


@router.post("/index/channel/{channel_id}")
async def index_channel(channel_id: int, user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import downloader, config
    from app.routers.ws_router import _broadcast_index

    for ch in downloader.channel_ids:
        if ch["id"] == channel_id:
            total = await downloader.get_total_messages(channel_id)
            api_key = config.get("tmdb_api_key", "") if config.get("tmdb_enabled", False) else ""

            async def _task():
                from app.services.indexer import scan_channel
                await scan_channel(downloader, channel_id, ch["name"], api_key=api_key,
                                   broadcast=_broadcast_index, total_estimate=total)

            asyncio.create_task(_task())
            return {"status": "started", "channel": ch["name"], "total_estimate": total,
                    "tmdb_enabled": config.get("tmdb_enabled", False)}

    return {"error": "Canal no encontrado"}


@router.post("/index/enrich")
async def index_enrich(user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import config
    from app.services.indexer import enrich_all_missing_tmdb
    from app.routers.ws_router import _broadcast_index

    api_key = config.get("tmdb_api_key", "")
    if not api_key:
        return {"status": "error", "detail": "TMDB API key no configurada"}

    async def _task():
        await enrich_all_missing_tmdb(api_key, broadcast=_broadcast_index)

    asyncio.create_task(_task())
    return {"status": "started", "tmdb_enabled": True}
