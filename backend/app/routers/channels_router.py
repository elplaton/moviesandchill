import logging
import re
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_admin

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["channels"])


class AddChannelRequest(BaseModel):
    url: str


@router.get("/channels")
async def channels(user: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import get_active_channels
    db_channels = await get_active_channels()
    if db_channels:
        return {"channels": db_channels}
    from app.routers.download import downloader
    return {"channels": [{"id": ch["id"], "name": ch["name"]} for ch in downloader.channel_ids]}


@router.get("/dialogs")
async def dialogs(user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import downloader
    try:
        dialogs = await downloader.list_dialogs()
    except Exception:
        return {"dialogs": [], "error": "No se pudo conectar a Telegram"}
    from app.database.connection import get_all_channels
    db_all = await get_all_channels()
    configured_ids = {ch["id"] for ch in (db_all or []) if ch.get("active")}
    items = []
    for d in dialogs:
        items.append({
            "id": d["id"], "name": d["name"],
            "is_channel": d["is_channel"], "is_group": d["is_group"],
            "is_megagroup": d.get("is_megagroup", False),
            "active": d["id"] in configured_ids,
        })
    items.sort(key=lambda x: (not x["active"], not x["is_channel"], x["name"].lower()))
    return {"dialogs": items}


@router.post("/channels/add")
async def add_channel_by_url(req: AddChannelRequest, user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import downloader, config
    url = req.url.strip()
    if not url:
        return {"error": "URL vacia"}

    match = re.match(r'(?:https?://)?t\.me/(c/)?(-?\d+)(?:/\d+)?', url)
    if not match:
        match = re.match(r'(?:https?://)?t\.me/([a-zA-Z][\w]+)', url)
    if not match:
        return {"error": "URL no valida"}

    if match.group(1) == "c/" or (match.group(2) and match.group(2).isdigit()):
        entity_input = int(f"-100{match.group(2)}" if not match.group(2).startswith("-") else match.group(2))
    else:
        entity_input = match.group(1)

    try:
        entity = await downloader.client.get_entity(entity_input)
        name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Sin nombre"
        ch_id = entity.id
    except Exception as e:
        return {"error": f"No se pudo resolver el canal: {e}"}

    is_new = await downloader.add_channel(ch_id, name)
    try:
        from app.database.connection import upsert_channel
        await upsert_channel(ch_id, name)
    except Exception:
        pass

    logger.info("Canal %s | ID=%d | %s", "anadido" if is_new else "actualizado", ch_id, name)

    if is_new:
        import asyncio as aio
        from app.services.indexer import scan_channel, enrich_missing_tmdb
        aio.create_task(scan_channel(downloader, ch_id, name, 0, limit=500))
        aio.create_task(enrich_missing_tmdb(config.get("tmdb_api_key", ""), config.get("tmdb_enabled", False)))

    return {"status": "added" if is_new else "updated", "channel": {"id": ch_id, "name": name}}
