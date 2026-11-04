"""Comprueba `services/pasada_creditos.py`: la pasada completa de creditos.

Contra un analisis, una base y un Telegram de mentira: que vaya de tres en
tres, que se pare del todo con una descarga en marcha y baje a una tarea con
alguien viendo, que pausar y reanudar no pierdan nada y que al terminar quede
desmarcada (para no relanzarse sola tras un reinicio).

    PYTHONPATH=backend python3 backend/tests/prueba_pasada_creditos.py
"""
import asyncio
import sys
import time
import types

fallos = []


def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  MAL  ") + que + ("" if ok else f": esperado {esperado!r}, obtenido {obtenido!r}"))
    if not ok:
        fallos.append(que)


# --- De mentira ----------------------------------------------------------------
ajustes = {}
cx = types.ModuleType("app.database.connection")
async def get_app_settings(): return dict(ajustes)
async def set_app_settings(v): ajustes.update(v)
cx.get_app_settings, cx.set_app_settings = get_app_settings, set_app_settings
sys.modules["app.database.connection"] = cx

files = types.ModuleType("app.routers.files_router")
files.ultimo_tramo_visto = 0.0
sys.modules["app.routers.files_router"] = files


class Cliente:
    def is_connected(self): return True


class Downloader:
    client = Cliente()
    active_batches = {}


dl = types.ModuleType("app.routers.download")
dl.downloader = Downloader()
sys.modules["app.routers.download"] = dl

hechos, a_la_vez, maximo = [], [0], [0]
pc = types.ModuleType("app.services.proceso_creditos")
async def _medir(clave):
    a_la_vez[0] += 1
    maximo[0] = max(maximo[0], a_la_vez[0])
    await asyncio.sleep(0.05)
    a_la_vez[0] -= 1
    hechos.append(clave)
    return "hecho"
async def procesar_pelicula(tid): return await _medir(("movie", tid, 0))
async def procesar_temporada(tid, t): return await _medir(("tv", tid, t))
pc.procesar_pelicula, pc.procesar_temporada = procesar_pelicula, procesar_temporada
sys.modules["app.services.proceso_creditos"] = pc
ac = types.ModuleType("app.services.analisis_creditos")
class NoAnalizable(Exception): pass
ac.NoAnalizable = NoAnalizable
sys.modules["app.services.analisis_creditos"] = ac

from app.services import pasada_creditos as p  # noqa: E402

TODO = [("movie", i, 0, f"Peli {i}") for i in range(20)] + [("tv", 100 + i, 1, f"Serie {i}") for i in range(10)]
async def _lista():
    falta = [x for x in TODO if (x[0], x[1], x[2]) not in hechos]
    return falta, len(TODO)
p._lista = _lista
p.ESPERA_S = 0.05


async def esperar_a(cond, max_s=5.0):
    t = time.monotonic()
    while not cond() and time.monotonic() - t < max_s:
        await asyncio.sleep(0.02)


async def main():
    print("Lanzar")
    await p.lanzar()
    comprueba("queda apuntada como lanzada", "1", ajustes.get(p.CLAVE))
    await esperar_a(lambda: len(hechos) >= 6)
    comprueba("va de tres en tres", 3, maximo[0])

    print("Ceder")
    dl.downloader.active_batches = {"x": 1}
    await asyncio.sleep(0.15)
    antes = len(hechos)
    await asyncio.sleep(0.3)
    comprueba("con una descarga en marcha no coge nada nuevo", antes, len(hechos))
    comprueba("y lo dice", "descarga", p.estado().get("cediendo"))
    dl.downloader.active_batches = {}
    maximo[0] = 0
    files.ultimo_tramo_visto = time.monotonic()
    antes = len(hechos)
    await esperar_a(lambda: len(hechos) >= antes + 3)
    comprueba("con alguien viendo sigue, pero de una en una", 1, maximo[0])
    files.ultimo_tramo_visto = 0.0

    print("Pausar y reanudar")
    await p.pausar()
    comprueba("pausada ya no queda lanzada", "0", ajustes.get(p.CLAVE))
    await asyncio.sleep(0.3)
    antes = len(hechos)
    await asyncio.sleep(0.3)
    comprueba("pausada no avanza", antes, len(hechos))
    comprueba("y dice que esta en pausa", "pausada", p.estado()["estado"])
    await p.lanzar()
    await esperar_a(lambda: p.estado()["estado"] == "terminada")
    comprueba("reanudada termina", "terminada", p.estado()["estado"])
    comprueba("sin repetir ni saltarse nada", sorted((x[0], x[1], x[2]) for x in TODO), sorted(hechos))
    comprueba("y al terminar se desmarca (no se relanza al reiniciar)", "0", ajustes.get(p.CLAVE))


asyncio.run(main())
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
