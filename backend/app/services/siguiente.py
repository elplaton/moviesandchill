"""Que viene despues del episodio que se esta viendo.

Es lo que sostiene las dos preguntas del final de un capitulo:

* **«Siguiente episodio»**, con la barra que avanza sola. Solo se puede
  ofrecer si el siguiente **esta en disco**: en esta casa ver significa
  reproducir un archivo, no empezar una descarga de tres gigas.
* **«¿Bajo los dos siguientes?»**, cuando por delante no queda nada
  descargado. Ahi lo que hace falta no es un archivo sino un *mensaje* de
  Telegram, que es lo que se le puede pedir al descargador.

Y una regla que mezcla las dos, que es la que de verdad hace que una serie se
pueda ver del tiron: **cuando delante solo queda un episodio**, se ofrece ver
ese y bajar el de despues. Asi siempre hay uno de reserva y nunca se llega al
final de un capitulo para descubrir que hay que esperar media hora.

Por que el calculo esta aqui y no en los clientes: son cuatro (web, movil,
tele y consola) y la parte dificil no es dibujar la tarjeta sino decidir. Hay
que cruzar lo que hay en disco, lo que esta cuenta ya ha visto —reproducido o
marcado a mano—, lo que esta bajando ahora mismo y lo que el catalogo tiene
disponible, y eso no puede vivir copiado cuatro veces.

Dos cuidados que no son evidentes:

* **Lo que ya se vio no cuenta como «siguiente».** Si alguien se vio el 8 y
  luego volvio al 7, al acabar el 7 no se le ofrece el 8 otra vez. Es la
  misma regla que la fila "Continuar viendo" (`services/continuar.py`), y por
  eso las dos usan las mismas funciones.
* **Un episodio puede tener varios archivos** (dos calidades, o el mismo
  capitulo subido dos veces). Para bajar hay que elegir uno: se coge **el mas
  grande**, que es el criterio que ya usa `/files` para decidir cual es la
  version principal de una pelicula.
"""
import logging
import os

from app.services.continuar import (FIN, episodios_en_disco, grupo_de, ruta_relativa,
                                    temporada_y_episodio)

logger = logging.getLogger("tmd")

# Cuantos episodios se ofrecen bajar cuando por delante no hay nada.
A_BAJAR_SIN_NADA = 2
# Cuantos, cuando delante ya queda uno descargado: solo hay que reponer la
# reserva, no llenar el disco.
A_BAJAR_CON_RESERVA = 1
# Con mas de esto descargado por delante no se pregunta nada: ya hay de sobra.
RESERVA_SUFICIENTE = 1


def etiqueta(season: int | None, episode: int | None) -> str:
    """'3x08'. Sin temporada (los animes numerados de corrido), solo el numero."""
    if episode is None:
        return ""
    if season:
        return f"{season}x{episode:02d}"
    return f"Episodio {episode}"


def _clave(fila: dict) -> tuple[int, int]:
    return (fila.get("season") or 0, fila.get("episode") or 0)


def elegir_archivo(filas: list[dict]) -> dict:
    """De varios archivos del mismo episodio, el que se baja.

    El mas grande: es el mismo criterio con el que `/files` decide cual es la
    version principal de una pelicula, y a falta de saber la calidad real el
    tamaño es la mejor pista que hay.
    """
    return max(filas, key=lambda r: r.get("file_size") or 0)


def pendientes_de_bajar(filas: list[dict], actual: tuple[int, int],
                        en_disco: set[tuple[int, int]],
                        ocupados: set[tuple[int, int]],
                        cuantos: int) -> list[dict]:
    """Los proximos `cuantos` episodios que se pueden bajar.

    `filas` son los archivos del catalogo de esta serie; `en_disco` los
    (temporada, episodio) que ya estan descargados y `ocupados` los que estan
    bajando ahora mismo. Se devuelve uno por episodio, en orden, sin saltos
    hacia atras.
    """
    por_episodio: dict[tuple[int, int], list[dict]] = {}
    for fila in filas:
        if fila.get("episode") is None:
            continue
        clave = _clave(fila)
        if clave <= actual or clave in en_disco or clave in ocupados:
            continue
        por_episodio.setdefault(clave, []).append(fila)

    salida = []
    for clave in sorted(por_episodio):
        if len(salida) >= cuantos:
            break
        elegido = elegir_archivo(por_episodio[clave])
        salida.append({
            "message_id": elegido["message_id"],
            "channel_id": elegido.get("channel_id"),
            "file_name": elegido.get("file_name"),
            "size": elegido.get("file_size") or 0,
            "size_str": elegido.get("size_str") or "",
            "season": clave[0] or None,
            "episode": clave[1],
            "label": etiqueta(clave[0] or None, clave[1]),
        })
    return salida


def cuantos_bajar(pendientes_en_disco: int) -> int:
    """Cuantos episodios se ofrecen segun lo que quede por delante.

    Es la regla que se pidio, en una linea: sin nada descargado delante, dos;
    con uno, uno mas (reponer la reserva); con mas, ninguno.
    """
    if pendientes_en_disco <= 0:
        return A_BAJAR_SIN_NADA
    if pendientes_en_disco <= RESERVA_SUFICIENTE:
        return A_BAJAR_CON_RESERVA
    return 0


def episodios_delante(rel: str, terminados: set[str],
                      marcados: set[tuple[int, int]]) -> list[tuple[int, int, str]]:
    """Lo que hay en disco despues de este episodio y esta cuenta no ha visto.

    Ordenado, asi que el primero es el "siguiente" y la longitud es la reserva
    que queda.
    """
    actual = temporada_y_episodio(rel)
    if actual[0] is None or actual[1] is None:
        return []
    fuera = []
    for ts, es, ruta in episodios_en_disco(grupo_de(rel)):
        if (ts, es) <= actual:
            continue
        if ruta in terminados or (ts, es) in marcados:
            continue
        fuera.append((ts, es, ruta))
    return fuera


def terminados_de(filas: list[dict]) -> set[str]:
    """Las rutas que esta cuenta ya ha visto enteras.

    Mismo umbral que la fila "Continuar viendo" (`FIN`, el 95 %): lo que alli
    se considera terminado tiene que ser lo mismo que aqui no se vuelve a
    ofrecer, o las dos pantallas se contradirian.
    """
    return {f["path"] for f in filas
            if (f.get("duration") or 0) > 0
            and float(f["position"]) / float(f["duration"]) >= FIN}


def _ocupados_ahora() -> set[tuple[int, int]]:
    """Los (temporada, episodio) que ya estan bajando.

    Se leen de los lotes vivos del descargador, y no de la tabla `downloads`,
    porque lo que importa es «esto ya esta en marcha, no lo pidas otra vez»,
    y eso solo lo sabe el proceso. La temporada y el episodio salen de la
    carpeta de destino, que `layout.py` ya calculo.
    """
    from app.routers.download import downloader

    fuera: set[tuple[int, int]] = set()
    if not downloader:
        return fuera
    for lote in list(getattr(downloader, "active_batches", {}).values()):
        if lote.get("status") in ("done", "cancelled", "error"):
            continue
        temporada, episodio = lote.get("season"), lote.get("episode")
        if episodio is not None:
            fuera.add((temporada or 0, episodio))
    return fuera


async def que_viene(path: str, user_id: int, tmdb_id: int | None = None) -> dict:
    """Todo lo que los clientes necesitan para decidir que preguntar.

    Devuelve siempre un diccionario con la misma forma: `kind` dice si esto es
    una serie (si no, no hay nada que ofrecer), `siguiente` el episodio que se
    puede ver ya, `pendientes` cuantos quedan descargados por delante y
    `descargables` los que se pueden bajar. La decision de que tarjeta se
    dibuja la toma el cliente con esos cuatro datos.
    """
    rel = ruta_relativa(path)
    if rel is None:
        return {"kind": "desconocido"}

    temporada, episodio = temporada_y_episodio(rel)
    if temporada is None or episodio is None:
        # Una pelicula, o un archivo sin marcador de episodio: no hay siguiente.
        return {"kind": "movie"}

    from app.database.progress import list_progress
    from app.database.watched import episodios_vistos

    filas_progreso = await list_progress(user_id)
    terminados = terminados_de(filas_progreso)

    # El tmdb_id puede venir del cliente (el reproductor lo sabe) o del
    # historial, que es donde lo guardo el propio reproductor la primera vez.
    # Se resuelve **antes** de preguntar por lo marcado a mano: esa consulta
    # va por tmdb_id y sin el no devolveria nada.
    ficha = next((f for f in filas_progreso if f["path"] == rel), None)
    if tmdb_id is None and ficha:
        tmdb_id = ficha.get("tmdb_id")
    marcados = await episodios_vistos(user_id, tmdb_id) if tmdb_id else set()

    delante = episodios_delante(rel, terminados, marcados)
    siguiente = None
    if delante:
        ts, es, ruta = delante[0]
        siguiente = {
            "path": ruta,
            "season": ts or None,
            "episode": es,
            "label": etiqueta(ts or None, es),
        }

    descargables: list[dict] = []
    cuantos = cuantos_bajar(len(delante))
    if cuantos and tmdb_id:
        from app.database.media import get_media_by_tmdb

        try:
            filas = [dict(r) for r in await get_media_by_tmdb(tmdb_id, "tv")]
        except Exception as e:
            logger.warning("No se pudo mirar que episodios se pueden bajar: %s", e)
            filas = []
        en_disco = {(ts, es) for ts, es, _ in episodios_en_disco(grupo_de(rel))}
        descargables = pendientes_de_bajar(filas, (temporada, episodio), en_disco,
                                           _ocupados_ahora(), cuantos)

    return {
        "kind": "series",
        "tmdb_id": tmdb_id,
        "grupo": grupo_de(rel),
        "actual": {"season": temporada, "episode": episodio,
                   "label": etiqueta(temporada, episodio)},
        "siguiente": siguiente,
        "pendientes": len(delante),
        "descargables": descargables,
        "title": (ficha or {}).get("title") or grupo_de(rel),
        "poster": (ficha or {}).get("poster"),
        "backdrop": (ficha or {}).get("backdrop"),
    }
