"""Comprueba `descarga_paralela.bajar()` contra un Telegram de mentira.

Varias conexiones bajan trozos alternos y cada uno se escribe en su sitio, asi
que lo que hay que vigilar es que el archivo final sea byte a byte el original
aunque las respuestas lleguen desordenadas, que una referencia caducada a mitad
se renueve, y que si una conexion falla (o se pausa la descarga) las demas se
paren antes de cerrar el archivo.

    PYTHONPATH=backend venv/bin/python backend/tests/prueba_descarga_paralela.py
"""
import asyncio
import os
import random
import sys
import tempfile
from types import SimpleNamespace

from telethon import errors, types

from app.services import descarga_paralela as dp

fallos = []


def comprueba(nombre, esperado, obtenido):
    if esperado == obtenido:
        print(f"  ok  {nombre}")
    else:
        fallos.append(nombre)
        print(f"  MAL {nombre}: esperado {esperado!r}, obtenido {obtenido!r}")


class Sender:
    """Una conexion: lo que se manda por ella lo contesta el cliente falso."""

    def __init__(self, cliente):
        self.cliente = cliente
        self.desconectado = False

    def send(self, req):
        return asyncio.ensure_future(self.cliente.servir(req))

    async def disconnect(self):
        self.desconectado = True


class Cliente:
    """Sirve `datos` como upload.getFile, con retrasos al azar."""

    def __init__(self, datos, caduca_en=None, falla_en=None, frenos=0, frenos_premium=0, sin_mega=False):
        self.datos = datos
        self.frenos = frenos                  # FLOOD_WAIT que quedan por mandar
        self.frenos_premium = frenos_premium  # FLOOD_PREMIUM_WAIT que quedan
        self.sin_mega = sin_mega              # rechaza trozos de mas de 512 KB
        self.limites = set()
        self.referencia = b"ref-1"
        self.caduca_en = caduca_en      # offset en el que la referencia caduca
        self.falla_en = falla_en        # offset que devuelve un error definitivo
        self.peticiones = 0
        self.relecturas = 0
        self.en_vuelo = 0
        self.max_en_vuelo = 0

    async def servir(self, req):
        self.peticiones += 1
        self.limites.add(req.limit)
        self.en_vuelo += 1
        self.max_en_vuelo = max(self.max_en_vuelo, self.en_vuelo)
        try:
            await asyncio.sleep(random.uniform(0, 0.01))
            if self.sin_mega and req.limit > 512 * 1024:
                raise errors.LimitInvalidError(None)
            if self.frenos:
                self.frenos -= 1
                raise errors.FloodWaitError(None, 0)
            if self.frenos_premium:
                self.frenos_premium -= 1
                raise errors.FloodPremiumWaitError(None, 0)
            if req.offset == self.falla_en:
                raise errors.RPCError(None, "FALLO_DE_PRUEBA", 400)
            if self.caduca_en is not None and req.offset >= self.caduca_en and req.location.file_reference == b"ref-1":
                self.referencia = b"ref-2"
                raise errors.FileReferenceExpiredError(None)
            assert req.offset % req.limit == 0 and req.limit in (dp.TROZO, dp.TROZO_PEQUENO)
            return SimpleNamespace(bytes=self.datos[req.offset:req.offset + req.limit])
        finally:
            self.en_vuelo -= 1

    async def get_messages(self, chat, ids):
        self.relecturas += 1
        return mensaje(self.datos, self.referencia)


def mensaje(datos, referencia=b"ref-1"):
    doc = types.Document(id=7, access_hash=1, file_reference=referencia, date=None,
                         mime_type="video/mp4", size=len(datos), dc_id=2, attributes=[])

    async def get_input_chat():
        return "canal"

    return SimpleNamespace(id=99, media=SimpleNamespace(document=doc), get_input_chat=get_input_chat)


senders = []


async def abrir_falso(client, dc_id, n):
    nuevos = [Sender(client) for _ in range(n)]
    senders.extend(nuevos)
    return nuevos


dp._abrir_conexiones = abrir_falso
dir_ = tempfile.mkdtemp()


async def caso(nombre, tamano, conexiones=6, **kw):
    datos = os.urandom(tamano)
    cliente = Cliente(datos, **kw)
    destino = os.path.join(dir_, nombre)
    avance = []
    await dp.bajar(cliente, mensaje(datos), destino, conexiones, lambda a, t: avance.append((a, t)))
    with open(destino, "rb") as f:
        return datos, f.read(), cliente, avance


async def main():
    print("Reparto de trozos")
    comprueba("un archivo pequeño va por una sola conexion", [3], dp.reparto(3, 6))
    comprueba("los trozos se reparten sin perder ninguno", 101, sum(dp.reparto(101, 6)))
    comprueba("como mucho las conexiones pedidas", 6, len(dp.reparto(10_000, 6)))

    print("Archivo con el ultimo trozo corto")
    tam = dp.TROZO * 37 + 12345
    datos, bajado, cliente, avance = await caso("a.bin", tam)
    comprueba("el archivo es identico al original", True, datos == bajado)
    comprueba("una peticion por trozo", 38, cliente.peticiones)
    comprueba("hay peticiones a la vez", True, cliente.max_en_vuelo > 1)
    comprueba("el progreso acaba en el total", (tam, tam), avance[-1])
    comprueba("se cierran todas las conexiones", True, all(s.desconectado for s in senders))

    print("Tamaño exacto en trozos")
    datos, bajado, _, _ = await caso("b.bin", dp.TROZO * 24)
    comprueba("el archivo es identico al original", True, datos == bajado)

    print("La referencia caduca a mitad")
    datos, bajado, cliente, _ = await caso("c.bin", dp.TROZO * 40 + 7, caduca_en=dp.TROZO * 20)
    comprueba("el archivo es identico al original", True, datos == bajado)
    comprueba("el mensaje se relee una sola vez", 1, cliente.relecturas)

    print("Una conexion falla")
    senders.clear()
    datos = os.urandom(dp.TROZO * 30)
    cliente = Cliente(datos, falla_en=dp.TROZO * 13)
    try:
        await dp.bajar(cliente, mensaje(datos), os.path.join(dir_, "d.bin"), 6)
        comprueba("el fallo llega a quien llama", True, False)
    except errors.RPCError:
        comprueba("el fallo llega a quien llama", True, True)
    antes = cliente.peticiones
    await asyncio.sleep(0.1)
    comprueba("las demas conexiones dejan de pedir", antes, cliente.peticiones)
    comprueba("se cierran todas las conexiones", True, all(s.desconectado for s in senders))

    print("Se pausa a mitad")
    senders.clear()
    datos = os.urandom(dp.TROZO * 200)
    cliente = Cliente(datos)
    tarea = asyncio.ensure_future(dp.bajar(cliente, mensaje(datos), os.path.join(dir_, "e.bin"), 6))
    await asyncio.sleep(0.05)
    tarea.cancel()
    try:
        await tarea
    except asyncio.CancelledError:
        pass
    antes = cliente.peticiones
    await asyncio.sleep(0.1)
    comprueba("no se piden mas trozos", antes, cliente.peticiones)
    comprueba("se cierran todas las conexiones", True, all(s.desconectado for s in senders))

    print("Telegram frena con esperas")
    datos, bajado, cliente, _ = await caso("g.bin", dp.TROZO * 6 + 99, frenos=2, frenos_premium=1)
    comprueba("el archivo es identico al original", True, datos == bajado)
    comprueba("cada espera se repite la peticion", 7 + 3, cliente.peticiones)

    print("Un DC no acepta trozos de 1 MB")
    datos, bajado, cliente, _ = await caso("h.bin", dp.TROZO * 5 + 3, sin_mega=True)
    comprueba("el archivo es identico al original", True, datos == bajado)
    comprueba("se acaba pidiendo en trozos de 512 KB", True, dp.TROZO_PEQUENO in cliente.limites)

    print("No es un documento")
    try:
        await dp.bajar(Cliente(b""), SimpleNamespace(media=SimpleNamespace()), os.path.join(dir_, "f.bin"), 6)
        comprueba("se pide la descarga normal", True, False)
    except dp.SinParalelo:
        comprueba("se pide la descarga normal", True, True)


asyncio.run(main())
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
