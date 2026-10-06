"""Las filas de la portada.

Tres ideas gobiernan este archivo:

* **Todas las filas que monta el servidor se paginan.** Cada una viaja con
  `key` (con qué se piden más) y `total` (cuántos títulos hay), y el cliente
  sigue cargando contra `/browse/row`. Que una fila se acabe a las veinte
  tarjetas y la de al lado no, se nota.
* **El orden tiene que ser reproducible.** Con `RANDOM()` la página 2 no
  continúa a la 1: repite títulos y se salta otros. Todas las filas aleatorias
  ordenan por una clave determinista sacada de la **semilla de la sesión**, que
  viaja en la respuesta de `/browse/home`; así rotan en cada visita y a la vez
  se pueden recorrer de principio a fin.
* **El filtro de tipo lo hace el servidor.** Antes la web pedía la portada
  entera y se quedaba con las películas en el cliente; con páginas de veinte
  eso dejaba carriles de ocho tarjetas.

Si una consulta falla (las de géneros y recomendados son las delicadas:
ventanas, hash, `unnest`), la portada no se queda en blanco: esa fila se arma
como antes, cortando una muestra en Python y sin paginar, y queda el aviso en
los logs.
"""
import asyncio
import logging
import random
from collections import defaultdict
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_user

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["browse"])

GENRE_LIMIT = 14
ITEMS_PER_ROW = 20
POOL_SIZE = 400
# Tope de una página de carril. Es lo que pide el cliente al llegar al final.
PAGE_MAX = 40

# Con qué se pide más de cada fila. Los géneros llevan su nombre detrás.
CLAVE_GENERO = "genero:"
CLAVE_NOVEDADES = "novedades"
CLAVE_AÑADIDOS = "anadidos"
CLAVE_RECOMENDADO = "recomendado"
CLAVE_FAVORITOS = "favoritos"


def item_from_row(row: dict) -> dict:
    is_series = row.get("tmdb_type") == "tv"
    return {
        "id": f"{'s' if is_series else 'm'}{row['tmdb_id']}",
        "tmdb_id": row["tmdb_id"],
        "title": row["tmdb_title"] or row["clean_title"],
        "poster": row["poster"],
        "backdrop": row["backdrop"],
        "year": row["year"],
        "rating": float(row["rating"]) if row["rating"] else None,
        "overview": row["overview"],
        "media_type": "series" if is_series else "movie",
        "episode_count": row.get("episode_count", 0) if is_series else None,
        "file_count": row.get("file_count", 0),
        "genres": row.get("genres") or [],
        "channel_id": row["channel_id"],
        "channel_name": row.get("channel_name"),
        "message_id": row["message_id"],
    }


def _dedupe(items: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for it in items:
        if it["id"] in seen:
            continue
        seen.add(it["id"])
        out.append(it)
    return out


def tipo_tmdb(media_type: str | None) -> str | None:
    """Los clientes hablan de 'movie'/'series' y TMDB de 'movie'/'tv'."""
    if media_type in ("series", "tv"):
        return "tv"
    if media_type in ("movie", "movies"):
        return "movie"
    return None


def _nueva_semilla() -> str:
    return str(random.randint(1, 10**9))


def _fila(genero: str, filas: list[dict], total: int | None = None,
          key: str | None = None) -> dict:
    items = _dedupe([item_from_row(f) for f in filas])
    return {"genre": genero, "items": items,
            "total": total if total is not None else len(items), "key": key}


def ok(valor):
    """Una fila que no se ha podido calcular es una fila vacía, no un 500."""
    return [] if isinstance(valor, Exception) else valor


async def _vacio() -> list[dict]:
    return []


async def _favoritos_pagina(user_id: int, offset: int, limit: int,
                            tipo: str | None) -> tuple[list[dict], int]:
    from app.database.favorites import count_favorites, list_favorites

    # Una detras de otra y no en paralelo: el pool tiene cinco conexiones y la
    # portada ya lanza cuatro consultas pesadas a la vez. Estas dos son
    # baratas, no merece la pena quitarle sitio a las otras.
    filas = await list_favorites(user_id, limit, offset, tipo)
    return filas, await count_favorites(user_id, tipo)


async def _generos_respaldo(pool: list[dict]) -> list[dict]:
    """Los carriles de género como se armaban antes: una muestra en Python, 20
    por género y sin paginar. Solo se usa si la consulta de géneros falla."""
    por_genero: dict[str, list[dict]] = defaultdict(list)
    items = [item_from_row(r) for r in pool]
    random.shuffle(items)
    for item in items:
        for g in item["genres"]:
            if len(por_genero[g]) < ITEMS_PER_ROW:
                por_genero[g].append(item)
    ordenados = sorted(por_genero.items(), key=lambda kv: len(kv[1]), reverse=True)
    return [{"genre": g, "items": its, "total": len(its), "key": None}
            for g, its in ordenados[:GENRE_LIMIT]]


def _recomendado_respaldo(pool: list[dict], gustos: dict, liked_years: list[int]) -> list[dict]:
    """La puntuación en Python de siempre, sobre una muestra. Solo se usa si la
    consulta falla: puntúa lo que haya en la muestra, así que ni es el catálogo
    entero ni se puede paginar."""
    this_year = date.today().year
    puntuados = []
    for item in [item_from_row(r) for r in pool]:
        puntos = sum(gustos.get(g, 0) for g in item.get("genres", []))
        if puntos == 0:
            continue
        año = item.get("year")
        extra = 0
        if año:
            for ly in liked_years:
                diff = abs(año - ly)
                if diff <= 3:
                    extra = max(extra, 3)
                elif diff <= 8:
                    extra = max(extra, 1)
            if año >= this_year - 2:
                extra += 2
        if puntos + extra >= 2:
            puntuados.append((puntos + extra, item))
    puntuados.sort(key=lambda x: -x[0])
    return _dedupe([i for _, i in puntuados[:ITEMS_PER_ROW]])


@router.get("/browse/home")
async def browse_home(user: Annotated[str, Depends(get_current_user)],
                      seed: str | None = None, media_type: str | None = None):
    from app.database.browse import (get_browse_pool, get_estrenos, get_genre_rows,
                                     get_recently_added, get_recomendados)
    from app.database.preferences import get_preferences
    from app.database.users import get_user_by_username

    semilla = (seed or "")[:32] or _nueva_semilla()
    tipo = tipo_tmdb(media_type)

    db_user = await get_user_by_username(user)
    prefs = await get_preferences(db_user["id"]) if db_user else None
    gustos = (prefs or {}).get("genres") or {}
    liked_years = (prefs or {}).get("liked_years") or []

    # Todo a la vez: la parte cara (agrupar media_items) la repite cada
    # consulta, así que lo que no se puede evitar es al menos simultáneo.
    tareas: dict[str, object] = {
        "novedades": get_estrenos(ITEMS_PER_ROW, media_type=tipo, semilla=semilla),
        "añadidos": get_recently_added(ITEMS_PER_ROW, media_type=tipo),
        "generos": get_genre_rows(semilla, ITEMS_PER_ROW, media_type=tipo, max_filas=GENRE_LIMIT),
    }
    if gustos:
        tareas["recomendado"] = get_recomendados(semilla, gustos, liked_years,
                                                 0, ITEMS_PER_ROW, tipo)
    if db_user:
        tareas["favoritos"] = _favoritos_pagina(db_user["id"], 0, ITEMS_PER_ROW, tipo)

    resultados = dict(zip(tareas, await asyncio.gather(*tareas.values(), return_exceptions=True)))
    for nombre, valor in resultados.items():
        if isinstance(valor, Exception):
            logger.error("Portada: %s fallo: %s", nombre, valor)

    # La muestra grande solo hace falta para los respaldos, así que no se pide
    # salvo que algo haya fallado: son las dos consultas más caras de la página.
    muestra: list[dict] | None = None

    async def con_muestra() -> list[dict]:
        nonlocal muestra
        if muestra is None:
            a, b = await asyncio.gather(
                get_browse_pool("movie", POOL_SIZE) if tipo != "tv" else _vacio(),
                get_browse_pool("tv", POOL_SIZE) if tipo != "movie" else _vacio(),
                return_exceptions=True)
            muestra = ok(a) + ok(b)
        return muestra

    def pagina(nombre: str) -> tuple[list[dict], int]:
        valor = resultados.get(nombre)
        if isinstance(valor, Exception) or not valor:
            return [], 0
        filas, total = valor
        return filas, total

    rows = []
    filas, total = pagina("novedades")
    if filas:
        rows.append(_fila("Novedades", filas, total=total, key=CLAVE_NOVEDADES))
    filas, total = pagina("añadidos")
    if filas:
        rows.append(_fila("Añadido recientemente", filas, total=total, key=CLAVE_AÑADIDOS))

    generos = resultados.get("generos")
    if isinstance(generos, Exception) or not generos:
        rows.extend(await _generos_respaldo(await con_muestra()))
    else:
        rows.extend(_fila(g["genre"], g["items"], total=g["total"],
                          key=f"{CLAVE_GENERO}{g['genre']}")
                    for g in generos)

    if gustos:
        filas, total = pagina("recomendado")
        if filas:
            rows.insert(0, _fila("Recomendado para ti", filas, total=total,
                                 key=CLAVE_RECOMENDADO))
        else:
            items = _recomendado_respaldo(await con_muestra(), gustos, liked_years)
            if items:
                rows.insert(0, {"genre": "Recomendado para ti", "items": items,
                                "total": len(items), "key": None})

    # Los favoritos van los primeros y se calculan aquí, no en cada cliente:
    # así la fila sale igual en la web, en el móvil y en la tele sin que
    # ninguno tenga que montarla por su cuenta.
    filas, total = pagina("favoritos")
    if filas:
        rows.insert(0, _fila("Mis favoritos", filas, total=total, key=CLAVE_FAVORITOS))

    return {"rows": rows, "seed": semilla}


async def _pagina_de(key: str, user: str, semilla: str, offset: int, limit: int,
                     tipo: str | None) -> tuple[list[dict], int]:
    from app.database.browse import (get_estrenos, get_genre_page, get_recently_added,
                                     get_recomendados)
    from app.database.preferences import get_preferences
    from app.database.users import get_user_by_username

    if key.startswith(CLAVE_GENERO):
        genero = key[len(CLAVE_GENERO):]
        if not genero:
            return [], 0
        return await get_genre_page(semilla, genero, offset, limit, media_type=tipo)
    if key == CLAVE_NOVEDADES:
        return await get_estrenos(limit, media_type=tipo, semilla=semilla, offset=offset)
    if key == CLAVE_AÑADIDOS:
        return await get_recently_added(limit, media_type=tipo, offset=offset)

    # Las dos que son de la cuenta: hay que saber quién pregunta.
    db_user = await get_user_by_username(user)
    if not db_user:
        return [], 0
    if key == CLAVE_RECOMENDADO:
        prefs = await get_preferences(db_user["id"]) or {}
        gustos = prefs.get("genres") or {}
        if not gustos:
            return [], 0
        return await get_recomendados(semilla, gustos, prefs.get("liked_years") or [],
                                      offset, limit, tipo)
    if key == CLAVE_FAVORITOS:
        return await _favoritos_pagina(db_user["id"], offset, limit, tipo)
    return [], 0


@router.get("/browse/row")
async def browse_row(user: Annotated[str, Depends(get_current_user)],
                     key: str, seed: str = "", offset: int = 0,
                     limit: int = ITEMS_PER_ROW, media_type: str | None = None):
    """Una página de cualquiera de las filas de la portada.

    La semilla es la que devolvió `/browse/home`: con ella el orden es el mismo
    que tenía la primera página, así que la 2 continúa donde acabó la 1 y nada
    sale repetido.
    """
    limit = max(1, min(limit, PAGE_MAX))
    offset = max(0, offset)
    try:
        filas, total = await _pagina_de(key, user, seed[:32], offset, limit,
                                        tipo_tmdb(media_type))
    except Exception as e:
        # Sin página, el carril se para donde esté: mejor que un hueco roto.
        logger.error("Pagina de la fila %s fallo: %s", key, e)
        return {"key": key, "items": [], "total": 0, "offset": offset}
    return {"key": key, "items": _dedupe([item_from_row(f) for f in filas]),
            "total": total, "offset": offset}


@router.get("/browse/genre")
async def browse_genre(user: Annotated[str, Depends(get_current_user)],
                       genre: str, seed: str, offset: int = 0, limit: int = ITEMS_PER_ROW,
                       media_type: str | None = None):
    """Compatibilidad: es lo que pedían los clientes antes de que todas las
    filas se paginaran. Un navegador con la versión vieja en caché sigue
    teniendo sus carriles."""
    return await browse_row(user, f"{CLAVE_GENERO}{genre}", seed, offset, limit, media_type)
