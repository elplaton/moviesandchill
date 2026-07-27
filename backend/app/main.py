import asyncio
import json
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=__import__("sys").stdout,
)
logger = logging.getLogger("tmd")

app = FastAPI(title="Telegram Movie Downloader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

downloader = None
config = {}


@app.on_event("startup")
async def startup():
    global downloader, config

    from app.config import load_config
    config = load_config()

    from app.database.connection import init_pool, create_user, get_active_channels

    for attempt in range(10):
        try:
            await init_pool(config["database_url"])
            break
        except Exception as e:
            logger.warning("PostgreSQL no disponible (intento %d/10): %s", attempt + 1, e)
            if attempt < 9:
                await asyncio.sleep(3)

    from app.auth.service import hash_password
    try:
        await create_user("admin", hash_password("admin"), role="admin")
        from app.database.connection import get_pool
        pool = get_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin' AND role != 'admin'")
        logger.info("Usuario admin creado (password: admin). Cambialo.")
    except Exception:
        pass

    from app.services.telegram_client import TelegramDownloader
    downloader = TelegramDownloader(config)

    db_channels = await get_active_channels()
    if db_channels:
        await downloader.load_channels_from_list(db_channels)
        config["channels"] = db_channels
        logger.info("Canales cargados desde BD: %d", len(db_channels))
    else:
        await downloader.load_channels_from_list([])
        fallback = downloader.channel_ids
        if fallback:
            from app.database.connection import upsert_channel
            for ch in fallback:
                await upsert_channel(ch["id"], ch["name"])
            config["channels"] = fallback
            logger.info("Canales desde .env y guardados en BD: %d", len(fallback))
        else:
            logger.info("Sin canales configurados")

    try:
        await downloader.start()
    except Exception as e:
        logger.error("No se pudo conectar a Telegram: %s", e)

    from app.routers.download import init_download_router
    init_download_router(downloader, config)

    logger.info("Servidor iniciado | host=%s | port=%d | channels=%d",
                config.get("server_host", "0.0.0.0"),
                config.get("server_port", 8000),
                len(config.get("channels", [])))

    if config.get("channels"):
        import asyncio as aio
        from app.services.indexer import run_full_index
        from app.routers import index_router
        async def _bg_index():
            index_router._index_running = True
            try:
                await run_full_index(downloader, config)
            finally:
                index_router._index_running = False
        aio.create_task(_bg_index())
        logger.info("Indexacion iniciada en background (TMDB=%s)", "ON" if config.get("tmdb_enabled") else "OFF")


@app.on_event("shutdown")
async def shutdown():
    if downloader:
        await downloader.stop()
    try:
        from app.database.connection import close_pool
        await close_pool()
    except Exception:
        pass


from app.auth.router import router as auth_router

app.include_router(auth_router)

from app.routers.search_router import router as search_router
from app.routers.download_router import router as download_router
from app.routers.files_router import router as files_router
from app.routers.channels_router import router as channels_router
from app.routers.config_router import router as config_router
from app.routers.index_router import router as index_router
from app.routers.logs_router import router as logs_router
from app.routers.metadata_router import router as metadata_router
from app.routers.ws_router import router as ws_router
from app.routers.browse_router import router as browse_router
from app.routers.tmdb_router import router as tmdb_router
from app.routers.preferences_router import router as preferences_router

app.include_router(search_router)
app.include_router(download_router)
app.include_router(files_router)
app.include_router(channels_router)
app.include_router(config_router)
app.include_router(index_router)
app.include_router(logs_router)
app.include_router(metadata_router)
app.include_router(ws_router)
app.include_router(browse_router)
app.include_router(tmdb_router)
app.include_router(preferences_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
