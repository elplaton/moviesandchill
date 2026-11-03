"""Donde empiezan los creditos de cada pelicula y cada episodio.

Para que el reproductor ofrezca el siguiente episodio (o «Ver creditos») justo
cuando empiezan, y no siempre 45 segundos antes del final.

**Se guarda como segundos antes del final**, no como un minuto concreto. Dos
enlaces de la misma pelicula no duran lo mismo (uno lleva un logo delante, una
copia europea va un 4 % mas rapida), pero el final si se mantiene: si en uno los
creditos son los ultimos 317 s, en los demas tambien, con unos segundos de
margen. Asi basta con medir **un enlace por pelicula** y, en una serie, uno por
temporada: el resto se predice (`prevision()`) y, si hace falta, se verifica.

Dos niveles (tablas en database/creditos.py):
- `creditos`: la referencia de un titulo, o de una temporada (0 = la serie
  entera, que se usa si la temporada no tiene la suya).
- `creditos_enlace`: lo medido en un archivo concreto. Manda sobre la
  prevision.

De donde sale el dato, de mas a menos fiable (una fuente floja no pisa a una
fuerte):
- `manual`: lo pone el admin.
- `capitulos`: el archivo trae un capitulo «Credits», «Créditos», «Ending»...
  Sale gratis: `leer_pistas()` ya pasa ffprobe por cada video que se abre, y
  ahora lee tambien los capitulos (`recoger_capitulos()`). Medido sobre una
  muestra del catalogo, lo traen ~9 % de las series y ~2,5 % de las peliculas.
- `imagen`: el analisis de los fotogramas del final (por hacer).
"""
import logging
import re

logger = logging.getLogger("tmd")

FUENTES = ("manual", "capitulos", "imagen")
ESTADOS = ("medido", "verificado", "no_encaja", "sin_creditos", "error")

# Titulos de capitulo que marcan los creditos finales. «Opening credits» o
# una intro no: se descartan por nombre y, ademas, por estar al principio.
_CAPITULO_CREDITOS = re.compile(
    r"cr[eé]ditos|credits|\bending\b|\bed\b|end ?roll|staff ?roll|\boutro\b|\bfin\b", re.I)
_NO_ES_FINAL = re.compile(r"opening|\bop\b|intro|apertura|inicio|cabecera|previously|recap|resumen"
                          r"|post|\bmid|stinger", re.I)
# Un capitulo despues de los creditos que es una escena (Marvel), no un
# avance del siguiente episodio («Preview», «Avance»).
_POSTCREDITOS = re.compile(r"post|\bmid|stinger|escena|scene|bonus", re.I)

# Los creditos tienen que caer en la parte final del archivo.
_FRACCION_FINAL = 0.40
# Una prevision que dejaria los creditos antes de la mitad no es creible.
_MITAD = 0.5
# En una pelicula, un enlace que dura un 10 % distinto del medido es otro
# montaje (version extendida, otro corte): no se predice.
_OTRO_MONTAJE = 0.10


def tipo_tmdb(media_type: str | None) -> str | None:
    """'series'/'tv' -> 'tv' y 'movie' -> 'movie' (los clientes dicen series)."""
    if media_type in ("series", "tv"):
        return "tv"
    if media_type == "movie":
        return "movie"
    return None


def inicio_desde_capitulos(capitulos: list[dict], duracion: float | None) -> tuple[float | None, bool]:
    """(segundo en que empiezan los creditos, si hay escena despues) segun los
    capitulos del archivo, o (None, False) si no lo dicen.

    `capitulos` es [{"start": s, "end": s, "title": str}] (lo que devuelve
    `leer_pistas()`)."""
    if not capitulos:
        return None, False
    fin = duracion or max((c.get("end") or 0) for c in capitulos)
    if not fin:
        return None, False
    for i, c in enumerate(capitulos):
        titulo = (c.get("title") or "").strip()
        inicio = c.get("start")
        if inicio is None or not _CAPITULO_CREDITOS.search(titulo) or _NO_ES_FINAL.search(titulo):
            continue
        if inicio < fin * (1 - _FRACCION_FINAL):
            continue
        despues = capitulos[i + 1:]
        post = any(_POSTCREDITOS.search(d.get("title") or "") for d in despues)
        return float(inicio), post
    return None, False


def prevision(ref: dict | None, duracion: float | None, tmdb_type: str | None) -> float | None:
    """Donde empezarian los creditos en un enlace sin medir, segun la
    referencia de su titulo (o temporada), o None si no es creible."""
    if not ref or not duracion or duracion <= 0:
        return None
    if tmdb_type == "movie" and ref.get("duracion"):
        if abs(duracion - ref["duracion"]) / ref["duracion"] > _OTRO_MONTAJE:
            return None
    inicio = duracion - float(ref["antes_del_final"])
    if inicio < duracion * _MITAD:
        return None
    return inicio


async def _titulo(ruta: str, tmdb_id: int | None, tmdb_type: str | None,
                  temporada: int | None) -> tuple[int | None, str | None, int]:
    """El titulo y la temporada de un enlace: los de Telegram salen del
    catalogo; los de la biblioteca, de lo que diga el cliente."""
    from app.database import creditos as db
    from app.services import reproduccion

    if reproduccion.es_ruta(ruta):
        ids = reproduccion.leer_ruta(ruta)
        if ids:
            t = await db.titulo_de_mensaje(*ids)
            if t:
                return t["tmdb_id"], t["tmdb_type"], (t["season"] or 0) if t["tmdb_type"] == "tv" else 0
    tipo = tipo_tmdb(tmdb_type)
    return tmdb_id, tipo, (temporada or 0) if tipo == "tv" else 0


async def guardar_medicion(ruta: str, *, inicio: float | None, duracion: float | None, fuente: str,
                           estado: str = "medido", postcreditos: bool = False,
                           tmdb_id: int | None = None, tmdb_type: str | None = None,
                           temporada: int | None = None, referencia: bool = True) -> bool:
    """Lo que se ha averiguado de un enlace. Si tiene creditos y se sabe de
    que titulo es, pasa ademas a ser la referencia de su temporada (y de la
    serie entera, si aun no tenia) para predecir los demas enlaces; con
    `referencia=False` no (los episodios de referencia de una serie, cuya
    referencia es la mediana de varios y la pone quien los mide)."""
    from app.database import creditos as db

    if fuente not in FUENTES or estado not in ESTADOS:
        raise ValueError(f"fuente o estado no validos: {fuente}/{estado}")
    tid, tipo, temp = await _titulo(ruta, tmdb_id, tmdb_type, temporada)
    escrito = await db.guardar_enlace(ruta, inicio=inicio, duracion=duracion, estado=estado, fuente=fuente,
                                      tmdb_id=tid, tmdb_type=tipo, temporada=temp, postcreditos=postcreditos)
    if not escrito or not referencia or inicio is None or not duracion or not tid or not tipo:
        return escrito
    antes = round(duracion - inicio, 2)
    await db.guardar_referencia(tid, tipo, temp, antes_del_final=antes, fuente=fuente, ruta=ruta,
                                duracion=duracion, postcreditos=postcreditos)
    if tipo == "tv" and temp:
        await db.guardar_referencia(tid, tipo, 0, antes_del_final=antes, fuente=fuente, ruta=ruta,
                                    duracion=duracion, postcreditos=postcreditos, solo_si_no_hay=True)
    logger.info("Creditos de %s: desde %.0f s de %.0f (%s, %s)", ruta[:80], inicio, duracion, fuente, estado)
    return escrito


async def recoger_capitulos(ruta: str, pistas: dict) -> None:
    """Si el archivo trae capitulo de creditos, se apunta. Lo llaman los dos
    sitios que pasan ffprobe por un video (biblioteca y Telegram). Que no
    traiga capitulos no dice nada de sus creditos, asi que entonces no se
    escribe nada. Nunca falla hacia fuera: es un extra de leer las pistas."""
    try:
        inicio, post = inicio_desde_capitulos(pistas.get("capitulos") or [], pistas.get("duration"))
        if inicio is None:
            return
        await guardar_medicion(ruta, inicio=inicio, duracion=pistas.get("duration"),
                               fuente="capitulos", postcreditos=post)
    except Exception as e:
        logger.warning("No se han podido guardar los creditos de %s: %s", ruta[:80], e)


async def consultar(ruta: str, duracion: float | None, *, tmdb_id: int | None = None,
                    tmdb_type: str | None = None, temporada: int | None = None) -> dict:
    """Donde empiezan los creditos de un enlace, para el reproductor.

    `origen` dice como de seguro es: `medido` (de este mismo archivo),
    `previsto` (de otro enlace del mismo titulo o temporada) o None si no se
    sabe; entonces el reproductor sigue con su regla fija."""
    from app.database import creditos as db

    vacio = {"inicio": None, "origen": None, "fuente": None, "postcreditos": False}
    medido = await db.enlace(ruta)
    if medido and medido["estado"] in ("medido", "verificado", "sin_creditos"):
        return {"inicio": medido["inicio"], "origen": "medido", "fuente": medido["fuente"],
                "postcreditos": medido["postcreditos"]}
    if medido and medido["estado"] == "no_encaja":
        # Se comprobo y este enlace no sigue a su titulo (otro montaje, un
        # final distinto): predecirle nada seria equivocarse a sabiendas.
        return vacio
    tid, tipo, temp = await _titulo(ruta, tmdb_id, tmdb_type, temporada)
    if not tid or not tipo:
        return vacio
    ref = await db.referencia(tid, tipo, temp)
    inicio = prevision(ref, duracion, tipo)
    if inicio is None:
        return vacio
    return {"inicio": round(inicio, 2), "origen": "previsto", "fuente": ref["fuente"],
            "postcreditos": ref["postcreditos"]}
