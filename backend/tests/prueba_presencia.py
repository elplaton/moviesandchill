"""La última conexión de cada cuenta (services/presencia.py): se apunta en
memoria en cada petición, se vuelca a la base de datos de vez en cuando y la
lista del panel toma lo más reciente de los dos sitios.

    PYTHONPATH=backend venv/bin/python backend/tests/prueba_presencia.py
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

os.environ["TMD_JWT_SECRET"] = "secreto-de-pruebas-bastante-largo"

from fastapi.security import HTTPAuthorizationCredentials

from app.auth import dependencies, service
from app.database import connection
from app.services import presencia

fallos = []


def comprueba(nombre, esperado, obtenido):
    if esperado == obtenido:
        print(f"  ok  {nombre}")
    else:
        fallos.append(nombre)
        print(f"  MAL {nombre}: esperado {esperado!r}, obtenido {obtenido!r}")


class Conexion:
    def __init__(self, pool): self.pool = pool
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def executemany(self, sql, filas):
        if self.pool.falla:
            raise RuntimeError("base de datos caida")
        self.pool.escrito.extend(filas)


class Pool:
    def __init__(self): self.escrito, self.falla = [], False
    def acquire(self): return Conexion(self)


async def main():
    pool = Pool()
    connection.get_pool = lambda: pool
    secreto = os.environ["TMD_JWT_SECRET"]

    print("Se apunta al usar la app")
    await dependencies.get_current_user(
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=service.create_access_token("ana", secreto)))
    comprueba("una peticion normal", True, "ana" in presencia._vistos)
    entrada = service.create_stream_token("luis", "Peli/peli.mp4", secreto)
    await dependencies.get_stream_user(path="Peli/peli.mp4", token=entrada)
    comprueba("y cada tramo de video que se ve", True, "luis" in presencia._vistos)
    await dependencies.get_stream_user(path="x.mp4", token=service.create_stream_token("sistema", "x.mp4", secreto))
    comprueba("pero no lo que pide el propio servidor", False, "sistema" in presencia._vistos)

    print("En linea y ultima vez")
    ahora = presencia.ultima_vez("ana", None)
    comprueba("recien usada, en linea", True, presencia.en_linea(ahora))
    hace_una_hora = datetime.now(timezone.utc) - timedelta(hours=1)
    comprueba("hace una hora, no", False, presencia.en_linea(hace_una_hora))
    comprueba("nunca, no", False, presencia.en_linea(None))
    comprueba("manda lo mas reciente: la memoria", ahora, presencia.ultima_vez("ana", hace_una_hora))
    futuro = datetime.now(timezone.utc) + timedelta(minutes=1)
    comprueba("o la base de datos si es mas nueva", futuro, presencia.ultima_vez("ana", futuro))
    comprueba("una fecha sin zona se lee como UTC", True,
              presencia.ultima_vez("nadie", hace_una_hora.replace(tzinfo=None)) == hace_una_hora)

    print("Volcar a la base de datos")
    pool.falla = True
    await presencia.volcar()
    comprueba("si falla, se queda pendiente", {"ana", "luis"}, presencia._pendientes)
    pool.falla = False
    await presencia.volcar()
    comprueba("y se escribe a la siguiente", {"ana", "luis"}, {u for u, _ in pool.escrito})
    comprueba("sin pendientes despues", set(), presencia._pendientes)
    pool.escrito.clear()
    await presencia.volcar()
    comprueba("sin nada nuevo no se escribe nada", [], pool.escrito)


asyncio.run(main())
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
