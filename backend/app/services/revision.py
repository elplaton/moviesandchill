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
import asyncio
import logging
import re
import time
import unicodedata

logger = logging.getLogger("tmd")

CADUCA_S = 6 * 3600

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

_cache: dict = {"t": 0.0, "grupos": None, "quitados": set()}
# Un solo calculo a la vez: dos peticiones con la lista sin calcular esperan
# al mismo, en vez de hacerlo dos veces.
_calculando = asyncio.Lock()


def olvidar() -> None:
    """La lista se vuelve a calcular en la siguiente pregunta (~6 s). Solo
    cuando entra algo nuevo en el catalogo o se deshace una correccion: lo que
    se arregla desde aqui (a mano, la coincidencia exacta, Claude) sale de la
    lista con `quitar`, sin recalcularla."""
    _cache["t"] = 0.0
    _cache["grupos"] = None


def quitar(clave: str) -> None:
    """Saca de la lista un grupo que se acaba de arreglar solo (coincidencia
    exacta o Claude), sin recalcularla: recalcular cuesta ~7 s y una pasada o
    un lote arreglan cientos seguidos. Asi desaparece del panel en cuanto se
    aplica, y no al acabar el lote."""
    # Si se esta recalculando, que lo arreglado ahora no vuelva con la nueva.
    _cache["quitados"].add(clave)
    gs = _cache["grupos"]
    if not gs:
        return
    motivo = clave.split("|", 1)[0]
    if motivo in gs:
        gs[motivo] = [g for g in gs[motivo] if g["clave"] != clave]


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
               m.pistas->>'titulo' AS pista, m.pistas->>'año' AS pista_año, m.pistas->>'original' AS pista_original,
               m.media_type, m.season, m.episode,
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
    from app.services.revision_auto import titulo_buscable

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
        # Un capitulo cuyo nombre no dice de que serie es («Capítulo 1639»,
        # «S10E009», «Temporada-12» con «12x01. Quien lo encuentre...»): por
        # titulo cada uno era su propio grupo, y eran unos 1.700 de un archivo
        # (una telenovela de 2.000 capitulos, uno por grupo). Se juntan por
        # canal y tema, que es donde los publica una misma serie: se dice una
        # vez de que serie son y cada archivo se queda con su capitulo. Solo
        # capitulos: unas peliculas sin titulo («RECOMENDADA») son distintas.
        sin_nombre = (tipo == "series" and not titulo_buscable(titulo)
                      and not titulo_buscable(f["pista_original"]))
        if sin_nombre:
            clave = f"{motivo}|series|~sin-nombre|{f['channel_id']}|{f['tema_id'] or 0}|{f['tmdb_id'] or ''}"
        else:
            clave = f"{motivo}|{tipo}|{_norm(titulo)}|{f['tmdb_id'] or ''}"
        g = grupos.get(clave)
        if g is None:
            g = grupos[clave] = {
                "clave": clave, "motivo": motivo, "tipo": tipo,
                "titulo": (f"Capítulos sin nombre de serie · {f['channel_name']}" if sin_nombre else titulo)[:200],
                # Lo que se pone en el buscador de «Corregir»: con capitulos
                # sin nombre no hay nada que buscar todavia.
                "busqueda": "" if sin_nombre else (titulo_buscable(titulo) or titulo)[:200],
                "sin_nombre": sin_nombre,
                "año": p.year, "ejemplo": f["file_name"], "ficha": _corto(f["ficha"], 400),
                "pie": _corto(f["pie"], 240), "actual": _ficha_tmdb(f), "miembros": [],
                "original": None,
            }
        # (id, canal, nombre del canal, temporada, episodio, nombre del
        # archivo, su titulo: en «Capítulo 1639» con un «chunklist_b648000.mp4»
        # el capitulo esta en el titulo y no en el nombre)
        g["miembros"].append((f["id"], f["channel_id"], f["channel_name"], p.season, p.episode, f["file_name"],
                              titulo))
        if not g["año"] and f["pista_año"] and str(f["pista_año"]).isdigit():
            g["año"] = int(f["pista_año"])
        if not g["original"] and f["pista_original"]:
            g["original"] = f["pista_original"][:200]
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
    # Sin caducidad corta: la lista cambia cuando entra algo en el catalogo (el
    # bucle de revision_auto lo mira y llama a `olvidar`) o cuando se arregla
    # algo desde aqui (`quitar`). CADUCA_S es solo una red de seguridad.
    if _cache["grupos"] is None or time.time() - _cache["t"] > CADUCA_S:
        async with _calculando:
            if _cache["grupos"] is None or time.time() - _cache["t"] > CADUCA_S:
                await _recalcular()
    return _cache["grupos"]


async def _recalcular() -> None:
    _cache["quitados"] = set()
    nuevos = await _calcular()
    if _cache["quitados"]:
        for m, lista in nuevos.items():
            nuevos[m] = [g for g in lista if g["clave"] not in _cache["quitados"]]
    _cache.update(grupos=nuevos, t=time.time())


async def refrescar() -> None:
    """Recalcula la lista por detras y la cambia de golpe al acabar: quien
    pregunte mientras tanto recibe la de antes, en vez de esperar ~5 s. Al
    arrancar (para que nadie espere la primera vez) y cuando entra algo nuevo
    en el catalogo."""
    async with _calculando:
        await _recalcular()


def _salida(g: dict, channel_id: int | None, sugerencias: dict | None = None) -> dict:
    miembros = [m for m in g["miembros"] if channel_id is None or m[1] == channel_id]
    return {
        "clave": g["clave"], "motivo": g["motivo"], "titulo": g["titulo"], "tipo": g["tipo"], "año": g["año"],
        "archivos": len(miembros), "canales": sorted({m[2] for m in miembros}),
        "ejemplo": g["ejemplo"], "ficha": g["ficha"], "pie": g["pie"], "actual": g["actual"],
        "busqueda": g.get("busqueda", g["titulo"]),
        # En los capitulos sin nombre de serie, varios archivos repartidos por
        # el grupo: se juntaron por canal y tema, y antes de decir de que serie
        # son hay que poder ver que son todos de lo mismo.
        "ejemplos": ([miembros[i * (len(miembros) - 1) // 3][5] for i in range(4)] if g.get("sin_nombre")
                     and len(miembros) >= 4 else None),
        # La candidata que encontro la revision automatica y no era segura
        # (services/revision_auto.py): se acepta o se descarta de un toque.
        "sugerencia": (sugerencias or {}).get(g["clave"]),
    }


async def resumen() -> dict:
    from app.database.connection import get_active_channels
    from app.services import revision_auto

    todo = await grupos()
    sugeridas = await revision_auto.sugerencias()
    return {
        "motivos": [{**m, "grupos": len(todo.get(m["clave"], [])),
                     "archivos": sum(len(g["miembros"]) for g in todo.get(m["clave"], [])),
                     "sugeridas": sum(1 for g in todo.get(m["clave"], []) if g["clave"] in sugeridas)}
                    for m in MOTIVOS],
        "canales": [{"channel_id": c["id"], "nombre": c["name"]} for c in await get_active_channels()],
        "auto": await revision_auto.estado(),
    }


async def listar(motivo: str, channel_id: int | None = None, q: str = "", offset: int = 0,
                 limit: int = 30, solo_sugeridas: bool = False) -> dict:
    from app.services import revision_auto

    todo = await grupos()
    sugeridas = await revision_auto.sugerencias()
    if motivo == "con_sugerencia":
        # La bandeja de sugerencias: las de todos los motivos juntas, las que
        # mas archivos arreglan primero. Es donde un toque resuelve un grupo.
        lista = sorted((g for gs in todo.values() for g in gs if g["clave"] in sugeridas),
                       key=lambda g: -len(g["miembros"]))
    elif motivo in _MOTIVOS:
        lista = todo[motivo]
    else:
        return {"total": 0, "grupos": []}
    qn = _norm(q)
    elegidos = []
    for g in lista:
        if channel_id is not None and not any(m[1] == channel_id for m in g["miembros"]):
            continue
        if qn and qn not in _norm(g["titulo"]) and qn not in _norm(g["ejemplo"]):
            continue
        if solo_sugeridas and g["clave"] not in sugeridas:
            continue
        elegidos.append(g)
    return {"total": len(elegidos),
            "grupos": [_salida(g, channel_id, sugeridas) for g in elegidos[offset:offset + limit]]}


async def grupo(clave: str) -> dict | None:
    motivo = clave.split("|", 1)[0]
    for g in (await grupos()).get(motivo, []):
        if g["clave"] == clave:
            return g
    return None


async def _miembros(clave: str) -> list[tuple]:
    g = await grupo(clave)
    return g["miembros"] if g else []


def episodio_de(miembro: tuple, titulo: str | None = None) -> tuple[int | None, int | None]:
    """(temporada, episodio) de un archivo del grupo: lo que se saco al
    interpretarlo y, si no se saco (el grupo se tomo por pelicula: «135 -
    Black Clover», «Minky Momo 10»), lo que diga su nombre (`capitulo_de`)."""
    temporada, episodio, nombre = miembro[3], miembro[4], miembro[5]
    propio = miembro[6] if len(miembro) > 6 else None
    if episodio is None and not _MULTIPARTE_RE.search(nombre or ""):
        for texto in (nombre, propio):
            t, e = capitulo_de(texto or "", titulo)
            if e is not None:
                temporada, episodio = (t if t is not None else temporada), e
                break
    return temporada, episodio


# Formas de decir el capitulo que el parser general no reconoce, de la mas a
# la menos clara. Solo se usan aqui, con el grupo ya reconocido como serie:
# fuera de contexto «Apollo 13» tambien «es» el capitulo 13.
_CAP_FORMAS = [
    re.compile(r"(?<![a-z0-9])(\d{1,2})\s*x\s*e?(\d{1,3})(?!\d)", re.I),                    # 1 x 7, 2xE3
    re.compile(r"(?<![a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)", re.I),                    # [S1-E003
    re.compile(r"(?<![a-z0-9])s(\d{1,2})[._](\d{2,3})(?!\d)", re.I),                          # S1.03
    re.compile(r"(?<![a-z0-9])t(\d{1,2})\s*[,._-]?\s*e(\d{1,3})(?!\d)", re.I),                # T03, E05
    re.compile(r"cap[\s._-]?(\d{1,2})(\d{2})(?!\d)", re.I),                                  # 720pCap_101
]
_CAP_SOLO = [
    re.compile(r"(?<![a-z0-9])(?:c|cap|e|ep)[\s._-]?(\d{1,3})(?!\d)", re.I),                  # C07, E39
    re.compile(r"#\s*(\d{1,3})(?!\d)"),                                                     # #05
    re.compile(r"\((\d{1,3})\)"),                                                           # (12)
]
_RUIDO_RE = re.compile(r"\[[^\]]*\]|\b(?:\d{3,4}p|[xh]\.?26[45]|\d+bits?|dd\d(?:\.\d)?|aac\d?(?:\.\d)?|"
                       r"5\.1|7\.1|[0-9a-f]{8})\b|(?<!\d)(?:19\d{2}|20[0-3]\d)(?!\d)", re.I)


def capitulo_de(nombre: str, titulo: str | None = None) -> tuple[int | None, int | None]:
    """(temporada o None, capitulo) que dice el nombre de un archivo de una
    serie, o (None, None). Ademas de lo que entiende el parser: «1 x 7»,
    «S1.03», «[S1-E003-CAST]», «T03, E05», «C07», «E39», «#05», «(12)»,
    «Cap_101» y, quitando el titulo, la calidad y los años, un unico numero
    suelto («Dragon Ball Super 078 [ESP-JAP]», «83.mp4»). Con dos numeros
    sueltos («Medabots 2 54») no se adivina."""
    from app.services.title_parser import parse_filename, strip_extension

    p = parse_filename(nombre)
    if p.episode is not None:
        return p.season, p.episode
    base = strip_extension(nombre).replace("_", " ")
    for rx in _CAP_FORMAS:
        m = rx.search(base)
        if m:
            return int(m.group(1)), int(m.group(2))
    for rx in _CAP_SOLO:
        m = rx.search(base)
        if m:
            return None, int(m.group(1))
    resto = _RUIDO_RE.sub(" ", base)
    for palabra in _norm(titulo or "").split():
        resto = re.sub(rf"(?<![a-z0-9]){re.escape(palabra)}(?![a-z0-9])", " ", _norm(resto))
    numeros = [int(n) for n in re.findall(r"(?<![a-z0-9])(\d{1,4})(?![a-z0-9])", _norm(resto))]
    numeros = [n for n in numeros if 0 < n < 10000]
    return (None, numeros[0]) if len(numeros) == 1 else (None, None)


# Partes de un comprimido: el numero es el de la parte, no el del capitulo.
_MULTIPARTE_RE = re.compile(r"\.(?:part\d+\.rar|r\d{2}|(?:7z|zip|rar|mkv|mp4|avi)\.\d{3}|\d{3})$", re.I)


async def poner_ficha(miembros: list[tuple], tmdb_id: int, media_type: str, api_key: str,
                      detalles: dict | None = None, titulo: str | None = None, recalcular: bool = False) -> list[list]:
    """Le pone a esos archivos la ficha dada y los marca para que nada
    automatico la cambie (`tmdb_manual`). Devuelve como estaba cada uno, para
    poder deshacerlo. En una serie, cada archivo lleva su capitulo: si se
    habia tomado por pelicula no tenia, y se quedaba sin numero de episodio."""
    from app.database.connection import get_pool, upsert_tmdb_cache
    from app.services import cache
    from app.services.tmdb import get_details

    tmdb_type = "tv" if media_type in ("series", "tv") else "movie"
    detalles = detalles or await get_details(api_key, tmdb_id, tmdb_type)
    if not detalles:
        raise ValueError("TMDB no tiene esa ficha")
    await upsert_tmdb_cache(detalles)
    serie = tmdb_type == "tv"
    filas = []
    for m in miembros:
        temporada, episodio = episodio_de(m, titulo) if serie else (None, None)
        filas.append((tmdb_id, tmdb_type, "series" if serie else "movie",
                      (temporada or 1) if serie and episodio is not None else None, episodio, m[0]))
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            antes = await conn.fetch("""
                SELECT id, tmdb_id, tmdb_type, media_type, season, episode, tmdb_valid, tmdb_searched
                  FROM media_items WHERE id = ANY($1::int[])
            """, [m[0] for m in miembros])
            await conn.executemany("""
                UPDATE media_items
                   SET tmdb_id = $1, tmdb_type = $2, media_type = $3, season = $4, episode = $5,
                       tmdb_valid = TRUE, tmdb_searched = TRUE, tmdb_manual = TRUE
                 WHERE id = $6
            """, filas)
    # En una pasada (cientos de grupos seguidos) no: cada olvido obligaba a
    # recalcular la lista entera (~7 s) en la siguiente pregunta del panel, que
    # pregunta cada pocos segundos. La pasada olvida una vez al acabar.
    if recalcular:
        olvidar()
    cache.cambio_en_catalogo()
    cache.cambio_en_tmdb()
    return [[a["id"], a["tmdb_id"], a["tmdb_type"], a["media_type"], a["season"], a["episode"],
             a["tmdb_valid"], a["tmdb_searched"]] for a in antes]


async def deshacer(antes: list[list]) -> int:
    """Devuelve unos archivos a como estaban (lo que guardo `poner_ficha`) y
    les quita la marca de corregidos a mano."""
    from app.database.connection import get_pool
    from app.services import cache

    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.executemany("""
            UPDATE media_items
               SET tmdb_id = $2, tmdb_type = $3, media_type = $4, season = $5, episode = $6,
                   tmdb_valid = $7, tmdb_searched = $8, tmdb_manual = FALSE
             WHERE id = $1
        """, [tuple(a) for a in antes])
    olvidar()
    cache.cambio_en_catalogo()
    cache.cambio_en_tmdb()
    return len(antes)


async def asignar(clave: str, tmdb_id: int, media_type: str, api_key: str) -> int:
    """Le pone a todos los archivos del grupo la ficha elegida, y los marca
    para que nada automatico la cambie. Devuelve cuantos archivos."""
    miembros = await _miembros(clave)
    if not miembros:
        return 0
    g = await grupo(clave)
    await poner_ficha(miembros, tmdb_id, media_type, api_key, titulo=g["titulo"] if g else None)
    quitar(clave)
    logger.info("Revision: %d archivos de «%s» con la ficha %s/%d", len(miembros), clave.split("|")[2],
                media_type, tmdb_id)
    return len(miembros)


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
    quitar(clave)
    logger.info("Revision: %d archivos de «%s» ignorados", len(miembros), clave.split("|")[2])
    return len(miembros)
