"""Cache compartida en Redis.

Por que hace falta. Las pantallas de la app no son lentas por la red sino por
lo que el servidor tiene que recalcular en cada visita, y siempre lo mismo:

* **La portada** agrupa `media_items` (250.000 filas) por titulo en *cada*
  consulta de *cada* fila. Son cuatro consultas pesadas por visita y la parte
  cara es identica en todas.
* **La ficha de un titulo** (`/media/{id}/files`) recorre **la biblioteca
  entera en disco** para saber que esta descargado. Eso es un `os.walk` de
  miles de ficheros cada vez que alguien abre una caratula.
* **Las pistas de un archivo** (`/media/tracks`) lanzan `ffprobe`. Es un
  proceso nuevo, y la respuesta no cambia mientras el archivo no cambie.
* **El buscador** dispara una consulta por tecla.

Tres decisiones:

1. **Si Redis no esta, no pasa nada.** `iniciar()` deja la cache desactivada
   y todas las funciones se vuelven transparentes: `leer()` devuelve None y
   `recordar()` calcula siempre. El desarrollo en local y el `docker-compose`
   de casa no necesitan Redis para funcionar, solo para ir mas rapido. Una
   cache que tumba la aplicacion cuando se cae es peor que no tenerla.
2. **Se invalida por prefijo, no por clave.** Al terminar una descarga no se
   sabe que fichas la mencionaban, asi que se olvida el espacio entero
   (`olvidar("ficha")`). El barrido va en segundo plano: invalidar nunca debe
   frenar la peticion que lo provoco.
3. **Nada de lo que es de una cuenta se guarda sin su id en la clave.** Es el
   mismo error que ya se cometio dos veces en el navegador (ver AGENTS.md,
   «lo unico que vive en el navegador es la sesion»): aqui seria peor, porque
   una clave compartida ensenaria los favoritos de uno a todos los demas.
   `clave()` **no deja** construir una entrada de un espacio personal sin
   `user_id`: levanta ValueError en vez de guardarla compartida.
"""
import asyncio
import json
import logging
import time

logger = logging.getLogger("tmd")

# Prefijo de todas las claves. Si el Redis se comparte con otra cosa, esto es
# lo que las mantiene separadas.
PREFIJO = "mc"

# Cuanto vive cada espacio. Son valores distintos a proposito:
#
#   portada  La fila rota con la semilla de la sesion, asi que repetirla unos
#            minutos no se nota; lo que se nota es la espera.
#   ficha    Lleva "que esta descargado", y eso cambia al acabar una descarga.
#            Se invalida a mano cuando pasa, asi que el TTL es solo la red de
#            seguridad.
#   disco    El listado de la biblioteca, igual.
#   pistas   Depende del archivo, y el archivo no cambia: la clave lleva su
#            fecha de modificacion, asi que puede vivir mucho.
#   busqueda Corta: se escribe rapido y un resultado de hace un minuto ya
#            parece roto.
TTL = {
    "portada": 300,
    "fila": 300,
    "ficha": 600,
    "disco": 600,
    "pistas": 86400,
    "busqueda": 60,
    "tmdb": 86400,
    # El conjunto de nombres de archivo que hay en la biblioteca. No es de
    # nadie (es un hecho del disco) y lo piden la ficha y el buscador, que lo
    # recorrian entero cada uno por su cuenta.
    "nombres": 600,
}

# Espacios cuyo contenido es de una cuenta concreta. En estos, `recordar()`
# exige `user_id`: sin el, dos cuentas compartirian la misma entrada.
PERSONALES = {"portada", "fila", "ficha", "disco", "busqueda"}

_redis = None
_activa = False
_url = ""
# Para el panel: cuantas respuestas se han servido de la cache y cuantas no.
_aciertos = 0
_fallos = 0
_errores = 0
_desde = 0.0


async def iniciar(url: str) -> bool:
    """Conecta con Redis. Devuelve si la cache queda activa.

    Un fallo aqui no es fatal a proposito: se avisa en los logs y la
    aplicacion sigue sin cache.
    """
    global _redis, _activa, _url, _desde

    if not url:
        logger.info("Cache: desactivada (sin TMD_REDIS_URL)")
        return False

    try:
        import redis.asyncio as redis
    except ImportError:
        logger.warning("Cache: falta la libreria redis (pip install -r requirements.txt)")
        return False

    try:
        cliente = redis.from_url(url, encoding="utf-8", decode_responses=True,
                                 socket_connect_timeout=3, socket_timeout=3,
                                 health_check_interval=30)
        await cliente.ping()
    except Exception as e:
        logger.warning("Cache: no se pudo conectar a Redis (%s): %s", _sin_credenciales(url), e)
        return False

    _redis, _activa, _url, _desde = cliente, True, url, time.time()
    logger.info("Cache: Redis listo en %s", _sin_credenciales(url))
    return True


async def cerrar() -> None:
    global _redis, _activa
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
    _redis, _activa = None, False


def activa() -> bool:
    return _activa


def _sin_credenciales(url: str) -> str:
    """La URL para los logs, sin la contraseña."""
    if "@" not in url:
        return url
    esquema, resto = url.split("://", 1) if "://" in url else ("", url)
    return f"{esquema}://***@{resto.rsplit('@', 1)[-1]}" if esquema else f"***@{resto.rsplit('@', 1)[-1]}"


def clave(espacio: str, *partes, user_id: int | str | None = None) -> str:
    """La clave de una entrada: `mc:<espacio>:<cuenta>:<partes>`.

    El espacio va delante porque es por lo que se invalida, y la cuenta
    inmediatamente despues para que se vea de un vistazo —abriendo un
    `redis-cli --scan`— que nada personal esta compartido. `user_id` vale
    tambien el nombre de usuario: tambien identifica a una sola cuenta, y
    ahorra una consulta a quien solo tiene ese dato a mano.
    """
    if espacio in PERSONALES and user_id is None:
        raise ValueError(f"El espacio '{espacio}' es de una cuenta: falta user_id")
    cuenta = str(user_id) if user_id is not None else "-"
    cola = ":".join("" if p is None else str(p) for p in partes)
    return f"{PREFIJO}:{espacio}:{cuenta}:{cola}"


async def leer(clave_: str):
    """El valor guardado, o None si no esta (o si la cache no esta activa)."""
    global _aciertos, _fallos, _errores
    if not _activa:
        return None
    try:
        crudo = await _redis.get(clave_)
    except Exception as e:
        _errores += 1
        logger.debug("Cache: fallo al leer %s: %s", clave_, e)
        return None
    if crudo is None:
        _fallos += 1
        return None
    _aciertos += 1
    try:
        return json.loads(crudo)
    except ValueError:
        return None


async def escribir(clave_: str, valor, ttl: int) -> None:
    global _errores
    if not _activa:
        return
    try:
        await _redis.set(clave_, json.dumps(valor, ensure_ascii=False, default=str), ex=ttl)
    except Exception as e:
        _errores += 1
        logger.debug("Cache: fallo al guardar %s: %s", clave_, e)


async def recordar(espacio: str, partes: list, calcular, *, user_id: int | str | None = None,
                   ttl: int | None = None):
    """Lo que haya guardado para esta clave; si no hay nada, `calcular()`.

    `calcular` es una funcion sin argumentos que devuelve un awaitable. Se
    llama **solo** si no hay nada en cache, asi que el trabajo caro no se hace
    por tenerlo escrito arriba.

    Si lo calculado es None no se guarda: un None suele ser un fallo, y
    cachear un fallo lo convierte en permanente durante todo el TTL.
    """
    if not _activa:
        return await calcular()
    k = clave(espacio, *partes, user_id=user_id)
    guardado = await leer(k)
    if guardado is not None:
        return guardado
    valor = await calcular()
    if valor is not None:
        await escribir(k, valor, ttl if ttl is not None else TTL.get(espacio, 300))
    return valor


async def _barrer(prefijos: tuple[str, ...]) -> int:
    """Borra todas las claves de esos espacios. Devuelve cuantas.

    Va con SCAN y no con KEYS: KEYS bloquea el servidor entero mientras
    recorre el espacio de claves, y aqui se llama justo al terminar una
    descarga, que es cuando la app esta siendo usada.
    """
    if not _activa:
        return 0
    total = 0
    try:
        for espacio in prefijos:
            patron = f"{PREFIJO}:{espacio}:*"
            lote: list[str] = []
            async for k in _redis.scan_iter(match=patron, count=500):
                lote.append(k)
                if len(lote) >= 500:
                    total += await _redis.unlink(*lote)
                    lote = []
            if lote:
                total += await _redis.unlink(*lote)
    except Exception as e:
        logger.debug("Cache: fallo al invalidar %s: %s", prefijos, e)
    return total


def olvidar(*espacios: str) -> None:
    """Invalida uno o varios espacios, **en segundo plano**.

    No se espera a que acabe: lo llaman sitios como «ha terminado una
    descarga» o «se ha borrado un archivo», y ninguno de ellos debe esperar a
    que Redis termine de barrer. Si el barrido falla, las entradas caducan
    solas por su TTL.
    """
    if not _activa or not espacios:
        return
    from app.tasks import spawn
    try:
        spawn(_barrer(espacios), f"cache_olvidar_{'_'.join(espacios)}")
    except RuntimeError:
        # Sin bucle de eventos (un script, un test): no hay nada que invalidar.
        pass


async def vaciar() -> int:
    """Borra todo lo que esta cache tenga guardado. Es lo que hace el boton
    del panel; no toca nada mas del Redis, solo lo que lleva el prefijo."""
    return await _barrer(tuple(TTL.keys()))


def estado() -> dict:
    """Para el panel de administracion: si esta activa y si sirve de algo."""
    consultas = _aciertos + _fallos
    return {
        "activa": _activa,
        "url": _sin_credenciales(_url) if _url else "",
        "aciertos": _aciertos,
        "fallos": _fallos,
        "errores": _errores,
        "tasa": round(_aciertos / consultas * 100, 1) if consultas else 0.0,
        "desde": _desde,
    }


async def info() -> dict:
    """Lo que dice el propio Redis: cuantas claves nuestras hay y cuanta
    memoria usa. Se pide al panel, no en cada peticion."""
    datos = estado()
    if not _activa:
        return datos
    try:
        memoria = await _redis.info("memory")
        datos["memoria"] = memoria.get("used_memory_human", "")
        claves = 0
        async for _ in _redis.scan_iter(match=f"{PREFIJO}:*", count=500):
            claves += 1
        datos["claves"] = claves
    except Exception as e:
        datos["error"] = str(e)[:120]
    return datos


# --- Invalidaciones con nombre -------------------------------------------
#
# Existen para que quien provoca el cambio no tenga que saber que espacios
# hay: «ha cambiado el disco» es una frase que se entiende, y la lista de
# espacios afectados se mantiene aqui, en un sitio.

def cambio_en_disco() -> None:
    """Ha acabado una descarga, o se ha borrado un archivo."""
    olvidar("disco", "nombres", "ficha", "busqueda", "portada", "fila")


def cambio_en_catalogo() -> None:
    """Se ha reindexado, reclasificado, o se han tocado los canales."""
    olvidar("portada", "fila", "ficha", "busqueda")


def cambio_en_tmdb() -> None:
    """Se han vuelto a emparejar titulos con TMDB: las fichas cambian."""
    olvidar("portada", "fila", "ficha")


def cambio_de_cuenta(user_id: int) -> None:
    """Ha cambiado algo que solo afecta a una cuenta (favoritos, lo visto).

    Se barre el espacio entero y no solo las claves de esa cuenta: filtrar por
    cuenta obligaria a un patron por espacio y el ahorro no vale la
    complicacion, porque estas dos cosas se tocan de una en una (un corazon,
    un «ya me la he visto»), no en rafagas.
    """
    olvidar("portada", "fila")


def cambio_en_archivo(ruta: str) -> None:
    """Un archivo concreto se ha convertido o reemplazado: sus pistas ya no
    valen. La clave lleva la fecha de modificacion, asi que con cambiarla ya
    quedaria fuera; esto es por no dejar basura."""
    olvidar("pistas")
