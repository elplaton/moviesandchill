import asyncio

from app.services.telegram_client import TelegramDownloader

router = None
active_ws: list = []
_batch_tasks: dict[str, asyncio.Task] = {}
_stream_semaphore: asyncio.Semaphore | None = None

downloader: TelegramDownloader | None = None
config: dict = {}


def init_download_router(dl: TelegramDownloader, cfg: dict):
    global downloader, config, _stream_semaphore
    downloader = dl
    config = cfg
    _stream_semaphore = asyncio.Semaphore(cfg.get("stream_max", 3))

    from app.routers.download_router import init_download_router as init_dl
    init_dl(dl, cfg)

    from app.routers.files_router import init_files_semaphore
    init_files_semaphore(cfg.get("stream_max", 3))
