"""Por donde va cada cuenta en cada video, y la fila "Continuar viendo".

Vive en el servidor y no en el localStorage de cada aparato para que el punto
sea el mismo en la web, el movil y la tele: empezar una pelicula en el salon y
seguirla en el movil es justo lo que se espera de esto.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.services.continuar import (FIN, MIN_SEGUNDOS, continuar_viendo, grupo_de,
                                    ruta_relativa, temporada_y_episodio)

router = APIRouter(prefix="/api", tags=["progress"])


class ProgressRequest(BaseModel):
    path: str
    position: float
    duration: float = 0
    title: str | None = None
    subtitle: str | None = None
    poster: str | None = None
    backdrop: str | None = None
    tmdb_id: int | None = None
    media_type: str | None = None


def _tipo_tmdb(media_type: str | None) -> str | None:
    """Los clientes hablan de 'series' y TMDB de 'tv'."""
    if media_type is None:
        return None
    return "tv" if media_type in ("series", "tv") else "movie"


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


async def _seguir_si_toca(uid: int, req: ProgressRequest, episodio: int | None) -> None:
    """Ver un episodio es seguir la serie.

    Es la mitad del seguimiento: lo otro es el boton de la ficha. Asi no hay
    que acordarse de marcar nada para que avisen del capitulo siguiente. Solo
    cuenta si de verdad se ha empezado a ver (treinta segundos) y nunca pisa lo
    que la cuenta haya decidido: `auto_follow` respeta la fila que ya exista,
    incluida la de una serie que se dejo de seguir a proposito.
    """
    from app.database.follows import auto_follow

    if not req.tmdb_id or episodio is None:
        return
    if _tipo_tmdb(req.media_type) != "tv":
        return
    if req.position < MIN_SEGUNDOS:
        return
    try:
        await auto_follow(uid, req.tmdb_id)
    except Exception:
        # Guardar el progreso es lo importante; el seguimiento es un extra.
        pass


async def _guardar(uid: int, req: ProgressRequest) -> bool:
    from app.database.progress import save_progress

    rel = ruta_relativa(req.path)
    if rel is None:
        return False
    temporada, episodio = temporada_y_episodio(rel)
    tmdb_id, tmdb_type = req.tmdb_id, _tipo_tmdb(req.media_type)
    # Lo visto sin descargar no lleva "3x05" en la ruta: el capitulo y la
    # ficha se sacan del catalogo, que es lo que permite juntarlo con el resto
    # de la serie en "Continuar viendo" y saber cual va mas avanzado.
    from app.services import reproduccion
    ids = reproduccion.leer_ruta(rel)
    if ids:
        from app.database.progress import ficha_de_tg
        cat = await ficha_de_tg(*ids)
        if cat:
            temporada = temporada if temporada is not None else cat.get("season")
            episodio = episodio if episodio is not None else cat.get("episode")
            if not tmdb_id and cat.get("tmdb_id"):
                tmdb_id, tmdb_type = cat["tmdb_id"], cat["tmdb_type"]
    await save_progress(
        uid, rel, grupo_de(rel), req.position, req.duration,
        title=req.title, subtitle=req.subtitle, poster=req.poster, backdrop=req.backdrop,
        tmdb_id=tmdb_id, tmdb_type=tmdb_type,
        season=temporada, episode=episodio,
    )
    await _seguir_si_toca(uid, req, episodio)
    return True


@router.get("/progress")
async def get_progress_list(user: Annotated[str, Depends(get_current_user)], limit: int = 20):
    """La fila "Continuar viendo": una tarjeta por titulo.

    Lo que la cuenta ha marcado como visto no sale: decir "ya me la he visto" y
    seguir viendola en la portada es contradictorio. Y los episodios marcados a
    mano no se ofrecen como siguiente, aunque esten en disco sin reproducir.
    """
    import asyncio

    from app.database.progress import list_progress
    from app.database.watched import episodios_vistos_todos, titulos_vistos

    uid = await _user_id(user)
    if uid is None:
        return {"items": []}
    filas, vistos, marcados = await asyncio.gather(
        list_progress(uid), titulos_vistos(uid), episodios_vistos_todos(uid))
    filas = [f for f in filas
             if (f.get("tmdb_id"), f.get("tmdb_type")) not in vistos]
    catalogo = await _episodios_en_catalogo(filas)
    return {"items": continuar_viendo(filas, limit, marcados, catalogo)}


async def _episodios_en_catalogo(filas: list[dict]) -> dict[int, list[tuple[int, int, str]]]:
    """De cada serie del historial, los episodios del catalogo que se pueden
    ver sin descargar: (temporada, episodio, ruta tg:), uno por capitulo.

    Es lo que deja ofrecer el capitulo siguiente aunque no este descargado, y
    lo que hace que una serie al dia vuelva a la fila sola en cuanto llega el
    capitulo nuevo. De cada capitulo, el enlace del canal en el que se iba
    viendo si lo hay (suele ser el mismo ripeo)."""
    from app.database.connection import get_pool
    from app.services import interior, reproduccion
    from app.services.siguiente import elegir_enlace

    series = {f["tmdb_id"] for f in filas if f.get("tmdb_id") and f.get("tmdb_type") == "tv"}
    pool = get_pool()
    if not series or not pool:
        return {}
    try:
        async with pool.acquire() as conn:
            enlaces = [dict(r) for r in await conn.fetch("""
                SELECT tmdb_id, channel_id, message_id, file_name, file_size, season, episode
                FROM media_items
                WHERE tmdb_type = 'tv' AND tmdb_valid IS TRUE AND episode IS NOT NULL
                  AND tmdb_id = ANY($1::int[])
            """, list(series))]
        ver = await interior.ver_de(enlaces)
    except Exception:
        # Sin catalogo la fila sale como antes (solo lo descargado).
        return {}
    canal_de: dict[int, int] = {}
    for f in filas:
        ids = reproduccion.leer_ruta(f["path"])
        if ids and f.get("tmdb_id") in series:
            canal_de.setdefault(f["tmdb_id"], ids[0])
    por_capitulo: dict[tuple[int, int, int], list[dict]] = {}
    for e in enlaces:
        if reproduccion.se_puede_intentar(e["file_name"]) or (e["channel_id"], e["message_id"]) in ver:
            por_capitulo.setdefault((e["tmdb_id"], e["season"] or 0, e["episode"]), []).append(e)
    salida: dict[int, list[tuple[int, int, str]]] = {}
    for (tid, t, ep), opciones in por_capitulo.items():
        e = elegir_enlace(opciones, canal_de.get(tid), None)
        salida.setdefault(tid, []).append((t, ep, reproduccion.ruta(e["channel_id"], e["message_id"])))
    for lista in salida.values():
        lista.sort()
    return salida


@router.get("/progress/point")
async def get_progress_point(path: str, user: Annotated[str, Depends(get_current_user)]):
    """Por donde iba este archivo en concreto. Es lo que pide el reproductor al
    abrirse, para arrancar donde se quedo."""
    from app.database.progress import get_progress

    uid = await _user_id(user)
    rel = ruta_relativa(path)
    if uid is None or rel is None:
        return {"position": 0, "duration": 0}

    fila = await get_progress(uid, rel)
    if not fila:
        return {"position": 0, "duration": 0}

    posicion, duracion = float(fila["position"]), float(fila["duration"])
    # Lo ya visto arranca de cero: reanudar en el minuto 119 de 120 es peor que
    # volver a empezar.
    if duracion > 0 and (posicion < MIN_SEGUNDOS or posicion / duracion >= FIN):
        posicion = 0
    return {"position": posicion, "duration": duracion}


@router.post("/progress")
async def post_progress(req: ProgressRequest, user: Annotated[str, Depends(get_current_user)]):
    uid = await _user_id(user)
    if uid is None:
        return {"saved": False}
    return {"saved": await _guardar(uid, req)}


@router.post("/progress/creditos")
async def al_empezar_los_creditos(req: ProgressRequest, user: Annotated[str, Depends(get_current_user)]):
    """Han empezado los creditos: el capitulo o la pelicula se da por visto.

    Es el momento en que la gente deja de mirar, y esperar al `ended` (o al
    95 %) dejaba lo visto a medias en "Continuar viendo" en cuanto alguien
    cerraba en los creditos. Se hacen dos cosas:

    - el progreso queda **terminado** (posicion = duracion): de una serie,
      "Continuar viendo" ofrece el capitulo siguiente desde el principio;
    - se **marca visto** en `user_watched`: el capitulo (con lo que la ficha
      pinta el visto y, completa la temporada, la temporada entera) o la
      pelicula entera, que sale de "Continuar viendo". Las dos cosas suman a
      las recomendaciones (`gustos_por_lo_visto`).

    Lo llama el reproductor una vez por archivo, al aparecer la tarjeta de
    los creditos (`useSiguiente`)."""
    from app.database.progress import get_progress
    from app.database.watched import marcar_visto
    from app.services import cache

    uid = await _user_id(user)
    if uid is None or not req.duration or req.duration <= 0:
        return {"visto": False}
    req.position = req.duration
    if not await _guardar(uid, req):
        return {"visto": False}
    # Que es lo dice la fila guardada: la ficha que mando el cliente o, si
    # no, la del catalogo (lo visto sin descargar), y el capitulo igual.
    fila = await get_progress(uid, ruta_relativa(req.path)) or {}
    tmdb_id, tipo = fila.get("tmdb_id"), fila.get("tmdb_type")
    if not tmdb_id or tipo not in ("movie", "tv"):
        return {"visto": False, "motivo": "sin ficha"}
    if tipo == "movie":
        await marcar_visto(uid, tmdb_id, "movie")
    elif fila.get("episode") is not None:
        await marcar_visto(uid, tmdb_id, "tv", fila.get("season") or 0, fila["episode"])
    else:
        return {"visto": False, "motivo": "no se sabe que capitulo es"}
    cache.cambio_de_cuenta(uid)
    return {"visto": True, "tmdb_id": tmdb_id, "media_type": tipo,
            "season": fila.get("season"), "episode": fila.get("episode")}


@router.delete("/progress")
async def delete_progress_entry(user: Annotated[str, Depends(get_current_user)],
                                path: str = "", grupo: str = "", todo: bool = False):
    """Quitar de la fila. Con `grupo` (la carpeta del titulo) se olvida el
    titulo entero: borrando solo el episodio en curso la tarjeta volveria a
    salir con el anterior. Con `todo`, el historial completo de la cuenta."""
    from app.database.progress import delete_progress

    uid = await _user_id(user)
    if uid is None:
        return {"deleted": 0}
    if todo:
        return {"deleted": await delete_progress(uid, todo=True)}
    rel = ruta_relativa(path) if path else None
    if not grupo and rel is None:
        return {"deleted": 0}
    # Quitar una tarjeta es olvidar su titulo entero, no solo ese archivo: si
    # no, la otra calidad de la pelicula, o el capitulo anterior, la harian
    # volver. Y el titulo es el de la fila (`clave_titulo`): su ficha si la
    # tiene, que es lo que junta lo visto descargado con lo visto sin
    # descargar (una ruta `tg:` no tiene carpeta).
    from app.database.progress import delete_paths, list_progress
    from app.services.continuar import clave_titulo

    carpeta = grupo or grupo_de(rel)
    filas = await list_progress(uid)
    propias = [f for f in filas if f["path"] == rel or f.get("grupo") == carpeta]
    claves = {clave_titulo(f) for f in propias} | {("grupo", carpeta)}
    caminos = [f["path"] for f in filas if clave_titulo(f) in claves or f.get("grupo") == carpeta]
    return {"deleted": await delete_paths(uid, caminos)}
