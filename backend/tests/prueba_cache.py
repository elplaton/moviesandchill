"""Comprueba la cache contra un Redis de mentira.

De mentira y no uno de verdad porque lo que puede salir mal aqui no es Redis
—eso ya funciona— sino lo nuestro, y son tres cosas:

1. **Que nada de una cuenta se guarde con una clave compartida.** Es el mismo
   error que ya se cometio dos veces en el navegador (ver AGENTS.md, «lo unico
   que vive en el navegador es la sesion»), y aqui seria peor: una clave sin
   la cuenta dentro le enseñaria los favoritos de uno a todos los demas.
2. **Que invalidar borre lo que tiene que borrar y nada mas.** Al acabar una
   descarga se tiran las fichas y el listado del disco, pero no las pistas de
   los archivos ni lo que no es nuestro.
3. **Que sin Redis todo siga funcionando.** `recordar()` tiene que calcular
   igual y no guardar nada.

Se lanza solo, sin framework y sin servidor:
  PYTHONPATH=backend python3 backend/tests/prueba_cache.py
"""
import asyncio, fnmatch, sys

from app.services import cache


class RedisFalso:
    """Lo justo de la interfaz de redis.asyncio que usa `cache.py`."""

    def __init__(self):
        self.datos: dict[str, str] = {}
        self.ttl: dict[str, int] = {}

    async def get(self, k):
        return self.datos.get(k)

    async def set(self, k, v, ex=None):
        self.datos[k] = v
        self.ttl[k] = ex

    async def scan_iter(self, match=None, count=None):
        for k in list(self.datos):
            if match is None or fnmatch.fnmatch(k, match):
                yield k

    async def unlink(self, *claves):
        n = 0
        for k in claves:
            if self.datos.pop(k, None) is not None:
                self.ttl.pop(k, None)
                n += 1
        return n

    async def info(self, _seccion):
        return {"used_memory_human": "1.2M"}


fallos = []
def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  FALLA ") + que)
    if not ok:
        fallos.append(que)
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")


async def principal():
    print("\nSin Redis la aplicacion funciona igual")
    veces = 0
    async def calcular():
        nonlocal veces
        veces += 1
        return {"v": veces}
    comprueba("recordar calcula", {"v": 1}, await cache.recordar("ficha", [1], calcular, user_id=7))
    comprueba("y vuelve a calcular, porque no hay donde guardar",
              {"v": 2}, await cache.recordar("ficha", [1], calcular, user_id=7))
    comprueba("leer no devuelve nada", None, await cache.leer("lo que sea"))
    comprueba("activa() dice que no", False, cache.activa())

    # A partir de aqui, con cache.
    falso = RedisFalso()
    cache._redis = falso
    cache._activa = True

    print("\nLas claves llevan la cuenta dentro")
    comprueba("una entrada personal nombra a su cuenta",
              "mc:ficha:7:1550:tv", cache.clave("ficha", 1550, "tv", user_id=7))
    comprueba("una entrada que no es de nadie lleva un guion",
              "mc:pistas:-:peli.mp4:99", cache.clave("pistas", "peli.mp4", 99))
    try:
        cache.clave("ficha", 1550)
        comprueba("un espacio personal sin cuenta no se deja construir", "error", "se construyo")
    except ValueError:
        comprueba("un espacio personal sin cuenta no se deja construir", "error", "error")

    print("\nRecordar")
    veces = 0
    comprueba("la primera vez calcula", {"v": 1}, await cache.recordar("ficha", [1], calcular, user_id=7))
    comprueba("la segunda ya no", {"v": 1}, await cache.recordar("ficha", [1], calcular, user_id=7))
    comprueba("y solo se ha calculado una vez", 1, veces)
    comprueba("otra cuenta no ve lo de la primera",
              {"v": 2}, await cache.recordar("ficha", [1], calcular, user_id=8))

    async def nada():
        return None
    await cache.recordar("ficha", ["vacio"], nada, user_id=7)
    comprueba("un None no se guarda (cachear un fallo lo haria permanente)",
              False, cache.clave("ficha", "vacio", user_id=7) in falso.datos)

    comprueba("cada espacio tiene su caducidad",
              cache.TTL["ficha"], falso.ttl[cache.clave("ficha", 1, user_id=7)])

    print("\nInvalidar")
    await cache.recordar("pistas", ["peli.mp4", 1], calcular)
    await cache.recordar("portada", ["v1", "todo"], calcular, user_id=7)
    falso.datos["otracosa:1"] = "no es nuestra"
    borradas = await cache._barrer(("ficha", "disco", "nombres", "busqueda", "portada", "fila"))
    # Tres: la ficha de la cuenta 7, la de la 8 y la portada de la 7.
    comprueba("se borran las fichas y la portada", 3, borradas)
    comprueba("las pistas sobreviven: el disco no las cambia",
              True, cache.clave("pistas", "peli.mp4", 1) in falso.datos)
    comprueba("lo que no es nuestro no se toca", True, "otracosa:1" in falso.datos)

    comprueba("vaciar deja solo lo ajeno", 1, await cache.vaciar())
    comprueba("y lo ajeno sigue ahi", ["otracosa:1"], list(falso.datos))

    print("\nEl panel")
    estado = await cache.info()
    comprueba("dice que esta activa", True, estado["activa"])
    comprueba("y cuanta memoria usa", "1.2M", estado["memoria"])
    comprueba("la tasa de acierto es un porcentaje",
              True, 0 <= estado["tasa"] <= 100)
    cache._url = "redis://usuario:secreto@cache:6379/0"
    comprueba("la contraseña no sale en el estado",
              "redis://***@cache:6379/0", cache.estado()["url"])

    cache._redis, cache._activa = None, False


asyncio.run(principal())
print()
print(f"{21 - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
