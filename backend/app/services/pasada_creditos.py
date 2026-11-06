"""La pasada completa de creditos: averiguar donde empiezan en todo el
catalogo de una vez, en vez de esperar a que alguien abra cada titulo.

Es el mismo proceso que se dispara al reproducir (`proceso_creditos`:
capitulos de algun enlace y, si no, medir la imagen del final), recorriendo
todas las peliculas y temporadas que se pueden ver sin descargar. Son unas
6.000 de cada y, por lo medido en *Breaking Bad*, cientos de GB leidos de
Telegram: uno o dos dias. Por eso:

- **Se lanza y se pausa a mano**, desde Admin -> Ajustes. Lanzada, se apunta en
  `app_settings` y **sigue sola tras un reinicio o un despliegue**; pausada, no.
- **Va segun entra**: la lista no se calcula solo al lanzarla. Cada
  `REFRESCO_S` (15 min) se vuelve a mirar que peliculas y temporadas no tienen
  sus creditos y se meten en la cola, y al acabar la cola **no se para**: se
  queda «al dia», vigilando lo nuevo. Un capitulo nuevo de una temporada ya
  medida no necesita nada (su inicio se predice de la referencia de la
  temporada); lo que entra en la cola son los titulos nuevos y las temporadas
  nuevas, que mientras tanto tiran de la referencia general de la serie.
- **Va a tres a la vez** (`TAREAS`), pero **cede**: con una descarga en marcha
  se para del todo hasta que acabe (se pidio que las descargas tengan
  preferencia), y con alguien viendo algo sin descargar sigue con una sola
  tarea para no quitarle linea. La cuenta de Telegram es una para todo.
- **Lo mas conocido primero** (votos de TMDB): si se para a medias, lo medido
  es lo que mas se ve.
- **Se reanuda donde iba** sin apuntar nada propio: `creditos_proceso` ya
  guarda que se intento cada titulo o temporada, y lo pendiente es lo que no
  tiene fila ahi.
"""
import asyncio
import logging
import time

logger = logging.getLogger("tmd")

CLAVE = "creditos_pasada"      # app_settings: "1" lanzada, "0" no
TAREAS = 3
# Cuanto hace que alguien vio un tramo para considerar que sigue viendo.
VIENDO_S = 90
# Cada cuanto se vuelve a mirar si ya se puede seguir.
ESPERA_S = 15
# Cada cuanto se mira si ha entrado algo nuevo que medir.
REFRESCO_S = 15 * 60

_estado: dict = {"estado": "parada"}
_tareas: list[asyncio.Task] = []
_activa = False
_pendientes: list[tuple] = []
# Lo que se esta midiendo ahora: aun no tiene fila en `creditos_proceso`, y al
# refrescar la lista no puede volver a entrar en la cola.
_en_curso: set[tuple] = set()
_duraciones: list[float] = []


_VIDEO = r"\.(mkv|mp4)(\.\d{3,})?$"


async def _lista() -> tuple[list[tuple], int]:
    """(pendientes, total): peliculas y temporadas con algun enlace MKV/MP4,
    de la mas votada a la menos. Pendiente es lo que no tiene fila en
    `creditos_proceso`."""
    from app.database.connection import get_pool
    async with get_pool().acquire() as conn:
        filas = await conn.fetch(f"""
            WITH t AS (
                SELECT DISTINCT mi.tmdb_type, mi.tmdb_id,
                       CASE WHEN mi.tmdb_type = 'tv' THEN mi.season ELSE 0 END AS temporada
                FROM media_items mi
                WHERE mi.tmdb_valid IS TRUE AND mi.tmdb_id IS NOT NULL
                  AND mi.file_name ~* '{_VIDEO}'
                  AND (mi.tmdb_type = 'movie' OR (mi.season IS NOT NULL AND mi.episode IS NOT NULL))
            )
            SELECT t.tmdb_type, t.tmdb_id, t.temporada, tc.title,
                   cp.tmdb_id IS NOT NULL AS hecho
            FROM t
            LEFT JOIN tmdb_cache tc ON tc.tmdb_id = t.tmdb_id AND tc.media_type = t.tmdb_type
            LEFT JOIN creditos_proceso cp ON cp.tmdb_id = t.tmdb_id AND cp.tmdb_type = t.tmdb_type
                                          AND cp.temporada = t.temporada
            ORDER BY COALESCE(tc.vote_count, 0) DESC, t.tmdb_id, t.temporada
        """)
    pendientes = [(f["tmdb_type"], f["tmdb_id"], f["temporada"], f["title"]) for f in filas if not f["hecho"]]
    return pendientes, len(filas)


def _quien_tiene_preferencia() -> str | None:
    """'descarga' si hay alguna en marcha, 'viendo' si alguien ha visto un
    tramo sin descargar hace poco, o None."""
    from app.routers import files_router
    from app.routers.download import downloader
    if downloader is not None and getattr(downloader, "active_batches", None):
        return "descarga"
    if time.monotonic() - files_router.ultimo_tramo_visto < VIENDO_S:
        return "viendo"
    return None


def _conectado() -> bool:
    from app.routers.download import downloader
    return bool(downloader and downloader.client and downloader.client.is_connected())


async def _tarea(n: int) -> None:
    from app.services import analisis_creditos as ac
    from app.services import proceso_creditos as pc

    while _activa:
        if not _pendientes:
            # Al dia: se espera a que el refresco meta algo nuevo.
            if n == 0 and _estado.get("estado") == "en_marcha" and not _en_curso:
                _estado["estado"] = "al_dia"
                logger.info("Pasada de creditos al dia: %s. Sigue vigilando lo nuevo", _estado["resultados"])
            await asyncio.sleep(ESPERA_S)
            continue
        # Ceder: con una descarga, todas esperan; con alguien viendo, solo
        # sigue la primera. Y sin Telegram no hay nada que hacer.
        quien = _quien_tiene_preferencia()
        if quien == "descarga" or (quien == "viendo" and n > 0) or not _conectado():
            if n == 0:
                _estado["cediendo"] = quien or "sin conexion con Telegram"
            await asyncio.sleep(ESPERA_S)
            continue
        if n == 0:
            _estado["cediendo"] = None
        if not _pendientes:
            continue
        tipo, tmdb_id, temporada, titulo = _pendientes.pop(0)
        _en_curso.add((tipo, tmdb_id, temporada))
        _estado["estado"] = "en_marcha"
        nombre = f"{titulo or tmdb_id}" + (f" · T{temporada}" if tipo == "tv" else "")
        _estado["actuales"][n] = nombre
        t0 = time.monotonic()
        try:
            if tipo == "movie":
                r = await pc.procesar_pelicula(tmdb_id)
            else:
                r = await pc.procesar_temporada(tmdb_id, temporada)
        except ac.NoAnalizable as e:
            from app.database import creditos as db
            await db.marcar_proceso(tmdb_id, tipo, temporada, "no_analizable", str(e)[:200])
            r = "no_analizable"
        except Exception as e:
            # Lo pasajero (Telegram, la red) no se apunta: se queda para la
            # siguiente vez que se lance.
            logger.warning("Pasada de creditos: %s fallo: %s", nombre, e)
            r = "error"
            await asyncio.sleep(5)
        _duraciones.append(time.monotonic() - t0)
        del _duraciones[:-200]
        _estado["resultados"][r] = _estado["resultados"].get(r, 0) + 1
        _estado["hechos"] += 1
        _estado["actuales"][n] = None
        _en_curso.discard((tipo, tmdb_id, temporada))


async def _refrescar() -> None:
    """Cada `REFRESCO_S`, lo nuevo que no tenga sus creditos entra en la cola
    (por votos, como el resto: lo mas visto primero)."""
    global _pendientes
    while _activa:
        await asyncio.sleep(REFRESCO_S)
        if not _activa:
            break
        try:
            pendientes, total = await _lista()
        except Exception as e:
            logger.warning("Pasada de creditos: no se ha podido refrescar la lista: %s", e)
            continue
        en_cola = {p[:3] for p in _pendientes}
        nuevos = [p for p in pendientes if p[:3] not in en_cola and p[:3] not in _en_curso]
        _estado["total"] = total
        if nuevos:
            # `pendientes` viene ordenado por votos: se respeta ese orden con
            # lo que ya estaba en la cola.
            orden = {p[:3]: i for i, p in enumerate(pendientes)}
            _pendientes = sorted(_pendientes + nuevos, key=lambda p: orden.get(p[:3], len(orden)))
            logger.info("Pasada de creditos: %d nuevos que medir (%s)", len(nuevos),
                        ", ".join(f"{p[3] or p[1]}" + (f" T{p[2]}" if p[0] == "tv" else "") for p in nuevos[:5]))


async def _correr() -> None:
    global _pendientes
    try:
        pendientes, total = await _lista()
        _pendientes = pendientes
        _estado.update(estado="en_marcha", total=total, hechos=total - len(pendientes),
                       al_lanzar=total - len(pendientes), resultados={}, actuales=[None] * TAREAS,
                       cediendo=None, empezada=time.time())
        logger.info("Pasada de creditos: %d de %d por hacer, %d tareas", len(pendientes), total, TAREAS)
        # Las tareas no acaban al vaciarse la cola: siguen hasta que se pausa.
        await asyncio.gather(_refrescar(), *(_tarea(n) for n in range(TAREAS)))
    except Exception:
        logger.exception("Pasada de creditos")
        _estado["estado"] = "error"


def _lanzar_tareas() -> None:
    global _activa, _tareas
    from app.tasks import spawn
    _activa = True
    # Pausada hace un momento, las tareas pueden seguir terminando lo que
    # tenian a medias: con `_activa` otra vez a True siguen sin mas.
    if any(not t.done() for t in _tareas):
        if _estado.get("estado") == "pausada":
            _estado["estado"] = "en_marcha"
        return
    _tareas = [spawn(_correr(), "pasada_creditos")]


async def lanzar() -> dict:
    from app.database.connection import set_app_settings
    await set_app_settings({CLAVE: "1"})
    _lanzar_tareas()
    return estado()


async def pausar() -> dict:
    """Deja de coger titulos nuevos; los que estan a medias terminan."""
    global _activa
    from app.database.connection import set_app_settings
    _activa = False
    await set_app_settings({CLAVE: "0"})
    if _estado.get("estado") in ("en_marcha", "al_dia"):
        _estado["estado"] = "pausada"
    return estado()


CLAVE_DETECTOR = "creditos_detector"   # app_settings: la VERSION con la que se midio
CLAVE_REINTENTO = "creditos_reintento"  # app_settings: el REINTENTO ya hecho


async def _si_cambio_el_detector() -> None:
    """Si el detector de imagen es otro que el de lo medido, se vuelve a
    dejar pendiente lo que dependia de el (`rehacer_tras_cambiar_detector`).
    Paso con la version 4: la 3 no reconocia el listado de nombres de las
    peliculas y dos de cada tres salian sin resultado o con un minuto de
    creditos que eran ocho."""
    from app.database import creditos as db
    from app.database.connection import get_app_settings, set_app_settings
    from app.services.analisis_creditos import REINTENTO, VERSION
    ajustes = await get_app_settings()
    if ajustes.get(CLAVE_DETECTOR) != str(VERSION):
        refs, procs = await db.rehacer_tras_cambiar_detector()
        await set_app_settings({CLAVE_DETECTOR: str(VERSION)})
        if refs or procs:
            logger.info("Creditos: detector nuevo (version %d): %d referencias de peliculas y %d titulos "
                        "vuelven a quedar pendientes para la pasada", VERSION, refs, procs)
    if ajustes.get(CLAVE_REINTENTO) != str(REINTENTO):
        # Un detector que solo añade aciertos: se reintenta lo que fallo y lo
        # que salio bien se queda como estaba.
        n = await db.reintentar_fallidos()
        await set_app_settings({CLAVE_REINTENTO: str(REINTENTO)})
        logger.info("Creditos: detector mejorado (reintento %d): %d titulos sin conseguir vuelven a "
                    "quedar pendientes para la pasada", REINTENTO, n)


async def reanudar_si_estaba() -> None:
    """Al arrancar: lo que haya que rehacer por un detector nuevo y, si estaba
    lanzada (un reinicio o un despliegue a medias), sigue. Espera un poco a
    que Telegram conecte."""
    from app.database.connection import get_app_settings
    try:
        await _si_cambio_el_detector()
    except Exception as e:
        logger.warning("Creditos: no se ha podido revisar la version del detector: %s", e)
    if (await get_app_settings()).get(CLAVE) != "1":
        return
    await asyncio.sleep(180)
    logger.info("Pasada de creditos: estaba lanzada, se reanuda")
    _lanzar_tareas()


def estado() -> dict:
    e = dict(_estado)
    e["lanzada"] = _activa
    e["actuales"] = [a for a in e.get("actuales") or [] if a]
    quedan = len(_pendientes) if _activa or e.get("estado") == "pausada" else None
    e["quedan"] = quedan
    if _duraciones and quedan:
        # Con tres a la vez, lo que tarda cada uno entre tres (aprox.).
        media = sum(_duraciones) / len(_duraciones)
        e["segundos_restantes"] = int(media * quedan / TAREAS)
    return e


async def resumen() -> dict:
    """El estado y, si no esta en marcha, cuanto hay hecho y por hacer (para
    pintar el panel antes de lanzarla)."""
    e = estado()
    if e.get("estado") != "en_marcha":
        try:
            pendientes, total = await _lista()
            e.update(total=total, hechos=total - len(pendientes), quedan=len(pendientes))
        except Exception as ex:
            logger.warning("Pasada de creditos: no se pudo contar: %s", ex)
    return e
