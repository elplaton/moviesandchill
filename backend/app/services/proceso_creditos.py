"""Averiguar donde empiezan los creditos de un titulo (ver services/creditos.py).

El proceso, por pelicula y por temporada de una serie:

1. **¿Algun enlace los trae dados?** Se miran sus enlaces uno a uno (primero
   los que mas suelen traer capitulos: MKV, BluRay, WEB-DL...) hasta dar con
   uno que tenga un capitulo de creditos. Cuesta la cabecera de cada uno
   (1-6 MB) y, si se encuentra, el dato es exacto.
2. **Si ninguno, se mide la imagen** (services/analisis_creditos.py):
   - pelicula: el enlace de streaming **mas ligero**, y vale para todos los
     del titulo (se guarda como segundos antes del final);
   - serie: **tres episodios** de la temporada (sin el piloto, que suele tener
     creditos mas largos) y la referencia es la **mediana**. El resto de
     episodios se predice. Medido en *Breaking Bad*: la duracion de los
     creditos cambia entre temporadas (35-44 s) pero casi nada dentro de una,
     y la prevision acierta con ~3 s de error.

Y al reproducir un episodio con dato **previsto** se comprueba en paralelo
(+-30 s alrededor de la prevision, ~7 MB) y se guarda el inicio medido; si no
encaja, se mide ese episodio entero.

Todo pasa por **una cola con un solo trabajo a la vez**: la cuenta de Telegram
es una y la comparten el streaming y las descargas. Solo MKV y MP4 (los AVI y
los comprimidos no se analizan). Lo intentado se apunta en `creditos_proceso`
para no repetirlo cada vez que alguien abre el titulo.
"""
import asyncio
import json
import logging
import re
import statistics
import subprocess
import time

from app.database import creditos as db
from app.services import analisis_creditos as ac
from app.services import creditos as cr

logger = logging.getLogger("tmd")

# Un titulo sin resultado (no se pudo medir) no se reintenta antes de esto.
REINTENTAR_TRAS_S = 30 * 86400
# Episodios que se miden por temporada para sacar la referencia.
EPISODIOS_REFERENCIA = 3
# Enlaces que se prueban a medir antes de rendirse (uno puede no ser legible).
INTENTOS_MEDIR = 3
# Un enlace mucho mas pequeño que los demas del mismo titulo o episodio suele
# ser un trailer, una muestra o un archivo cortado: no sirve de «el mas ligero».
FRACCION_MINIMA = 0.4
# Una comprobacion que fallo no se repite en este rato.
REPETIR_COMPROBACION_S = 6 * 3600

_PROBABLES = re.compile(r"blu-?ray|\bbd\b|bdrip|brrip|remux|web-?dl|webrip|\bnf\b|amzn|dsnp|hmax|atvp", re.I)


# --------------------------------------------------------------- enlaces

def _extension(nombre: str) -> str:
    n = (nombre or "").lower()
    n = re.sub(r"\.\d{3,}$", "", n)
    return n.rsplit(".", 1)[-1] if "." in n else ""


def analizables(enlaces: list[dict]) -> list[dict]:
    """Los que se pueden ver en streaming y no son AVI."""
    from app.services.reproduccion import clasificar

    return [e for e in enlaces
            if clasificar(e.get("file_name")) in ("video", "partes") and _extension(e["file_name"]) != "avi"]


def orden_capitulos(enlaces: list[dict]) -> list[dict]:
    """Primero los que mas suelen traer capitulos."""
    def puntos(e):
        nombre = e.get("file_name") or ""
        return (_extension(nombre) != "mkv", not _PROBABLES.search(nombre), -(e.get("file_size") or 0))
    return sorted(enlaces, key=puntos)


def orden_ligereza(enlaces: list[dict]) -> list[dict]:
    """Del mas ligero al mas pesado, sin los sospechosamente pequeños."""
    tams = [e.get("file_size") or 0 for e in enlaces if e.get("file_size")]
    if not tams:
        return list(enlaces)
    mediana = statistics.median(tams)
    validos = [e for e in enlaces if (e.get("file_size") or 0) >= mediana * FRACCION_MINIMA]
    return sorted(validos, key=lambda e: e.get("file_size") or 0)


def _ruta(e: dict) -> str:
    from app.services.reproduccion import ruta
    return ruta(e["channel_id"], e["message_id"])


# --------------------------------------------------------------- paso 1

def _ffprobe_capitulos(url: str) -> dict | None:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-of", "json", "-show_chapters",
                            "-show_entries", "format=duration", url],
                           capture_output=True, text=True, timeout=90)
        if r.returncode != 0:
            return None
        return json.loads(r.stdout or "{}")
    except Exception:
        return None


async def capitulos_de(e: dict) -> bool:
    """Si el enlace trae un capitulo de creditos (y entonces queda guardado)."""
    from urllib.parse import quote
    from app.auth.service import create_stream_token
    from app.config import get_jwt_secret
    from app.database.reproduccion import leer as leer_guardado
    from app.routers.download import config
    from app.services.tracks import _capitulos

    path = _ruta(e)
    ya = await db.enlace(path)
    if ya and ya["fuente"] in ("capitulos", "manual"):
        return True
    guardado = await leer_guardado(e["channel_id"], e["message_id"])
    pistas = (guardado or {}).get("pistas") or {}
    if "capitulos" in pistas:
        capitulos, duracion = pistas["capitulos"], pistas.get("duration")
    else:
        token = create_stream_token("sistema", path, get_jwt_secret())
        url = (f"http://127.0.0.1:{config.get('server_port', 8000)}/api/stream"
               f"?path={quote(path)}&token={quote(token)}")
        datos = await asyncio.to_thread(_ffprobe_capitulos, url)
        if datos is None:
            return False
        capitulos = _capitulos(datos.get("chapters") or [])
        try:
            duracion = float((datos.get("format") or {}).get("duration"))
        except (TypeError, ValueError):
            duracion = None
    await cr.recoger_capitulos(path, {"capitulos": capitulos, "duration": duracion})
    ahora = await db.enlace(path)
    return bool(ahora and ahora["fuente"] in ("capitulos", "manual"))


async def _buscar_capitulos(enlaces: list[dict]) -> str | None:
    for e in orden_capitulos(enlaces):
        try:
            if await capitulos_de(e):
                return _ruta(e)
        except Exception as ex:
            logger.info("Creditos: no se pudo mirar la cabecera de %s: %s", e.get("file_name"), ex)
    return None


# --------------------------------------------------------------- paso 2

async def medir_enlace(e: dict) -> dict:
    """Mide un enlace por imagen: {inicio, duracion, mb, ...}."""
    path = _ruta(e)
    leer, tam = await ac.lector_tg(path)
    t0 = time.monotonic()
    r = await ac.medir(leer, tam)
    r["mb"] = round(leer.gastado["bytes"] / 1e6, 1)
    logger.info("Creditos de %s por imagen: %s de %s · %.1f MB · %.0f s · %s",
                e.get("file_name"), r["inicio"], round(r["duracion"]), r["mb"], time.monotonic() - t0, r["serie"])
    return r


async def _medir_alguno(enlaces: list[dict]) -> tuple[dict, dict] | None:
    """Mide el mas ligero que se deje (uno puede no ser legible)."""
    for e in orden_ligereza(enlaces)[:INTENTOS_MEDIR]:
        try:
            return e, await medir_enlace(e)
        except ac.NoAnalizable as ex:
            logger.info("Creditos: %s no se puede analizar: %s", e.get("file_name"), ex)
    return None


def _ya_intentado(p: dict | None) -> bool:
    if not p:
        return False
    if p["estado"] == "hecho":
        return True
    return p["estado"] in ("sin_resultado", "no_analizable") and (p.get("hace") or 0) < REINTENTAR_TRAS_S


async def procesar_pelicula(tmdb_id: int) -> str:
    """Pasos 1 y 2 de una pelicula. Devuelve como acabo."""
    if _ya_intentado(await db.proceso(tmdb_id, "movie", 0)):
        return "ya"
    if await db.referencia(tmdb_id, "movie", 0):
        await db.marcar_proceso(tmdb_id, "movie", 0, "hecho", "ya tenia referencia")
        return "hecho"
    enlaces = analizables(await db.enlaces_de_titulo(tmdb_id, "movie"))
    if not enlaces:
        await db.marcar_proceso(tmdb_id, "movie", 0, "no_analizable", "sin enlaces MKV/MP4 en streaming")
        return "no_analizable"
    if await _buscar_capitulos(enlaces):
        await db.marcar_proceso(tmdb_id, "movie", 0, "hecho", "capitulos")
        return "hecho"
    medido = await _medir_alguno(enlaces)
    if not medido:
        await db.marcar_proceso(tmdb_id, "movie", 0, "no_analizable", "ningun enlace legible")
        return "no_analizable"
    e, r = medido
    if r["inicio"] is None:
        await cr.guardar_medicion(_ruta(e), inicio=None, duracion=r["duracion"], fuente="imagen",
                                  estado="sin_creditos", tmdb_id=tmdb_id, tmdb_type="movie")
        await db.marcar_proceso(tmdb_id, "movie", 0, "sin_resultado", r["serie"][-80:])
        return "sin_resultado"
    await cr.guardar_medicion(_ruta(e), inicio=r["inicio"], duracion=r["duracion"], fuente="imagen",
                              tmdb_id=tmdb_id, tmdb_type="movie")
    await db.marcar_proceso(tmdb_id, "movie", 0, "hecho", f"imagen · {r['mb']} MB")
    return "hecho"


async def procesar_temporada(tmdb_id: int, temporada: int) -> str:
    """Pasos 1 y 2 de una temporada de una serie."""
    if _ya_intentado(await db.proceso(tmdb_id, "tv", temporada)):
        return "ya"
    ref = await db.referencia(tmdb_id, "tv", temporada)
    if ref and ref.get("temporada") == temporada:
        await db.marcar_proceso(tmdb_id, "tv", temporada, "hecho", "ya tenia referencia")
        return "hecho"
    enlaces = [e for e in analizables(await db.enlaces_de_titulo(tmdb_id, "tv"))
               if e.get("season") == temporada and e.get("episode") is not None]
    if not enlaces:
        await db.marcar_proceso(tmdb_id, "tv", temporada, "no_analizable", "sin enlaces MKV/MP4 en streaming")
        return "no_analizable"
    if await _buscar_capitulos(enlaces):
        await db.marcar_proceso(tmdb_id, "tv", temporada, "hecho", "capitulos")
        return "hecho"

    por_episodio: dict[int, list[dict]] = {}
    for e in enlaces:
        por_episodio.setdefault(e["episode"], []).append(e)
    duraciones, gasto = [], 0.0
    for ep in sorted(por_episodio):
        if temporada == 1 and ep == 1:
            continue   # el piloto: creditos mas largos (en Breaking Bad, 54 s frente a 43)
        medido = await _medir_alguno(por_episodio[ep])
        if not medido:
            continue
        e, r = medido
        gasto += r["mb"]
        if r["inicio"] is not None:
            duraciones.append(r["duracion"] - r["inicio"])
            await cr.guardar_medicion(_ruta(e), inicio=r["inicio"], duracion=r["duracion"], fuente="imagen",
                                      tmdb_id=tmdb_id, tmdb_type="tv", temporada=temporada, referencia=False)
        if len(duraciones) >= EPISODIOS_REFERENCIA:
            break
    if not duraciones:
        await db.marcar_proceso(tmdb_id, "tv", temporada, "sin_resultado", f"{gasto:.0f} MB")
        return "sin_resultado"
    antes = round(statistics.median(duraciones), 2)
    await db.guardar_referencia(tmdb_id, "tv", temporada, antes_del_final=antes, fuente="imagen",
                                ruta=None, duracion=None)
    await db.guardar_referencia(tmdb_id, "tv", 0, antes_del_final=antes, fuente="imagen",
                                ruta=None, duracion=None, solo_si_no_hay=True)
    logger.info("Creditos de la temporada %s de tv/%s: ultimos %.1f s (mediana de %s) · %.0f MB",
                temporada, tmdb_id, antes, [round(d, 1) for d in duraciones], gasto)
    await db.marcar_proceso(tmdb_id, "tv", temporada, "hecho",
                            f"imagen · mediana de {len(duraciones)} · {gasto:.0f} MB")
    return "hecho"


async def comprobar_enlace(path: str, previsto: float) -> str:
    """Al reproducir un enlace con dato previsto: mirar si los creditos
    empiezan ahi y guardar lo medido. Si no encaja, se mide entero."""
    leer, tam = await ac.lector_tg(path)
    r = await ac.comprobar(leer, tam, previsto)
    if r["estado"] == "ok":
        await cr.guardar_medicion(path, inicio=r["inicio"], duracion=r["duracion"], fuente="imagen",
                                  estado="verificado", referencia=False)
        logger.info("Creditos de %s comprobados: %.0f (previsto %.0f) · %.1f MB",
                    path, r["inicio"], previsto, leer.gastado["bytes"] / 1e6)
        return "verificado"
    m = await ac.medir(leer, tam)
    if m["inicio"] is not None:
        await cr.guardar_medicion(path, inicio=m["inicio"], duracion=m["duracion"], fuente="imagen",
                                  referencia=False)
        estado = "medido"
    else:
        await cr.guardar_medicion(path, inicio=None, duracion=m["duracion"], fuente="imagen",
                                  estado="no_encaja", referencia=False)
        estado = "no_encaja"
    logger.info("Creditos de %s: la prevision (%.0f) no encajaba (%s) -> %s %s · %.1f MB",
                path, previsto, r["estado"], estado, m["inicio"], leer.gastado["bytes"] / 1e6)
    return estado


# --------------------------------------------------------------- cola

_cola: asyncio.Queue | None = None
_en_cola: set[tuple] = set()
_comprobados: dict[str, float] = {}


def _encolar(clave: tuple, fabrica) -> bool:
    global _cola
    if clave in _en_cola:
        return False
    if _cola is None:
        from app.tasks import spawn
        _cola = asyncio.Queue()
        spawn(_trabajador(), "creditos")
    _en_cola.add(clave)
    _cola.put_nowait((clave, fabrica))
    return True


async def _trabajador():
    """Uno a la vez: la cuenta de Telegram es una para todo."""
    while True:
        clave, fabrica = await _cola.get()
        try:
            resultado = await fabrica()
            logger.info("Creditos %s: %s", clave, resultado)
        except ac.NoAnalizable as e:
            logger.info("Creditos %s: no se puede analizar: %s", clave, e)
        except Exception as e:
            # Lo pasajero (Telegram desconectado, una red que falla) no se
            # apunta: se volvera a intentar la proxima vez que alguien lo abra.
            logger.warning("Creditos %s fallo: %s", clave, e)
        finally:
            _en_cola.discard(clave)


async def al_reproducir(path: str, respuesta: dict, *, tmdb_id: int | None = None,
                        tmdb_type: str | None = None, temporada: int | None = None) -> None:
    """Lo que dispara abrir un enlace en el reproductor (lo llama GET
    /api/creditos): sin dato, el proceso de su titulo o temporada; con dato
    previsto, comprobarlo. Solo enlaces de Telegram; lo descargado se mira al
    convertirlo."""
    from app.services import reproduccion

    if not reproduccion.es_ruta(path):
        return
    if respuesta.get("origen") == "previsto" and respuesta.get("inicio"):
        ultimo = _comprobados.get(path)
        if ultimo and time.monotonic() - ultimo < REPETIR_COMPROBACION_S:
            return
        _comprobados[path] = time.monotonic()
        previsto = respuesta["inicio"]
        _encolar(("comprobar", path), lambda: comprobar_enlace(path, previsto))
        return
    if respuesta.get("origen") is not None:
        return
    tid, tipo, temp = await cr._titulo(path, tmdb_id, tmdb_type, temporada)
    if not tid or not tipo:
        return
    if tipo == "movie":
        _encolar(("pelicula", tid), lambda: procesar_pelicula(tid))
    elif temp:
        _encolar(("temporada", tid, temp), lambda: procesar_temporada(tid, temp))
