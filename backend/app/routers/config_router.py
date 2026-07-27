import logging
import subprocess
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_admin

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["config"])


class ConfigUpdateRequest(BaseModel):
    api_id: int | None = None
    api_hash: str | None = None
    phone: str | None = None
    channels: list[dict] | None = None
    download_path: str | None = None
    extract_path: str | None = None
    server_host: str | None = None
    server_port: int | None = None
    delete_archives_after_extract: bool | None = None
    download_parallel: int | None = None
    convert_dts_to_ac3: bool | None = None
    tmdb_enabled: bool | None = None


@router.get("/config")
async def get_config(user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import config
    return {"config": {k: v for k, v in config.items() if k not in ("jwt_secret", "database_url")}}


@router.post("/config")
async def save_config(req: ConfigUpdateRequest, user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import config, downloader
    data = req.model_dump(exclude_none=True)

    if "channels" in data:
        try:
            from app.database.connection import set_active_channels, get_active_channels
            channel_ids = [ch["id"] for ch in data["channels"]]
            await set_active_channels(channel_ids)
            db_active = await get_active_channels()
            if db_active:
                await downloader.refresh_from_db(db_active)
                config["channels"] = db_active
        except Exception as e:
            logger.warning("No se pudo actualizar canales en BD: %s", e)
        data.pop("channels")

    for k, v in data.items():
        config[k] = v

    logger.info("Configuracion actualizada via API por %s: %s", user, list(data.keys()))
    return {"status": "saved", "message": "Cambios aplicados en memoria. Para persistir, edita .env"}
