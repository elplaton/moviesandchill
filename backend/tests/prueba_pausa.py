"""Pausar y reanudar enseguida: el lote reanudado tiene que seguir visible y gobernable.

La tarea pausada sigue viva unos segundos despues de pausar y, al acabar,
quitaba de `active_batches` y `_batch_tasks` lo que hubiera con su batch_id,
que para entonces era ya la reanudacion: esta seguia bajando sin salir en
Descargas, sin poder pausarse y sin que "Descargar" la viera, asi que se
podia lanzar otra encima. Sin base de datos ni Telegram: todo es de mentira.

Necesita fastapi y pydantic (el venv del backend):
    PYTHONPATH=backend python3 backend/tests/prueba_pausa.py
"""
import asyncio, os, sys, tempfile, types

estado = tempfile.mkdtemp(); os.environ["TMD_STATE_DIR"] = estado
biblio = tempfile.mkdtemp()
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

for nombre in ("rarfile", "py7zr"):
    sys.modules.setdefault(nombre, types.ModuleType(nombre))
ext = types.ModuleType("app.services.extractor")
ext.extract_archive = lambda *a: ([], False); ext.find_first_archive = lambda f: None
sys.modules["app.services.extractor"] = ext
ws = types.ModuleType("app.routers.ws_router")
async def _bc(*a, **k): pass
ws.broadcast_progress = _bc
sys.modules["app.routers.ws_router"] = ws

import app.routers.download_router as R

# Base de datos de mentira
filas = {}
dbmod = types.ModuleType("app.database.downloads")
async def set_download_status(path, st, size=None): filas.setdefault(path, {})["status"] = st
async def get_download_by_path(path): return {"owner_id": 1, "owner": "spi", **filas[path]} if path in filas else None
async def create_download(*a): filas[a[2]] = {"status": a[-1]}
async def delete_download(path): filas.pop(path, None)
async def move_download(old, new, st, size): filas[new] = {"status": st}; filas.pop(old, None)
def dir_size(p): return 0
async def find_existing(*a): return None
async def usage_by_user(*a): return 0
for f in (find_existing, usage_by_user, set_download_status, get_download_by_path, create_download, delete_download, move_download, dir_size):
    setattr(dbmod, f.__name__, f)
sys.modules["app.database.downloads"] = dbmod
cache = types.ModuleType("app.services.cache"); cache.cambio_en_disco = lambda: None
sys.modules["app.services.cache"] = cache
R.finalize_episode = lambda folder, final_dir, stem: []


class DLFalso:
    def __init__(self): self.active_batches = {}; self.bajadas = 0
    async def download_to_folder(self, mid, folder, progress_callback=None, channel_id=None):
        self.bajadas += 1
        ruta = os.path.join(folder, "Oppenheimer.mkv")
        with open(ruta, "wb") as f: f.write(b"x")
        await asyncio.sleep(0.6)  # "descargando"
        with open(ruta, "ab") as f: f.write(b"y" * 99)


fallos = []
def comprueba(que, ok):
    print(("  ok    " if ok else "  FALLA ") + que)
    if not ok: fallos.append(que)


async def main():
    dl = DLFalso()
    R.init_download_router(dl, {"extract_path": biblio, "download_parallel": 3})
    folder = os.path.join(biblio, "Oppenheimer (2023)", ".dl_0_1")
    os.makedirs(folder)
    filas[folder] = {"status": "downloading"}
    dl.active_batches["0_1"] = {
        "batch_id": "0_1", "owner": "spi", "owner_id": 1, "folder_name": "Oppenheimer (2023)", "folder_path": folder,
        "kind": "movie", "final_dir": os.path.dirname(folder), "final_stem": None,
        "parts": [{"message_id": 1, "channel_id": None, "file_name": "Oppenheimer.mkv", "size": 100, "size_str": "", "downloaded": 0, "progress": 0, "status": "pending"}],
        "total_parts": 1, "downloaded_parts": 0, "total_size": 100, "total_size_str": "", "downloaded_size": 0,
        "progress": 0, "status": "downloading", "extracted_files": [], "error": None}
    R._lanzar("0_1")
    await asyncio.sleep(0.2)
    cuenta = {"id": 1, "role": "user", "username": "spi"}

    r = await R.pause(R.PauseRequest(batch_id="0_1"), cuenta)
    comprueba("se pausa", r.get("status") == "paused")
    comprueba("la parte a medias se ha borrado antes de contestar", not os.path.exists(os.path.join(folder, "Oppenheimer.mkv")))

    r = await R.resume(R.PauseRequest(batch_id="0_1"), None, cuenta)
    comprueba("se reanuda", r.get("status") == "resumed")

    # Dejar que la tarea vieja acabe su espera de 10 s (aqui acortada).
    await asyncio.sleep(0.3)
    comprueba("el lote reanudado sigue en /status", "0_1" in dl.active_batches)
    comprueba("y se puede pausar o cancelar (tiene tarea)", "0_1" in R._batch_tasks)

    r = await R.iniciar_descarga(1, None, cuenta)
    comprueba("pulsar Descargar encima no lanza otra", r.get("already") is True)

    await asyncio.sleep(1.0)
    comprueba("el archivo acaba entero", os.path.getsize(os.path.join(folder, "Oppenheimer.mkv")) == 100)
    comprueba("la fila acaba en done", filas.get(folder, {}).get("status") == "done")

    # Descartar una pausa suelta la fila (y la cuota)
    folder2 = os.path.join(biblio, "Dune (2021)", ".dl_0_2"); os.makedirs(folder2)
    open(os.path.join(folder2, "Dune.part1.rar"), "wb").write(b"x")
    filas[folder2] = {"status": "paused"}
    R.save_paused_batch("0_2", {"batch_id": "0_2", "folder_name": "Dune (2021)", "folder_path": folder2, "total_parts": 1,
                                "downloaded_parts": 1, "parts": [{"message_id": 2, "file_name": "Dune.part1.rar", "status": "done"}]})
    r = await R.cancel(R.CancelRequest(batch_id="0_2"), cuenta)
    comprueba("descartar una pausada", r.get("status") == "cancelled")
    comprueba("borra su fila", folder2 not in filas)
    comprueba("borra la carpeta de trabajo", not os.path.exists(folder2))
    comprueba("y deja de salir en Pausadas", "0_2" not in R.load_paused_batches())

    # Doble clic mientras se pregunta a Telegram (18:14:38 y 18:14:39 en los
    # logs de "El diablo viste de Prada 2"): solo arranca uno.
    async def lento(mid, ch):
        await asyncio.sleep(0.3)
        return "Prada", "Prada", [{"message_id": mid, "channel_id": ch, "file_name": "Prada.mkv", "size": 100}]
    dl.find_related_parts = lento
    R.plan_layout = lambda base, fname, cat, bid: {"work_dir": os.path.join(biblio, "Prada", ".dl_" + bid),
                                                  "folder_name": "Prada", "kind": "movie", "final_dir": os.path.join(biblio, "Prada")}
    media = types.ModuleType("app.database.media")
    async def get_media_item(*a): return None
    media.get_media_item = get_media_item
    sys.modules["app.database.media"] = media
    a, b = await asyncio.gather(R.iniciar_descarga(7, 9, cuenta), R.iniciar_descarga(7, 9, cuenta))
    comprueba("el primer clic arranca", a.get("status") == "started")
    comprueba("el segundo no arranca otra", b.get("already") is True)


# La espera final de la tarea vieja es de 10 s; aqui basta con un poco.
_sleep = asyncio.sleep
async def sleep_corto(s, *a, **k): return await _sleep(min(s, 0.05) if s >= 10 else s, *a, **k)
asyncio.sleep = sleep_corto

asyncio.run(main())
print(f"\n{'todo bien' if not fallos else str(len(fallos)) + ' fallos'}")
sys.exit(1 if fallos else 0)
