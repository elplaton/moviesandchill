"""Antes de pedir algo, mirar si ya esta en los canales.

Muchas peticiones eran de cosas que ya estaban publicadas: el catalogo no las
tenia emparejadas (sin ficha de TMDB, o con otra) o el mensaje no se habia
indexado. Pedirlas escribia en un grupo de Telegram para nada. Asi que, antes
de encolar una peticion y otra vez justo antes de mandarla, se busca:

1. **En el catalogo**, lo indexado que no tiene ficha valida y cuyo titulo
   coincide con el pedido (lo bien emparejado con otro titulo no se toca).
2. **En Telegram**, con la busqueda de cada canal, lo que ni siquiera esta
   indexado.

Se busca con el titulo **tal cual**, en español y en el original, quitando
solo un año entre parentesis si lo llevara: Telegram busca por palabras y un
"2024" que el archivo no lleve dejaria fuera lo que se busca.

Cada candidato se compara con la ficha de TMDB que ya se tiene de la
peticion (`veredicto`): el titulo (el del nombre del archivo y el de la ficha
del canal, si la hay) tiene que ser el mismo, no solo parecido ("Dune" no es
"Dune: Parte dos"); el año, si alguien lo dice, tiene que cuadrar; el tipo
(pelicula o capitulo) tambien; y si la ficha del canal enlaza a TMDB, manda
ese enlace. Lo que pasa se indexa con esa ficha (`tmdb_manual`, como una
correccion de Admin -> Revision: nada automatico la cambia despues) y la
peticion se da por pedida y conseguida sin escribir en ningun grupo.
"""
import asyncio
import json
import logging
import re

logger = logging.getLogger("tmd")

# Lo que se espera a la busqueda antes de seguir como siempre (pedir). Telegram
# raciona las busquedas y Telethon se duerme en silencio ante un FloodWait.
ESPERA_S = 25
# Mensajes de antes del archivo que se miran buscando su ficha en el canal.
MENSAJES_ATRAS = 6

_AÑO_ENTRE_PARENTESIS = re.compile(r"\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*")


def titulo_para_buscar(titulo: str | None) -> str:
    """El titulo tal cual, sin un año entre parentesis. Solo entre parentesis:
    "1917" o "Blade Runner 2049" llevan el numero en el nombre."""
    t = _AÑO_ENTRE_PARENTESIS.sub(" ", titulo or "")
    return re.sub(r"\s+", " ", t).strip(" -–—:·.,")


def _palabras(texto: str | None) -> tuple[str, ...]:
    from app.services.busqueda import normalizar
    return tuple(normalizar(titulo_para_buscar(texto)).split())


def mismo_titulo(a: str | None, b: str | None) -> bool:
    """Si dos titulos son el mismo: las mismas palabras normalizadas (sin
    tildes, signos ni mayusculas). Parecido no basta: "Dune" y "Dune: Parte
    dos" son dos peliculas, y las secuelas son justo lo que se confunde."""
    pa, pb = _palabras(a), _palabras(b)
    return bool(pa) and (pa == pb or "".join(pa) == "".join(pb))


# Lo que acompaña a una pelicula y no es la pelicula. Va antes que la ficha:
# en el canal el extra suele colgar de la misma ficha que la pelicula.
_EXTRA = re.compile(r"\b(extras?|bonus|featurettes?|making[ ._-]?of|tr[aá]iler|teaser|sample|muestra)\b",
                    re.IGNORECASE)


def veredicto(nombre: str, pistas: dict | None, peticion: dict) -> tuple[bool, str]:
    """Si el archivo `nombre`, con las `pistas` de su ficha en el canal (el
    dict que guarda el indexador: titulo, año, original, tmdb_id, tmdb_tipo),
    es el titulo de la `peticion` (tmdb_id, media_type, titulo,
    titulo_original, year). Devuelve (si, por que)."""
    from app.services.title_parser import parse_filename

    p = parse_filename(nombre)
    tipo = peticion["media_type"]
    pistas = pistas or {}

    if _EXTRA.search(nombre):
        return False, "es un extra, no el título"

    if tipo == "movie" and p.episode is not None:
        return False, "es un capítulo y se pidió una película"
    if tipo == "tv" and p.media_type != "series":
        return False, "no parece un capítulo y se pidió una serie"

    # Un enlace a TMDB en la ficha del canal es lo mas fiable que hay.
    enlace = pistas.get("tmdb_id")
    if enlace:
        if int(enlace) == int(peticion["tmdb_id"]) and pistas.get("tmdb_tipo") in (None, tipo):
            return True, "la ficha del canal enlaza a este título en TMDB"
        return False, "la ficha del canal enlaza a otro título de TMDB"
    if p.tmdb_id_hint:
        if p.tmdb_id_hint == int(peticion["tmdb_id"]):
            return True, "el nombre lleva su id de TMDB"
        return False, "el nombre lleva el id de otro título de TMDB"

    pedidos = [peticion.get("titulo"), peticion.get("titulo_original")]
    # Si el nombre del archivo dice un titulo con palabras del pedido pero no
    # es el mismo ("Aliados 2", "Dune" por "Dune: Parte dos"), manda el
    # nombre aunque la ficha de encima diga otra cosa: en un canal varios
    # archivos cuelgan de la misma ficha. Si el nombre no dice nada del
    # pedido ("60b016c396c7.mp4"), se decide por la ficha.
    del_nombre = set(_palabras(p.title))
    if (del_nombre & {w for q in pedidos if q for w in _palabras(q)}
            and not any(mismo_titulo(p.title, q) for q in pedidos if q)):
        return False, f"el nombre dice otro título («{p.title}»)"
    suyos = [p.title, pistas.get("titulo"), pistas.get("original")]
    if not any(mismo_titulo(s, q) for s in suyos if s for q in pedidos if q):
        return False, "es otro título"

    años = {a for a in (p.year, pistas.get("año")) if a}
    pedido = peticion.get("year")
    if años and pedido and all(abs(int(a) - int(pedido)) > 1 for a in años):
        return False, f"es de otro año ({', '.join(map(str, sorted(años)))})"
    if tipo == "movie" and not años:
        # Sin año en ningun sitio una pelicula puede ser otra con el mismo
        # titulo (un remake): se acepta solo si la ficha del canal la respalda.
        if not pistas.get("titulo"):
            return False, "sin año ni ficha que lo confirme"
        return True, "mismo título según la ficha del canal"
    return True, "mismo título y año" if años else "mismo título"


# --- Candidatos ------------------------------------------------------------

async def _del_catalogo(peticion: dict, consultas: list[str]) -> list[dict]:
    """Lo indexado sin ficha valida cuyo titulo coincide con lo buscado. Lo
    corregido a mano (`tmdb_manual`) no se toca."""
    from app.database.connection import get_pool
    from app.services.busqueda import MIN_DENTRO, consulta, puntos_sql

    pool = get_pool()
    if not pool:
        return []
    salida: dict[tuple[int, int], dict] = {}
    async with pool.acquire() as conn:
        for q in consultas:
            pegado, palabras = consulta(q)
            if not pegado:
                continue
            filas = await conn.fetch(f"""
                SELECT channel_id, channel_name, message_id, file_name, pistas
                FROM media_items mi
                WHERE {puntos_sql('mi.busca', 'mi.busca_c')} IS NOT NULL
                  AND mi.tmdb_valid IS NOT TRUE AND mi.tmdb_manual IS NOT TRUE
                LIMIT 300
            """, pegado, palabras, len(pegado) >= MIN_DENTRO)
            for f in filas:
                d = dict(f)
                if isinstance(d.get("pistas"), str):
                    d["pistas"] = json.loads(d["pistas"])
                d["indexado"] = True
                salida[(d["channel_id"], d["message_id"])] = d
    return list(salida.values())


def _pistas_dict(p) -> dict | None:
    if not p:
        return None
    return {"titulo": p.titulo, "año": p.año, "original": p.original,
            "tmdb_id": p.tmdb_id, "tmdb_tipo": p.tmdb_tipo}


def _entidad(dl, channel_id: int):
    ch = dl.channels.get(channel_id)
    return ch["entity"] if ch else dl._resolve_channel_id(channel_id)


async def _ficha_de_antes(dl, channel_id: int, mid: int) -> dict | None:
    """La ficha publicada justo antes del archivo, si la hay: el ultimo de
    los mensajes anteriores que dice un año o enlaza a TMDB (asi publican
    casi todos: foto con la ficha y debajo el archivo)."""
    from app.services.contexto import pistas_de, texto_de

    try:
        antes = await dl.client.get_messages(_entidad(dl, channel_id),
                                             ids=list(range(max(1, mid - MENSAJES_ATRAS), mid)))
    except Exception:
        return None
    for m in reversed([m for m in antes or [] if m is not None]):
        p = pistas_de(texto_de(m))
        if p and (p.año or p.tmdb_id):
            return _pistas_dict(p)
    return None


async def _de_telegram(peticion: dict, consultas: list[str]) -> list[dict]:
    """Lo que la busqueda de los canales encuentra y no esta indexado, con las
    pistas de su ficha. Telegram busca tambien en el pie, asi que entra lo que
    coincide por el nombre del archivo **o** por el pie (hay archivos que se
    llaman "60b016c396c7.mp4").

    En un grupo con temas (foro) la busqueda sin tema los recorre todos,
    tambien los que el admin ha marcado para no indexar (Deportes, Libros...):
    lo de esos temas se descarta aqui, o se indexaria saltandose esa decision."""
    from app.database.connection import get_pool
    from app.database.media import temas_ignorados
    from app.services.busqueda import coincide
    from app.services.contexto import pistas_de, tema_de, texto_de
    from app.services.reproduccion import _downloader

    dl = _downloader()
    vistos: dict[tuple[int, int], dict] = {}
    for q in consultas:
        for r in await dl.search_messages(q, limit=60):
            if coincide(r.get("file_name"), q) or coincide(r.get("text"), q):
                vistos.setdefault((r["channel_id"], r["id"]), r)
    if not vistos:
        return []
    async with get_pool().acquire() as conn:
        ya = await conn.fetch("""
            SELECT channel_id, message_id FROM media_items
            WHERE (channel_id, message_id) IN (SELECT * FROM unnest($1::bigint[], $2::int[]))
        """, [c for c, _ in vistos], [m for _, m in vistos])
    ya = {(f["channel_id"], f["message_id"]) for f in ya}
    por_canal: dict[int, list[int]] = {}
    for (channel_id, mid) in vistos:
        if (channel_id, mid) not in ya:
            por_canal.setdefault(channel_id, []).append(mid)

    ignorados = await temas_ignorados()
    salida = []
    for channel_id, mids in por_canal.items():
        msgs = await dl.client.get_messages(_entidad(dl, channel_id), ids=mids)
        for msg in msgs or []:
            if msg is None or tema_de(msg) in ignorados.get(channel_id, set()):
                continue
            r = vistos[(channel_id, msg.id)]
            pie = texto_de(msg) or None
            c = {"channel_id": channel_id, "channel_name": r.get("channel_name"), "message_id": msg.id,
                 "file_name": r["file_name"], "file_size": r.get("size"), "size_str": r.get("size_str"),
                 "pie": pie, "pistas": _pistas_dict(pistas_de(pie)), "indexado": False}
            # La ficha de encima solo se busca si hace falta: si con el nombre
            # y el pie ya esta claro, no se pregunta mas a Telegram.
            si, por_que = veredicto(c["file_name"], c["pistas"], peticion)
            if not si and por_que in ("sin año ni ficha que lo confirme", "es otro título"):
                c["pistas"] = await _ficha_de_antes(dl, channel_id, msg.id) or c["pistas"]
            salida.append(c)
    return salida


# --- Indexar lo encontrado -----------------------------------------------------

async def _indexar(aceptados: list[dict], peticion: dict, detalles: dict) -> int:
    """Mete en el catalogo lo que no estaba y le pone a todo la ficha de la
    peticion, marcada a mano para que la relectura y "Reclasificar" no la
    cambien."""
    from app.database.connection import get_pool
    from app.database.media import insert_media_items
    from app.database.tmdb_cache import upsert_tmdb_cache
    from app.services import cache
    from app.services.title_parser import parse_filename

    await upsert_tmdb_cache(detalles)
    nuevos = []
    for a in aceptados:
        if a["indexado"]:
            continue
        p = parse_filename(a["file_name"])
        nuevos.append({"channel_id": a["channel_id"], "channel_name": a.get("channel_name"),
                       "message_id": a["message_id"], "file_name": a["file_name"],
                       "file_size": a.get("file_size"), "size_str": a.get("size_str"),
                       "clean_title": (p.clean_title or "")[:300], "media_type": p.media_type,
                       "season": p.season, "episode": p.episode,
                       "pie": a.get("pie"), "pistas": a.get("pistas")})
    await insert_media_items(nuevos)

    tipo = peticion["media_type"]
    serie = tipo == "tv"
    filas = []
    for a in aceptados:
        p = parse_filename(a["file_name"])
        filas.append((peticion["tmdb_id"], tipo, "series" if serie else "movie",
                      (p.season or 1) if serie else None, p.episode if serie else None,
                      a["channel_id"], a["message_id"]))
    async with get_pool().acquire() as conn:
        await conn.executemany("""
            UPDATE media_items
               SET tmdb_id = $1, tmdb_type = $2, media_type = $3, season = $4, episode = $5,
                   tmdb_valid = TRUE, tmdb_searched = TRUE, tmdb_manual = TRUE
             WHERE channel_id = $6 AND message_id = $7
        """, filas)
    cache.cambio_en_catalogo()
    cache.cambio_en_tmdb()
    return len(filas)


async def contra_peticiones(item: dict, api_key: str) -> bool:
    """Lo que acaba de llegar a un canal, contra lo que alguien ha pedido.

    Sin esto, una peticion se daba por conseguida cuando el bucle de TMDB le
    ponia al archivo **la misma** ficha, y eso falla justo con lo que mas se
    pide: un estreno con el mismo titulo que otra pelicula («Animales» de
    2026) acababa con la otra y la peticion seguia esperando, con su mensaje
    en el grupo. Aqui la ficha la sabemos de antemano (la de la peticion), asi
    que se compara con `veredicto`, lo mismo que la busqueda de antes de
    pedir, y lo que es ese titulo se indexa con ella (`tmdb_manual`: el bucle
    de TMDB ya no la cambia) y se recoge la peticion en el momento.

    `item` es la fila recien metida en `media_items`. Devuelve si era algo
    pedido."""
    from app.database import peticiones as db
    from app.services.tmdb import get_details

    activas = await db.activas()
    if not activas:
        return False
    for p in activas:
        if not p.get("titulo_original") and api_key:
            # Las de antes de guardar el original: se pregunta una vez.
            ficha = await get_details(api_key, p["tmdb_id"], p["media_type"])
            if ficha and ficha.get("original_title"):
                p["titulo_original"] = ficha["original_title"]
                await db.guardar_original(p["id"], p["titulo_original"])
        si, por_que = veredicto(item["file_name"], item.get("pistas"), p)
        if not si:
            continue
        detalles = await get_details(api_key, p["tmdb_id"], p["media_type"]) if api_key else None
        if not detalles:
            logger.warning("Llega lo pedido («%s»: %s) pero TMDB no da su ficha; lo emparejara el bucle",
                           p["titulo"], item["file_name"][:90])
            return False
        await _indexar([{**item, "indexado": True}], p, detalles)
        logger.info("Llega lo pedido: «%s» es %s (%s)", p["titulo"], item["file_name"][:90], por_que)
        # Recogerla (avisar y borrar el mensaje del grupo) en segundo plano:
        # el indexado en vivo no espera a Telegram ni al push.
        from app.services.peticiones import repasar
        from app.tasks import spawn
        spawn(repasar(), "peticion_llegada")
        return True
    return False


async def buscar_e_indexar(peticion: dict, detalles: dict) -> int:
    """Busca la peticion en los canales y, lo que sea ese titulo, lo indexa
    con su ficha. Devuelve cuantos archivos; 0 si no hay nada (o si la
    busqueda no ha podido hacerse a tiempo: entonces se pide como siempre)."""
    consultas = []
    for t in (peticion.get("titulo"), peticion.get("titulo_original")):
        q = titulo_para_buscar(t)
        if q and q.lower() not in (c.lower() for c in consultas):
            consultas.append(q)
    if not consultas:
        return 0

    async def _todo() -> int:
        candidatos = await _del_catalogo(peticion, consultas)
        try:
            candidatos += await _de_telegram(peticion, consultas)
        except Exception as e:
            # Sin Telegram (desconectado, un FloodWait) vale lo del catalogo.
            logger.warning("Peticion «%s»: la busqueda en Telegram fallo: %s", peticion.get("titulo"), e)
        aceptados = []
        for c in candidatos:
            si, por_que = veredicto(c["file_name"], c.get("pistas"), peticion)
            logger.info("Peticion «%s»: %s %s (%s)", peticion.get("titulo"), "SI" if si else "no",
                        c["file_name"][:90], por_que)
            if si:
                aceptados.append(c)
        if not aceptados:
            return 0
        return await _indexar(aceptados, peticion, detalles)

    try:
        n = await asyncio.wait_for(_todo(), ESPERA_S)
    except asyncio.TimeoutError:
        logger.warning("Peticion «%s»: la busqueda en los canales tardaba demasiado; se pide", peticion.get("titulo"))
        return 0
    except Exception as e:
        logger.warning("Peticion «%s»: no se pudo buscar en los canales: %s", peticion.get("titulo"), e)
        return 0
    if n:
        logger.info("Peticion «%s»: estaba en los canales, %d archivos indexados con su ficha",
                    peticion.get("titulo"), n)
    return n
