"""Comprueba `services/reproduccion.py`: ver sin descargar.

Lo que se vigila es que los bytes que llegan al `<video>` sean exactamente los
del video cuando el archivo esta partido en varios mensajes (un tramo que
cruza de una parte a la siguiente) o cuando cada mensaje aporta solo un
tramo suyo (los datos de cada volumen de un rar, detras de su cabecera). Lo
de mirar dentro de los comprimidos esta en `prueba_interior.py`.

    PYTHONPATH=backend <venv con telethon>/bin/python backend/tests/prueba_reproduccion.py
"""
import asyncio
import os
import random
import sys

from app.routers import download
from app.services import reproduccion as rp

fallos = []


def comprueba(nombre, esperado, obtenido):
    if esperado == obtenido:
        print(f"  ok  {nombre}")
    else:
        fallos.append(nombre)
        print(f"  MAL {nombre}: esperado {esperado!r}, obtenido {obtenido!r}")


class Doc:
    def __init__(self, datos):
        self.datos = datos
        self.size = len(datos)


class Iter:
    """Lo que devuelve `iter_download`: trozos desde `offset`, y `close()`."""

    def __init__(self, doc, offset, request_size):
        assert offset % request_size == 0, "Telegram exige offsets alineados"
        self.doc, self.pos, self.rs = doc, offset, request_size
        self.cerrado = False
        abiertos.append(self)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.pos >= self.doc.size:
            raise StopAsyncIteration
        trozo = self.doc.datos[self.pos:self.pos + self.rs]
        self.pos += self.rs
        return trozo

    async def close(self):
        self.cerrado = True


abiertos = []


class Cliente:
    def iter_download(self, doc, offset=0, request_size=rp.TROZO, file_size=None):
        return Iter(doc, offset, request_size)

    # Desde que se reconecta solo (vigilar_conexion), «Ver» pregunta antes si
    # el cliente esta conectado; el de mentira lo esta siempre.
    def is_connected(self):
        return True


class Downloader:
    client = Cliente()


download.downloader = Downloader()


def virtual_de(trozos, inicio=0, tamano=None, ext="mkv"):
    tramos, desde = [], 0
    for i, t in enumerate(trozos):
        tramos.append(rp.Tramo(1, 100 + i, Doc(t), len(t), desde))
        desde += len(t)
    return rp.Virtual("x." + ext, tramos, inicio, desde if tamano is None else tamano, ext)


async def leer(v, desde, hasta):
    return b"".join([t async for t in rp.leer(v, desde, hasta)])


def partir(datos, n):
    corte = len(datos) // n + 1
    return [datos[i:i + corte] for i in range(0, len(datos), corte)]


async def main():
    print("Lo que dice el nombre")
    for nombre, esperado in [
        ("Peli (2024).mkv", "video"), ("Peli.MP4", "video"),
        ("Peli.mkv.001", "partes"), ("Peli.mp4.002", "partes"),
        ("Peli.zip", "zip"), ("Peli (2024).zip.001", "zip"),
        ("Peli.part1.rar", "comprimido"), ("Peli.r00", "comprimido"),
        ("Peli.7z.001", "comprimido"), ("Peli.rar", "comprimido"),
        ("leeme.txt", None), (None, None),
    ]:
        comprueba(f"{nombre} -> {esperado}", esperado, rp.clasificar(nombre))
    comprueba("ver ahora en partes", True, rp.se_puede_intentar("Peli.mkv.003"))
    comprueba("no en un rar", False, rp.se_puede_intentar("Peli.part2.rar"))
    comprueba("ni en un zip: la extension decide antes de pulsar", False, rp.se_puede_intentar("Peli.zip.001"))
    comprueba("rutas tg", (-100123, 45), rp.leer_ruta(rp.ruta(-100123, 45)))
    comprueba("una ruta de disco no es tg", False, rp.es_ruta("Peli/Peli.mp4"))

    print("Partes sin comprimir")
    video = os.urandom(rp.TROZO * 5 + 12345)
    v = virtual_de(partir(video, 3))
    comprueba("el video entero", video, await leer(v, 0, len(video) - 1))
    random.seed(7)
    bien = True
    for _ in range(40):
        a = random.randrange(len(video))
        b = random.randrange(a, len(video))
        bien = bien and (await leer(v, a, b)) == video[a:b + 1]
    comprueba("40 tramos al azar, cruzando partes", True, bien)
    comprueba("los ultimos 100 bytes (lo que pide un MP4 con el moov al final)",
              video[-100:], await leer(v, len(video) - 100, len(video) - 1))
    comprueba("se cierran todas las lecturas", True, all(i.cerrado for i in abiertos))

    print("Un tramo de cada mensaje (los datos de cada volumen de un rar)")
    random.seed(11)
    cabeceras = [os.urandom(random.randrange(20, 3000)) for _ in range(3)]
    colas = [os.urandom(random.randrange(0, 500)) for _ in range(3)]
    trozos = partir(os.urandom(rp.TROZO * 4 + 999), 3)
    tramos, desde = [], 0
    for cab, t, cola in zip(cabeceras, trozos, colas):
        tramos.append(rp.Tramo(1, 200 + len(tramos), Doc(cab + t + cola), len(t), desde, len(cab)))
        desde += len(t)
    v = rp.Virtual("x.mkv", tramos, 0, desde, "mkv")
    video = b"".join(trozos)
    comprueba("el video entero, sin cabeceras ni colas", video, await leer(v, 0, len(video) - 1))
    bien = True
    for _ in range(40):
        a = random.randrange(len(video))
        b = random.randrange(a, len(video))
        bien = bien and (await leer(v, a, b)) == video[a:b + 1]
    comprueba("40 tramos al azar", True, bien)

asyncio.run(main())
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
