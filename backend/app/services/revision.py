"""Lo que esta mal indexado, para verlo y corregirlo a mano (Admin -> Revision).

Cuatro motivos, del mas claro al mas fino:

* **sin_ficha**: TMDB no ha encontrado nada con el nombre, el pie ni la ficha.
* **tipo_cruzado**: la ficha que se encontro es de serie y el archivo parece
  pelicula, o al reves. No sale en la portada (solo sale lo `tmdb_valid`).
* **dudosa**: el canal dice un titulo (su ficha o su pie) y la ficha de TMDB es
  de otro. Es lo que no se ve desde fuera: el archivo sale con caratula, pero
  con la de otra pelicula.
* **sin_caratula**: tiene ficha, pero TMDB no tiene imagen.

Los archivos se agrupan por lo que son (el titulo que dice el canal, o el de la
serie), no uno por uno: una serie de 200 capitulos sin ficha es una sola cosa
que arreglar. Corregir un grupo le pone la ficha buena a todos sus archivos y
los marca `tmdb_manual`, que es lo que impide que la relectura o "Reclasificar"
lo vuelvan a cambiar. "Ignorar" los marca igual, sin ficha: lo que no es nada
(un aviso del canal, un video de prueba) deja de salir en la lista.

Calcularlo cuesta unos segundos (son decenas de miles de filas y cada una se
interpreta con su contexto), asi que se guarda en memoria cinco minutos y se
olvida al corregir algo.
"""
import logging
import re
import time
import unicodedata

logger = logging.getLogger("tmd")

CADUCA_S = 300

MOTIVOS = [
    {"clave": "sin_ficha", "titulo": "Sin ficha",
     "descripcion": "TMDB no ha encontrado nada con el nombre, el pie ni la ficha del canal."},
    {"clave": "tipo_cruzado", "titulo": "Tipo cruzado",
     "descripcion": "La ficha es de serie y el archivo parece película, o al revés. No sale en la portada."},
    {"clave": "dudosa", "titulo": "Ficha dudosa",
     "descripcion": "El canal dice un título y la ficha de TMDB es de otro."},
    {"clave": "sin_caratula", "titulo": "Sin carátula",
     "descripcion": "Tiene ficha, pero TMDB no tiene imagen."},
]
_MOTIVOS = {m["clave"] for m in MOTIVOS}

_cache: dict = {"t": 0.0, "grupos": None}


def olvidar() -> None:
    _cache["t"] = 0.0
    _cache["grupos"] = None


def _norm(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def _corto(texto: str | None, n: int) -> str | None:
    if not texto:
        return None
    t = re.sub(r"[ \t ]+", " ", texto).strip()
    return t[:n]


def _tipo_cliente(media_type: str | None) -> str:
    return "series" if media_type in ("series", "tv") else "movie"


def _ficha_tmdb(f) -> dict | None:
    if f["tmdb_id"] is None:
        return None
    return {"tmdb_id": f["tmdb_id"], "media_type": _tipo_cliente(f["tmdb_type"]),
            "title": f["tmdb_title"], "year": f["tmdb_year"], "poster": f["tmdb_poster"]}


async def _filas(conn):
    return await conn.fetch("""
        SELECT m.id, m.channel_id, m.channel_name, m.message_id, m.file_name, m.pie, m.ficha, m.tema_id,
               m.pistas->>'titulo' AS pista, m.pistas->>'año' AS pista_año, m.media_type, m.season, m.episode,
               m.tmdb_id, m.tmdb_type, m.tmdb_valid, m.tmdb_searched,
               tc.title AS tmdb_title, tc.original_title AS tmdb_original, tc.year AS tmdb_year,
               tc.poster AS tmdb_poster
          FROM media_items m
          LEFT JOIN tmdb_cache tc ON tc.tmdb_id = m.tmdb_id AND tc.media_type = m.tmdb_type
         WHERE NOT m.tmdb_manual
           AND ((m.tmdb_id IS NULL AND m.tmdb_searched)
                OR (m.tmdb_id IS NOT NULL AND m.tmdb_valid IS NOT TRUE)
                OR (m.tmdb_valid AND tc.poster IS NULL)
                OR (m.tmdb_valid AND m.pistas->>'titulo' IS NOT NULL))
    """)


def _motivo(f) -> str | None:
    from app.services.tmdb import title_similarity

    if f["tmdb_id"] is None:
        return "sin_ficha" if f["tmdb_searched"] else None
    if f["tmdb_valid"] is not True:
        return "tipo_cruzado"
    if not f["tmdb_poster"]:
        return "sin_caratula"
    pista = f["pista"]
    if pista and f["media_type"] == "movie":
        # Solo en peliculas: en una serie la pista suele ser el pie de un
        # capitulo ("La reina del flow 2x23") y no se parece al titulo.
        if title_similarity(pista, f["tmdb_title"] or "", f["tmdb_original"] or "") < 0.5:
            return "dudosa"
        try:
            año = int(f["pista_año"]) if f["pista_año"] else None
        except ValueError:
            año = None
        if año and f["tmdb_year"] and abs(año - f["tmdb_year"]) > 1:
            return "dudosa"
    return None


async def _calcular() -> dict:
    """{motivo: [grupo, ...]} con cada grupo y sus archivos."""
    from app.database.connection import get_pool
    from app.services.indexer import interpretar_item, tipos_de_temas

    pool = get_pool()
    if not pool:
        return {m: [] for m in _MOTIVOS}
    t0 = time.time()
    async with pool.acquire() as conn:
        filas = await _filas(conn)
    for cid in {f["channel_id"] for f in filas}:
        await tipos_de_temas(cid)

    grupos: dict[tuple, dict] = {}
    for f in filas:
        motivo = _motivo(f)
        if not motivo:
            continue
        item = dict(f)
        p = interpretar_item(item)
        tipo = p.media_type
        if motivo == "dudosa" and tipo == "series":
            # Lo guardado dice pelicula pero es un capitulo: la ficha no es
            # dudosa, el tipo esta mal, y eso lo arregla la relectura sola.
            continue
        # En una pelicula manda lo que dice el canal; en una serie, el nombre
        # de la serie (el pie es el del capitulo).
        titulo = (f["pista"] if tipo == "movie" and f["pista"] else p.title) or p.clean_title or f["file_name"]
        clave = f"{motivo}|{tipo}|{_norm(titulo)}|{f['tmdb_id'] or ''}"
        g = grupos.get(clave)
        if g is None:
            g = grupos[clave] = {
                "clave": clave, "motivo": motivo, "titulo": titulo[:200], "tipo": tipo,
                "año": p.year, "ejemplo": f["file_name"], "ficha": _corto(f["ficha"], 400),
                "pie": _corto(f["pie"], 240), "actual": _ficha_tmdb(f), "miembros": [],
            }
        g["miembros"].append((f["id"], f["channel_id"], f["channel_name"], p.season, p.episode))
        if not g["ficha"] and f["ficha"]:
            g["ficha"] = _corto(f["ficha"], 400)
        if not g["pie"] and f["pie"]:
            g["pie"] = _corto(f["pie"], 240)

    por_motivo: dict[str, list] = {m: [] for m in _MOTIVOS}
    for g in grupos.values():
        por_motivo[g["motivo"]].append(g)
    for lista in por_motivo.values():
        lista.sort(key=lambda g: -len(g["miembros"]))
    logger.info("Revision: %d grupos en %.1fs", len(grupos), time.time() - t0)
    return por_motivo


async def grupos() -> dict:
    if _cache["grupos"] is None or time.time() - _cache["t"] > CADUCA_S:
        _cache["grupos"] = await _calcular()
        _cache["t"] = time.time()
    return _cache["grupos"]


def _salida(g: dict, channel_id: int | None) -> dict:
    miembros = [m for m in g["miembros"] if channel_id is None or m[1] == channel_id]
    return {
        "clave": g["clave"], "motivo": g["motivo"], "titulo": g["titulo"], "tipo": g["tipo"], "año": g["año"],
        "archivos": len(miembros), "canales": sorted({m[2] for m in miembros}),
        "ejemplo": g["ejemplo"], "ficha": g["ficha"], "pie": g["pie"], "actual": g["actual"],
    }


async def resumen() -> dict:
    from app.database.connection import get_active_channels

    todo = await grupos()
    return {
        "motivos": [{**m, "grupos": len(todo.get(m["clave"], [])),
                     "archivos": sum(len(g["miembros"]) for g in todo.get(m["clave"], []))} for m in MOTIVOS],
        "canales": [{"channel_id": c["id"], "nombre": c["name"]} for c in await get_active_channels()],
    }


async def listar(motivo: str, channel_id: int | None = None, q: str = "", offset: int = 0,
                 limit: int = 30) -> dict:
    if motivo not in _MOTIVOS:
        return {"total": 0, "grupos": []}
    lista = (await grupos())[motivo]
    qn = _norm(q)
    elegidos = []
    for g in lista:
        if channel_id is not None and not any(m[1] == channel_id for m in g["miembros"]):
            continue
        if qn and qn not in _norm(g["titulo"]) and qn not in _norm(g["ejemplo"]):
            continue
        elegidos.append(g)
    return {"total": len(elegidos),
            "grupos": [_salida(g, channel_id) for g in elegidos[offset:offset + limit]]}


async def _miembros(clave: str) -> list[tuple]:
    motivo = clave.split("|", 1)[0]
    for g in (await grupos()).get(motivo, []):
        if g["clave"] == clave:
            return g["miembros"]
    return []


async def asignar(clave: str, tmdb_id: int, media_type: str, api_key: str) -> int:
    """Le pone a todos los archivos del grupo la ficha elegida, y los marca
    para que nada automatico la cambie. Devuelve cuantos archivos."""
    from app.database.connection import get_pool, upsert_tmdb_cache
    from app.services import cache
    from app.services.tmdb import get_details

    miembros = await _miembros(clave)
    if not miembros:
        return 0
    tmdb_type = "tv" if media_type in ("series", "tv") else "movie"
    detalles = await get_details(api_key, tmdb_id, tmdb_type)
    if not detalles:
        raise ValueError("TMDB no tiene esa ficha")
    await upsert_tmdb_cache(detalles)
    serie = tmdb_type == "tv"
    filas = [(tmdb_id, tmdb_type, "series" if serie else "movie",
              (temporada or 1) if serie else None, episodio if serie else None, id_)
             for id_, _, _, temporada, episodio in miembros]
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.executemany("""
            UPDATE media_items
               SET tmdb_id = $1, tmdb_type = $2, media_type = $3, season = $4, episode = $5,
                   tmdb_valid = TRUE, tmdb_searched = TRUE, tmdb_manual = TRUE
             WHERE id = $6
        """, filas)
    olvidar()
    cache.cambio_en_catalogo()
    cache.cambio_en_tmdb()
    logger.info("Revision: %d archivos de «%s» con la ficha %s/%d", len(filas), clave.split("|")[2],
                tmdb_type, tmdb_id)
    return len(filas)


async def ignorar(clave: str) -> int:
    """Deja el grupo como esta y fuera de la lista: no es nada que buscar."""
    from app.database.connection import get_pool

    miembros = await _miembros(clave)
    if not miembros:
        return 0
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE media_items SET tmdb_manual = TRUE WHERE id = ANY($1::int[])",
                           [m[0] for m in miembros])
    olvidar()
    logger.info("Revision: %d archivos de «%s» ignorados", len(miembros), clave.split("|")[2])
    return len(miembros)
