"""Comprueba `vigilar_conexion()`: que el cliente de Telegram se recupere solo.

Existe por un fallo concreto: tras reiniciarse el servidor, el `connect()` del
arranque no llego a buena puerta y el cliente se quedo desconectado 16 horas
—Telethon no reintenta un primer `connect()` que falla—. Todo «Ver» de algo
no descargado contestaba 500 ("Cannot send requests while disconnected"), lo
nuevo de los canales no se indexaba y el panel decia «autorizado» con 0
canales resueltos.

Va contra un cliente de mentira: necesita telethon instalado solo para
importar el modulo.
"""
import asyncio
import sys

from app.services.telegram_client import TelegramDownloader

fallos = []
total = 0


def comprueba(que, esperado, obtenido):
    global total
    total += 1
    if esperado == obtenido:
        print(f"  ok  {que}")
    else:
        print(f"  MAL {que}: esperaba {esperado!r}, sale {obtenido!r}")
        fallos.append(que)


class Cliente:
    def __init__(self, conectado=False, autorizado=True, falla_conectar=0):
        self.conectado = conectado
        self.autorizado = autorizado
        self.falla_conectar = falla_conectar
        self.conexiones = 0
        self.resueltos = []

    def is_connected(self):
        return self.conectado

    async def connect(self):
        self.conexiones += 1
        if self.falla_conectar:
            self.falla_conectar -= 1
            raise OSError("Network is unreachable")
        self.conectado = True

    async def is_user_authorized(self):
        return self.autorizado

    async def get_entity(self, ref):
        self.resueltos.append(ref)
        return {"id": ref}


def nuevo(cliente):
    dl = TelegramDownloader({"api_id": 1, "api_hash": "x", "phone": "+34", "download_path": "/tmp"})
    dl.client = cliente
    dl.channel_ids = [{"id": 111, "name": "Uno"}, {"id": 222, "name": "Dos"}]
    return dl


async def durante(dl, segundos):
    tarea = asyncio.create_task(dl.vigilar_conexion(cada=0.01))
    await asyncio.sleep(segundos)
    dl._parado = True
    await asyncio.sleep(0.03)
    tarea.cancel()


async def main():
    print("Desconectado desde el arranque")
    c = Cliente(conectado=False)
    dl = nuevo(c)
    await durante(dl, 0.05)
    comprueba("vuelve a conectar", True, c.conectado)
    comprueba("resuelve los dos canales", [111, 222], sorted(dl.channels))

    print("La red tarda en volver")
    c = Cliente(conectado=False, falla_conectar=3)
    dl = nuevo(c)
    await durante(dl, 0.1)
    comprueba("sigue intentandolo hasta conectar", True, c.conectado)
    comprueba("y entonces resuelve los canales", [111, 222], sorted(dl.channels))

    print("Conectado y con los canales resueltos")
    c = Cliente(conectado=True)
    dl = nuevo(c)
    dl.channels = {111: {"entity": 1, "name": "Uno"}, 222: {"entity": 2, "name": "Dos"}}
    await durante(dl, 0.05)
    comprueba("no toca nada", (0, []), (c.conexiones, c.resueltos))

    print("Sin sesion (a medias de iniciarla en el panel)")
    c = Cliente(conectado=False, autorizado=False)
    dl = nuevo(c)
    await durante(dl, 0.05)
    comprueba("no intenta resolver canales sin sesion", [], c.resueltos)

    print("Un canal que no se resuelve con la conexion viva")
    c = Cliente(conectado=True)
    dl = nuevo(c)
    dl.channels = {111: {"entity": 1, "name": "Uno"}}
    dl._canales_intentados = __import__("time").monotonic()
    await durante(dl, 0.05)
    comprueba("no se reintenta en cada vuelta", [], c.resueltos)

    print("Apagando")
    c = Cliente(conectado=False)
    dl = nuevo(c)
    dl._parado = True
    tarea = asyncio.create_task(dl.vigilar_conexion(cada=0.01))
    await asyncio.sleep(0.05)
    comprueba("no vuelve a conectar tras stop()", 0, c.conexiones)
    comprueba("y el vigilante termina", True, tarea.done())


asyncio.run(main())
print()
print(f"{total - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
