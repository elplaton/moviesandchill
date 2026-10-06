"""Las filas de la portada.

Dos cosas nuevas respecto a la version anterior:

* **Los carriles de genero se paginan.** Cada fila paginable viaja con `key`
  (el genero), `total` (cuantos titulos hay) y la semilla de la sesion; con eso
  el cliente pide `/browse/genre` y sigue cargando. Las filas montadas aqui a
  mano (favoritos, recomendados, novedades) no llevan `key`: no hay nada mas
  que pedir.
* **El filtro de tipo lo hace el servidor.** Antes la web pedia la portada
  entera y se quedaba con las peliculas en el cliente; con paginas de 20 eso
  dejaba carriles de ocho tarjetas.

Si la consulta de generos falla (es la mas delicada: ventanas, hash y
`unnest`), la portada no se queda en blanco: se arman los carriles como antes,
cortando una muestra en Python, y queda el aviso en los logs.
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
# Tope de una pagina de carril. Es lo que pide el cliente al llegar al final.
PAGE_MAX = 40


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
    return {"genre": genero, "items": items, "total": total if total is not None else len(items),
            "key": key}


async def _vacio() -> list[dict]:
    return []


async def _generos_respaldo(pool: list[dict], media_type: str | None) -> list[dict]:
    """Los carriles como se armaban antes: una muestra en Python, 20 por genero
    y sin paginar. Solo se usa si la consulta de generos falla."""
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


@router.get("/browse/home")
async def browse_home(user: Annotated[str, Depends(get_current_user)],
                      seed: str | None = None, media_type: str | None = None):
    from app.database.browse import (get_browse_pool, get_genre_rows, get_novedades,
                                     get_recently_added)
    from app.database.favorites import list_favorites
    from app.database.users import get_user_by_username
    from app.database.preferences import get_preferences

    semilla = (seed or "")[:32] or _nueva_semilla()
    tipo = tipo_tmdb(media_type)
    this_year = date.today().year

    # Todo a la vez y tolerante a fallos: una fila que no se pueda calcular no
    # debe dejar la portada en blanco.
    tareas = [
        get_novedades(ITEMS_PER_ROW, media_type=tipo),
        get_recently_added(ITEMS_PER_ROW, media_type=tipo),
        get_genre_rows(semilla, ITEMS_PER_ROW, media_type=tipo, max_filas=GENRE_LIMIT),
        get_browse_pool("movie", POOL_SIZE) if tipo != "tv" else _vacio(),
        get_browse_pool("tv", POOL_SIZE) if tipo != "movie" else _vacio(),
    ]
    novedades, añadidos, generos, pool_movie, pool_tv = await asyncio.gather(
        *tareas, return_exceptions=True)

    for nombre, valor in (("novedades", novedades), ("añadidos", añadidos),
                          ("generos", generos), ("muestra", pool_movie), ("muestra", pool_tv)):
        if isinstance(valor, Exception):
            logger.error("Portada: %s fallo: %s", nombre, valor)

    def ok(v):
        return [] if isinstance(v, Exception) else v

    muestra = ok(pool_movie) + ok(pool_tv)
    novedades, añadidos = ok(novedades), ok(añadidos)

    rows = []
    if novedades:
        rows.append(_fila("Novedades", novedades))
    if añadidos:
        rows.append(_fila("Añadido recientemente", añadidos))

    if isinstance(generos, Exception) or not generos:
        rows.extend(await _generos_respaldo(muestra, tipo))
    else:
        rows.extend(_fila(g["genre"], g["items"], total=g["total"], key=g["genre"])
                    for g in generos)

    db_user = await get_user_by_username(user)
    if db_user:
        items_muestra = [item_from_row(r) for r in muestra]
        prefs = await get_preferences(db_user["id"])
        if prefs and prefs.get("genres"):
            pref_genres = prefs["genres"]
            liked_years = prefs.get("liked_years") or []
            scored = []
            for item in items_muestra:
                score = sum(pref_genres.get(g, 0) for g in item.get("genres", []))
                if score == 0:
                    continue
                item_year = item.get("year")
                year_bonus = 0
                if item_year:
                    # Cercania a lo que marco en el onboarding, y un empujon a lo
                    # reciente. Antes se descartaba todo lo que no fuera de las
                    # mismas decadas, y la fila se llenaba de series de 2010.
                    for ly in liked_years:
                        diff = abs(item_year - ly)
                        if diff <= 3:
                            year_bonus = max(year_bonus, 3)
                        elif diff <= 8:
                            year_bonus = max(year_bonus, 1)
                    if item_year >= this_year - 2:
                        year_bonus += 2
                total = score + year_bonus
                if total >= 2:
                    scored.append((total, item))
            scored.sort(key=lambda x: -x[0])
            if scored:
                elegidos = _dedupe([i for _, i in scored[:ITEMS_PER_ROW]])
                rows.insert(0, {"genre": "Recomendado para ti", "items": elegidos,
                                "total": len(elegidos), "key": None})

        # Los favoritos van los primeros y se calculan aqui, no en cada cliente:
        # asi la fila sale igual en la web, en el movil y en la tele sin que
        # ninguno tenga que montarla por su cuenta.
        favoritos = [item_from_row(r) for r in await list_favorites(db_user["id"], ITEMS_PER_ROW)]
        if tipo:
            favoritos = [f for f in favoritos if tipo_tmdb(f["media_type"]) == tipo]
        if favoritos:
            rows.insert(0, {"genre": "Mis favoritos", "items": favoritos,
                            "total": len(favoritos), "key": None})

    return {"rows": rows, "seed": semilla}

@router.get("/browse/genre")
async def browse_genre(user: Annotated[str, Depends(get_current_user)],
                       genre: str, seed: str, offset: int = 0, limit: int = ITEMS_PER_ROW,
                       media_type: str | None = None):
    """Una pagina de un carril de genero.

    La semilla es la que devolvio `/browse/home`: con ella el orden es el mismo
    que tenia la primera pagina, asi que la 2 continua donde acabo la 1 y nada
    sale repetido.
    """
    from app.database.browse import get_genre_page

    limit = max(1, min(limit, PAGE_MAX))
    offset = max(0, offset)
    try:
        filas, total = await get_genre_page(seed[:32], genre, offset, limit,
                                            media_type=tipo_tmdb(media_type))
    except Exception as e:
        logger.error("Pagina de genero %s fallo: %s", genre, e)
        return {"genre": genre, "items": [], "total": 0, "offset": offset}
    return {"genre": genre, "items": _dedupe([item_from_row(f) for f in filas]),
            "total": total, "offset": offset}
