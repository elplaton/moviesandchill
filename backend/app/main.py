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
        await create_user("admin", hash_password("admin"))
        logger.info("Usuario admin creado (password: admin). Cambialo.")
    except Exception:
        pass

    from app.services.telegram_client import TelegramDownloader
    downloader = TelegramDownloader(config)

    db_channels = await get_active_channels()
    if db_channels:
        await downloader.load_channels_from_list(db_channels)
        config["channels"] = db_channels
        logger.info("Canales cargados desde Oracle: %d", len(db_channels))

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
from app.routers.download import router as download_router

app.include_router(auth_router)
app.include_router(download_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
