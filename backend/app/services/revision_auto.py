"""Revision automatica: lo de Admin -> Revision que se puede arreglar solo.

Medido sobre el catalogo (6.431 grupos, 15.112 archivos, noviembre de 2026),
casi todo cae en tres familias:

* **Series tomadas por peliculas** (o al reves): Black Clover, Minky Momo,
  Codigo Lyoko, Tiro Loco McGraw... decenas de archivos numerados («135 -
  Black Clover», «Minky Momo 10») que se buscaron en TMDB como pelicula y se
  quedaron con una pelicula de titulo parecido. Buscando **como serie** con el
  titulo del canal sale la buena a la primera.
* **Coincidencias exactas que se quedaron en «dudosa»**: Una batalla tras
  otra, Dune: Parte dos, Eddington... el titulo y el año del canal dan
  exactamente una pelicula de TMDB.
* **Carteles del canal tomados por titulo** («RECOMENDADA», «Temporada-15»,
  «19 episodios»): eso no se arregla aqui sino al leer las fichas
  (services/contexto.py); aqui solo se reconocen para no buscarlos.

Para cada grupo se deduce el tipo **por sus archivos** (`tipo_y_episodios`):
con capitulos numerados es una serie, diga lo que diga el nombre. Se busca en
TMDB con `exactos()` (titulo u original exactamente igual, del tipo deducido)
y se decide con `decidir()`:

* **segura** -> se aplica sola: una sola coincidencia exacta, con caratula,
  y que se sostiene sin mirar nada mas (en una pelicula, el año del canal
  cuadra; en una serie, todos los archivos tienen su capitulo). Lo aplicado
  guarda como estaba cada archivo (`antes`) y se puede deshacer desde el
  panel. Queda `tmdb_manual`, como una correccion a mano.
* **sugerida** -> se enseña en el panel con su caratula y se acepta de un
  toque: hay candidata, pero algo no basta (sin año, dos que se llaman igual,
  capitulos sin numero, o solo un parecido).
* **sin_candidato** -> se queda como esta; se vuelve a mirar a los 30 dias.

Lo deshecho y lo descartado por el admin no se vuelve a aplicar ni a sugerir.

Corre **segun entra**: cada 15 min mira si el catalogo ha cambiado y, si si,
pasa por los grupos que no se han mirado (ver `de_fondo`); y con «Revisar
ahora» del panel.
"""
import asyncio
import json
import logging
import re
import time
import unicodedata

logger = logging.getLogger("tmd")

ESPERA_ARRANQUE_S = 10 * 60
CADA_S = 6 * 3600
# Consultas a TMDB a la vez (cada grupo son una o dos).
CONCURRENCIA = 4
# Lo que no dio nada se vuelve a mirar pasado esto (TMDB cambia).
REINTENTO_DIAS = 30
# Una serie se reconoce por sus capitulos: al menos tantos numeros distintos.
MIN_CAPITULOS = 3

_estado: dict = {"corriendo": False, "empezo": None, "termino": None, "mirados": 0, "por_mirar": 0,
                 "aplicadas": 0, "sugeridas": 0}
_cerrojo = asyncio.Lock()


def _norm(texto: str | None) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", t)


# --- Lo que no es un titulo ----------------------------------------------------

# Carteles y recuentos que el canal pone donde iria el titulo.
_NO_TITULO_RE = re.compile(
    r"^(?:temporada|season|cap[ií]tulo|episodio|episodios|serie|miniserie|pel[ií]cula|recomendad[oa]|"
    r"estreno|novedad|sinopsis|sipnosis|parte|part|t\d+|s\d+|cap|hmax|web|dd\d|completa)\b[\s\-\d.ºª]*$",
    re.IGNORECASE)
_RECUENTO_RE = re.compile(r"^\d+\s*(?:episodios|cap[ií]tulos|temporadas|pel[ií]culas|partes)\b", re.IGNORECASE)
# Lo que va delante del titulo y no es titulo: «Serie Dragon Ball Super»,
# «SIPNOSIS SERIE TRIADA», «Dejo por aquí la serie Embrujadas».
_PREFIJO_RE = re.compile(
    r"^(?:(?:dejo|os dejo|aqu[ií] (?:os )?dejo)[^,]*?\b(?:la |el )?(?:serie|pel[ií]cula|saga)\s+|"
    r"s[ií]n?p[nñ]?[oó]sis\s*:?\s*(?:mini)?serie\s+|s[ií]n?p[nñ]?[oó]sis\s*:?\s*|"
    r"(?:mini)?serie\s*:?\s+(?=\S)|pel[ií]cula\s*:?\s+(?=\S))",
    re.IGNORECASE)
# Lo que va detras: idioma, calidad, «ESP», «Castellano», un recuento.
_SUFIJO_RE = re.compile(
    r"(?:\s+(?:esp|castellano|latino|dual|vose|1080p|720p|4k|hd|completa|anime|"
    r"\d+\s*(?:seasons?|temporadas?|episodios|cap[ií]tulos)(?:\s*\+\s*especiales)?)\b.*)$",
    re.IGNORECASE)


# Etiquetas de calidad o de origen: un «titulo» hecho solo de esto no es nada.
_ETIQUETA_RE = re.compile(r"^(?:hmax|hbo|amzn|nf|dsnp|web(?:-?dl|rip)?|dd\+?\d(?:\.\d)?|ddp\d(?:\.\d)?|aac\d?(?:\.\d)?|"
                          r"h\.?26[45]|x26[45]|hevc|\d{3,4}p|4k|hdr|dual|esp|cast|lat|mkv|mp4)$", re.IGNORECASE)


def _plano(texto: str) -> str:
    """Sin tildes ni adornos, letra por letra (misma longitud): «Sîpńõsïs» ->
    «Sipnosis». Para que los patrones de arriba casen y se pueda cortar el
    texto original por el mismo sitio."""
    return "".join((unicodedata.normalize("NFKD", c)[:1] or c) for c in texto)


def titulo_buscable(titulo: str | None) -> str | None:
    """El titulo de un grupo listo para buscar, o None si no es un titulo
    («RECOMENDADA», «Temporada-15», «19 episodios», «HMAX DD5.1»)."""
    t = re.sub(r"\s+", " ", (titulo or "").replace("_", " ")).strip(" -·.:|")
    m = _PREFIJO_RE.match(_plano(t))
    if m:
        t = t[m.end():].strip()
    m = _SUFIJO_RE.search(_plano(t))
    if m:
        t = t[:m.start()]
    t = t.strip(" -·.:|")
    if len(_norm(t)) < 3 or _NO_TITULO_RE.match(_plano(t)) or _RECUENTO_RE.match(_plano(t)):
        return None
    if all(_ETIQUETA_RE.match(p) for p in re.split(r"[\s._\-\[\]()]+", t) if p and not re.fullmatch(r"\d", p)):
        return None
    if not re.search(r"[^\W\d_]{2,}", t):
        return None
    return t


# Idioma, calidad y formato que van pegados a un titulo con capitulo:
# «DBZ Kai 36 Cast Cat Gal Eusk», «2025 Blood White Blue HDRip».
_ETIQUETAS_SUELTAS_RE = re.compile(
    r"(?<![a-z0-9])(?:cast|castellano|cat|catalan|gal|gallego|eusk|euskera|esp|spa|lat|latino|dual|vose|vos|"
    r"subs?|subtitulad[oa]s?|hdrip|webrip|web-?dl|bdrip|brrip|dvdrip|hdtv|bluray|\d{3,4}p|[xh]\.?26[45]|"
    r"hevc|xvid|divx|ac3|aac|mp3|mkv|mp4|avi)(?![a-z0-9])", re.IGNORECASE)


def sin_capitulo(titulo: str | None) -> str | None:
    """El titulo sin el numero de capitulo ni lo que va detras, para buscar en
    TMDB lo que se tomo por pelicula de un solo archivo: «Black Clover 151» ->
    «Black Clover», «Patlabor 07 El ilustre 97 renovado» -> «Patlabor»,
    «135 - Black Clover» -> «Black Clover», «DBZ Kai 36 Cast Cat Gal Eusk» ->
    «DBZ Kai». None si no cambia nada o no queda un titulo. Un año (1900-2035)
    no se toma por capitulo. Es solo una busqueda mas, que va detras de la del
    titulo entero: «Rocky 2» tambien da «Rocky», y quien elige es Claude, con
    las dos a la vista."""
    base = titulo_buscable(titulo)
    if not base:
        return None
    t = _ETIQUETAS_SUELTAS_RE.sub(" ", base.replace("_", " "))
    t = re.sub(r"^\s*\d{1,4}\s*[-.:]\s*", "", t)          # «135 - Black Clover»
    for m in re.finditer(r"(?<![\w])(\d{1,4})(?![\w])", t):
        n = m.group(1)
        if len(n) == 4 and 1900 <= int(n) <= 2035:
            continue
        if re.search(r"[^\W\d_]{2,}", t[:m.start()]):
            t = t[:m.start()]
        break
    t = titulo_buscable(re.sub(r"\s+", " ", t).strip(" -·.:|,"))
    return t if t and _norm(t) != _norm(base) else None


# --- El tipo, por los archivos -------------------------------------------------

_FICHA_SERIE_RE = re.compile(r"\b(?:serie|temporadas?|cap[ií]tulos|episodios|miniserie|season)\b", re.IGNORECASE)


def tipo_y_episodios(miembros: list[tuple], tipo: str, ficha: str | None,
                     titulo: str | None = None) -> tuple[str, dict | None]:
    """('series'|'movie', {id: (temporada, episodio)} o None).

    Con capitulos numerados es una serie aunque el nombre no lo diga: «135 -
    Black Clover», «Minky Momo 10». El dict trae el capitulo de **cada**
    archivo, y solo se da si todos lo tienen: si falta alguno (o son partes
    de un comprimido, cuyo numero es el de la parte) la serie se reconoce
    igual, pero no se puede aplicar sola."""
    from app.services.revision import _MULTIPARTE_RE, episodio_de

    if any(_MULTIPARTE_RE.search(m[5] or "") for m in miembros):
        return ("series" if tipo == "series" or (ficha and _FICHA_SERIE_RE.search(ficha)) else tipo), None
    eps = {m[0]: episodio_de(m, titulo) for m in miembros}
    numeros = {(t or 1, e) for t, e in eps.values() if e is not None}
    todos = all(e is not None for _, e in eps.values())
    if len(numeros) >= MIN_CAPITULOS or (tipo == "series" and numeros):
        return "series", ({i: ((t or 1), e) for i, (t, e) in eps.items()} if todos else None)
    if tipo == "series" or (ficha and _FICHA_SERIE_RE.search(ficha[:300]) and len(miembros) >= MIN_CAPITULOS):
        return "series", None
    return "movie", None


# --- La decision ---------------------------------------------------------------

def decidir(candidatos: list[dict], tipo: str, año: int | None, episodios: dict | None,
            actual: dict | None) -> tuple[str, dict | None, str]:
    """('segura'|'sugerida'|'nada', candidata, por que) a partir de las
    coincidencias **exactas** de TMDB (titulo u original iguales, del tipo
    deducido). Pura: se prueba sin TMDB (`prueba_revision_auto.py`)."""
    if not candidatos:
        return "nada", None, "TMDB no tiene nada que se llame exactamente así"
    elegida, porque = None, ""
    if año:
        cerca = [c for c in candidatos if c.get("year") and abs(c["year"] - año) <= 1]
        if len(cerca) == 1:
            elegida = cerca[0]
        elif tipo == "series":
            # El año de la ficha de una serie suele ser el de la temporada
            # subida, no el del estreno: vale la que empezo antes o ese año.
            antes = [c for c in candidatos if c.get("year") and c["year"] <= año]
            if len(antes) == 1:
                elegida = antes[0]
    if elegida is None and len(candidatos) == 1:
        elegida = candidatos[0]
    if elegida is None:
        mejor = max(candidatos, key=lambda c: c.get("vote_count") or 0)
        return "sugerida", mejor, f"{len(candidatos)} títulos se llaman así: la más votada"
    if actual and actual.get("tmdb_id") == elegida["tmdb_id"] and actual.get("media_type") == tipo:
        # Es la que ya tenia: «dudosa» era una falsa alarma. Confirmarla es
        # sacarla de la lista sin cambiar nada (se marca como corregida).
        porque = "la ficha que tenía es la buena"
    if not elegida.get("poster"):
        return "sugerida", elegida, "coincide, pero TMDB no tiene carátula"
    if tipo == "movie":
        if not año:
            return "sugerida", elegida, "coincide el título; el canal no dice el año"
        if not elegida.get("year") or abs(elegida["year"] - año) > 1:
            return "sugerida", elegida, f"coincide el título, pero es de {elegida.get('year') or '¿?'} y el canal dice {año}"
        return "segura", elegida, porque or f"mismo título y año ({año})"
    if episodios is None:
        return "sugerida", elegida, "es una serie, pero no todos los archivos dicen su capítulo"
    capitulos = len(set(episodios.values()))
    if capitulos < MIN_CAPITULOS and not (año and elegida.get("year") and elegida["year"] <= año):
        # Uno o dos capitulos de un titulo corto («Al límite», S04E004) no
        # bastan: hay demasiadas series que se llaman igual.
        return "sugerida", elegida, f"solo {capitulos} capítulo{'s' if capitulos > 1 else ''} y sin año que lo confirme"
    return "segura", elegida, porque or f"misma serie, {capitulos} capítulos numerados"


# --- Base de datos ---------------------------------------------------------------

async def _filas_hechas() -> dict[str, dict]:
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        filas = await conn.fetch("""SELECT clave, estado, EXTRACT(EPOCH FROM (NOW() - creado)) AS hace
                                      FROM revision_auto""")
    return {f["clave"]: dict(f) for f in filas}


async def sugerencias() -> dict[str, dict]:
    """{clave: sugerencia} de lo que espera un si o un no en el panel."""
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        filas = await conn.fetch("SELECT clave, sugerencia, porque FROM revision_auto WHERE estado = 'sugerida'")
    salida = {}
    for f in filas:
        s = f["sugerencia"]
        s = json.loads(s) if isinstance(s, str) else s
        if s:
            salida[f["clave"]] = {**s, "porque": f["porque"]}
    return salida


async def _guardar(clave: str, titulo: str, motivo: str, estado: str, porque: str,
                   sugerencia: dict | None, archivos: int, antes: list | None) -> None:
    from app.database.connection import get_pool

    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO revision_auto (clave, titulo, motivo, estado, porque, sugerencia, archivos, antes)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
            ON CONFLICT (clave) DO UPDATE
               SET titulo = EXCLUDED.titulo, motivo = EXCLUDED.motivo, estado = EXCLUDED.estado,
                   porque = EXCLUDED.porque, sugerencia = EXCLUDED.sugerencia,
                   archivos = EXCLUDED.archivos, antes = EXCLUDED.antes, creado = NOW()
        """, clave, titulo[:200], motivo, estado, porque, json.dumps(sugerencia) if sugerencia else None,
            archivos, json.dumps(antes) if antes else None)


def _ficha(c: dict) -> dict:
    return {"tmdb_id": c["tmdb_id"], "media_type": "series" if c["media_type"] == "tv" else "movie",
            "title": c["title"], "year": c.get("year"), "poster": c.get("poster"),
            "original_title": c.get("original_title")}


# --- La pasada -------------------------------------------------------------------

async def _candidatos(api_key: str, titulos: list[str], tipo: str, año: int | None) -> list[dict]:
    from app.services.tmdb import exactos

    tmdb_tipo = "tv" if tipo == "series" else "movie"
    vistos: dict[int, dict] = {}
    for t in titulos:
        for c in await exactos(api_key, t, tmdb_tipo, año if tipo == "movie" else None):
            vistos.setdefault(c["tmdb_id"], c)
        if vistos:
            break
    return list(vistos.values())


async def mirar_grupo(g: dict, api_key: str) -> str:
    """Mira un grupo y hace lo que toque. Devuelve el estado guardado."""
    from app.services import revision

    titulos = [t for t in (titulo_buscable(g["titulo"]), titulo_buscable(g.get("original"))) if t]
    if g.get("sin_nombre"):
        titulos = []
    if not titulos:
        await _guardar(g["clave"], g["titulo"], g["motivo"], "sin_candidato", "el título no es buscable",
                       None, len(g["miembros"]), None)
        return "sin_candidato"
    tipo, episodios = tipo_y_episodios(g["miembros"], g["tipo"], g.get("ficha"), titulos[0])
    candidatos = await _candidatos(api_key, titulos, tipo, g.get("año"))
    actual = g.get("actual")
    cual, elegida, porque = decidir(candidatos, tipo, g.get("año"), episodios, actual)
    if cual == "segura" and g["motivo"] == "sin_caratula" and actual and actual.get("tmdb_id") == elegida["tmdb_id"]:
        cual = "nada"   # la misma ficha sin caratula: no hay nada que arreglar
    if cual == "segura" and tipo != g["tipo"]:
        # El tipo se ha dado la vuelta por los numeros de los archivos. Unas
        # peliculas numeradas («Star Wars» 4, 5 y 6) tambien los tienen: si
        # hay una pelicula que se llama exactamente igual, no se decide solo.
        otro = await _candidatos(api_key, titulos, "movie" if tipo == "series" else "series", None)
        if otro:
            cual, porque = "sugerida", (f"parece {'una serie' if tipo == 'series' else 'una película'}, "
                                        f"pero también hay {'una película' if tipo == 'series' else 'una serie'} "
                                        f"que se llama así")
    if cual == "segura":
        antes = await revision.poner_ficha(g["miembros"], elegida["tmdb_id"], elegida["media_type"], api_key,
                                           titulo=titulos[0], recalcular=False)
        await _guardar(g["clave"], g["titulo"], g["motivo"], "aplicada", porque, _ficha(elegida),
                       len(g["miembros"]), antes)
        revision.quitar(g["clave"])     # fuera de la lista ya, sin recalcularla
        logger.info("Revision automatica: «%s» -> %s/%d «%s» (%d archivos; %s)", g["titulo"],
                    elegida["media_type"], elegida["tmdb_id"], elegida["title"], len(g["miembros"]), porque)
        return "aplicada"
    if cual == "sugerida":
        await _guardar(g["clave"], g["titulo"], g["motivo"], "sugerida", porque, _ficha(elegida),
                       len(g["miembros"]), None)
        return "sugerida"
    await _guardar(g["clave"], g["titulo"], g["motivo"], "sin_candidato", porque, None, len(g["miembros"]), None)
    return "sin_candidato"


async def _por_mirar() -> list[dict]:
    from app.services import revision

    hechas = await _filas_hechas()
    todos = [g for lista in (await revision.grupos()).values() for g in lista]
    pendientes = []
    for g in todos:
        h = hechas.get(g["clave"])
        # «aplicada» y aun en la lista: ha llegado algo nuevo de un grupo ya
        # arreglado (otra parte, otro capitulo), y se le pone la misma ficha.
        if (h is None or h["estado"] == "aplicada"
                or (h["estado"] == "sin_candidato" and h["hace"] > REINTENTO_DIAS * 86400)):
            pendientes.append(g)
    # Los grandes primero: si se para a medias, lo arreglado es lo que mas pesa.
    pendientes.sort(key=lambda g: -len(g["miembros"]))
    return pendientes


async def _reaplicar(g: dict, api_key: str) -> str | None:
    """Algo nuevo de un grupo ya arreglado (su fila dice «aplicada» y vuelve
    a estar en la lista: otra parte de la pelicula, otro capitulo): se le pone
    la misma ficha, que ya se verifico, sin gastar nada. En una serie, solo si
    cada archivo nuevo dice su capitulo; si no, queda como sugerencia con esa
    ficha. Lo nuevo se suma al `antes` del grupo, asi que su Deshacer lo
    devuelve todo. None si el grupo no estaba arreglado."""
    from app.database.connection import get_pool
    from app.services import revision

    async with get_pool().acquire() as conn:
        f = await conn.fetchrow("SELECT id, sugerencia, antes FROM revision_auto WHERE clave = $1 AND estado = 'aplicada'",
                                g["clave"])
    if not f:
        return None
    s = json.loads(f["sugerencia"]) if isinstance(f["sugerencia"], str) else f["sugerencia"]
    if not s or not s.get("tmdb_id"):
        return None
    titulo = titulo_buscable(g["titulo"]) or g["titulo"]
    serie = s.get("media_type") in ("series", "tv")
    if serie:
        titulo = sin_capitulo(titulo) or titulo
        _, episodios = tipo_y_episodios(g["miembros"], "series", g.get("ficha"), titulo)
        if episodios is None:
            async with get_pool().acquire() as conn:
                await conn.execute("""UPDATE revision_auto SET estado = 'sugerida', creado = NOW(),
                                             porque = 'llegaron archivos nuevos que no dicen su capítulo' WHERE id = $1""",
                                   f["id"])
            return "sugerida"
    antes = await revision.poner_ficha(g["miembros"], s["tmdb_id"], s["media_type"], api_key, titulo=titulo)
    viejo = json.loads(f["antes"]) if isinstance(f["antes"], str) else (f["antes"] or [])
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE revision_auto SET antes = $2::jsonb, archivos = archivos + $3 WHERE id = $1",
                           f["id"], json.dumps(viejo + antes), len(g["miembros"]))
    revision.quitar(g["clave"])
    logger.info("Revision automatica: «%s», %d archivos nuevos con la misma ficha (%s/%s)", g["titulo"],
                len(g["miembros"]), s["media_type"], s["tmdb_id"])
    return "aplicada"


def _ident(clave: str) -> str:
    """Lo que no cambia de un grupo aunque cambie su clave: tipo y titulo (la
    clave lleva ademas el motivo y la ficha que tiene, que cambian)."""
    return "|".join(clave.split("|")[1:3])


async def _heredar(g: dict) -> bool:
    """Si este grupo ya se miro con otra clave (cambio su motivo o su ficha),
    se queda con lo que se hizo entonces en vez de volver a hacerlo: busquedas,
    lo que dijo Claude, la sugerencia. Lo aplicado no: si el grupo ha vuelto a
    salir, es que hay algo nuevo que mirar."""
    from app.database.connection import get_pool

    async with get_pool().acquire() as conn:
        f = await conn.fetchrow("""
            SELECT estado, porque, sugerencia, ia, candidatas, propuesta FROM revision_auto
             WHERE split_part(clave, '|', 2) || '|' || split_part(clave, '|', 3) = $1 AND clave <> $2
               AND estado IN ('sugerida', 'sin_candidato') AND ia_lote IS NULL
             ORDER BY creado DESC LIMIT 1
        """, _ident(g["clave"]), g["clave"])
        if not f:
            return False
        await conn.execute("""
            INSERT INTO revision_auto (clave, titulo, motivo, estado, porque, sugerencia, archivos, ia, candidatas, propuesta)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (clave) DO NOTHING
        """, g["clave"], g["titulo"][:200], g["motivo"], f["estado"], f["porque"], f["sugerencia"],
            len(g["miembros"]), f["ia"], f["candidatas"], f["propuesta"])
    return True


async def pasada(api_key: str) -> dict:
    """Mira todos los grupos que no se han mirado. Una a la vez (cerrojo)."""
    from app.services import revision

    if not api_key or _cerrojo.locked():
        return dict(_estado)
    async with _cerrojo:
        pendientes = await _por_mirar()
        _estado.update(corriendo=True, empezo=time.time(), termino=None, mirados=0,
                       por_mirar=len(pendientes), aplicadas=0, sugeridas=0)
        sem = asyncio.Semaphore(CONCURRENCIA)

        async def uno(g):
            async with sem:
                try:
                    r = (await _reaplicar(g, api_key)) or ("heredada" if await _heredar(g)
                                                           else await mirar_grupo(g, api_key))
                except Exception as e:
                    logger.warning("Revision automatica: «%s» fallo: %s", g["titulo"], e)
                    r = None
                _estado["mirados"] += 1
                if r == "aplicada":
                    _estado["aplicadas"] += 1
                elif r == "sugerida":
                    _estado["sugeridas"] += 1

        try:
            await asyncio.gather(*(uno(g) for g in pendientes))
        finally:
            _estado.update(corriendo=False, termino=time.time())
            # Para que el panel sepa cuando fue el ultimo repaso tambien tras un
            # reinicio: en memoria se perdia con cada despliegue y decia
            # «esperando al primer repaso» con todo ya revisado.
            try:
                from app.database.connection import set_app_settings
                await set_app_settings({"revision_auto_ultima": str(_estado["termino"])})
            except Exception as e:
                logger.warning("Revision automatica: no se ha podido apuntar la hora del repaso: %s", e)
        logger.info("Revision automatica: %d grupos mirados, %d corregidos solos, %d con sugerencia",
                    _estado["mirados"], _estado["aplicadas"], _estado["sugeridas"])
        return dict(_estado)


# Cada cuanto se mira si el lote de la revision con IA ha acabado, y cada
# cuanto si el catalogo ha cambiado (archivos nuevos, fichas recien buscadas).
MIRA_LOTE_S = 5 * 60
# Cada cuanto se pregunta a Anthropic si un lote ha acabado (no cuesta nada).
MIRA_RECOGER_S = 60
MIRA_CAMBIOS_S = 15 * 60


async def _huella() -> tuple | None:
    """Lo que cambia cuando entra algo que puede acabar en Revision: archivos
    nuevos y archivos que el indexador acaba de buscar en TMDB (un archivo no
    sale en Revision hasta que se ha buscado y no se ha encontrado)."""
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        # Sin lo corregido a mano: eso lo cambia la propia revision (Claude,
        # la coincidencia exacta, el panel), que ya quita el grupo de la lista;
        # contarlo hacia recalcular la lista entera cada vez que Claude aplicaba.
        f = await conn.fetchrow("""SELECT COALESCE(MAX(id), 0) AS ultimo,
                                          COUNT(*) FILTER (WHERE tmdb_searched) AS buscados
                                     FROM media_items""")
    return tuple(f)


async def de_fondo(api_key: str) -> None:
    """La revision va **segun entra**: cada 15 min se mira si el catalogo ha
    cambiado y, si si, la pasada exacta (lo que cuadra perfecto se acepta
    solo) y despues un lote para Claude con lo que quede (services/
    revision_ia.py, si esta encendida). Cada minuto se mira si algun lote ha
    acabado (se recoge y sale el siguiente en el momento) y cada 5 se manda lo
    que espere y se lanza la busqueda en TMDB. Lo que
    se quedo sin coincidencia se vuelve a mirar cada 6 h (y a los 30 dias se
    busca otra vez en TMDB), por si TMDB añade la ficha despues."""
    from app.services import revision, revision_ia

    from app.tasks import spawn

    await asyncio.sleep(ESPERA_ARRANQUE_S)
    huella_vista, ultima_completa, ultimo_cambio, ultimo_envio = None, 0.0, 0.0, 0.0

    async def repaso():
        # La pasada exacta y, al acabar, el lote con lo que quede. Aparte, para
        # que una pasada larga no retrase la recogida de los lotes.
        if await _por_mirar():
            await pasada(api_key)
        await revision_ia.mandar(api_key)

    while True:
        ahora = time.time()
        try:
            # Cada minuto: un lote que ha acabado se recoge enseguida (lo
            # confirmado se aplica) y, si ha vuelto alguno, sale el siguiente
            # sin esperar: las propuestas de Haiku van a Sonnet en el momento.
            recogido = await revision_ia.recoger()
            if recogido or ahora - ultimo_envio >= MIRA_LOTE_S:
                ultimo_envio = ahora
                # Si no hay lote de esa clase en marcha y algo espera (a Haiku,
                # o a que Sonnet verifique), sale el siguiente.
                await revision_ia.mandar(api_key)
                # Lo cobrado por lotes que aqui no constaban (ver `conciliar`).
                await revision_ia.conciliar()
                # Lo que no se resuelve con candidatas lo busca Haiku en TMDB
                # (no va en lote). Por tandas y aparte; el cerrojo evita dos.
                if not revision_ia._cerrojo_investigar.locked():
                    spawn(revision_ia.investigar_pendientes(api_key), "revision_ia_investigar")
        except Exception as e:
            logger.error("Revision con IA: no se ha podido recoger el lote: %s", e)
        if ahora - ultimo_cambio >= MIRA_CAMBIOS_S or ahora - ultima_completa >= CADA_S:
            ultimo_cambio = ahora
            try:
                huella = await _huella()
                if huella != huella_vista or ahora - ultima_completa >= CADA_S:
                    if huella_vista is not None and huella != huella_vista:
                        revision.olvidar()   # que los grupos se calculen con lo nuevo
                    huella_vista, ultima_completa = huella, ahora
                    if not _cerrojo.locked():
                        spawn(repaso(), "revision_repaso")
            except Exception as e:
                logger.error("Revision automatica fallo: %s", e)
        await asyncio.sleep(MIRA_RECOGER_S)


# --- Lo que pide el panel ------------------------------------------------------

async def estado() -> dict:
    from app.database.connection import get_pool

    cuentas = {}
    # Lo mismo, separado por quien lo hizo: el paso 1 (coincidencia exacta),
    # el paso 2 (Claude) y lo aceptado a mano en el paso 3. Es lo que pinta
    # el flujo del panel.
    pasos = {"exacta": {"grupos": 0, "archivos": 0},
             "ia": {"aplicadas": 0, "archivos": 0, "sugeridas": 0, "ninguna": 0},
             "mano": {"grupos": 0, "archivos": 0}}
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            for f in await conn.fetch("""SELECT estado, COUNT(*) AS grupos, COALESCE(SUM(archivos), 0) AS archivos
                                           FROM revision_auto GROUP BY estado"""):
                cuentas[f["estado"]] = {"grupos": f["grupos"], "archivos": f["archivos"]}
            for f in await conn.fetch("""
                SELECT estado, COALESCE(ia NOT IN ('por_verificar', 'sin_candidatas'), FALSE) AS por_ia,
                       porque = 'aceptada a mano' AS a_mano,
                       COUNT(*) AS grupos, COALESCE(SUM(archivos), 0) AS archivos
                  FROM revision_auto GROUP BY 1, 2, 3"""):
                if f["estado"] == "aplicada" and f["a_mano"]:
                    pasos["mano"]["grupos"] += f["grupos"]
                    pasos["mano"]["archivos"] += f["archivos"]
                elif f["estado"] == "aplicada" and f["por_ia"]:
                    pasos["ia"]["aplicadas"] += f["grupos"]
                    pasos["ia"]["archivos"] += f["archivos"]
                elif f["estado"] == "aplicada":
                    pasos["exacta"]["grupos"] += f["grupos"]
                    pasos["exacta"]["archivos"] += f["archivos"]
                elif f["por_ia"] and f["estado"] == "sugerida":
                    pasos["ia"]["sugeridas"] += f["grupos"]
                elif f["por_ia"] and f["estado"] == "sin_candidato":
                    pasos["ia"]["ninguna"] += f["grupos"]
    from app.services import revision_ia

    try:
        ia = await revision_ia.estado()
    except Exception as e:
        logger.warning("Revision con IA: no se ha podido leer su estado: %s", e)
        ia = None
    termino = _estado.get("termino")
    if termino is None:
        from app.database.connection import get_app_settings
        try:
            termino = float((await get_app_settings()).get("revision_auto_ultima") or 0) or None
        except (ValueError, TypeError):
            termino = None
    return {**_estado, "termino": termino, "cuentas": cuentas, "pasos": pasos, "ia": ia}


async def aplicadas(offset: int = 0, limit: int = 30, origen: str = "") -> dict:
    """Lo aplicado, lo mas nuevo primero. `origen`: "ia" (lo decidio Claude,
    services/revision_ia.py), "exacta" (la coincidencia exacta o una
    sugerencia aceptada a mano) o "" (todo)."""
    from app.database.connection import get_pool

    filtro = {"ia": "AND ia IS NOT NULL", "exacta": "AND ia IS NULL"}.get(origen, "")
    pool = get_pool()
    async with pool.acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM revision_auto WHERE estado = 'aplicada' {filtro}")
        filas = await conn.fetch(f"""
            SELECT id, titulo, motivo, porque, sugerencia, archivos, creado, ia
              FROM revision_auto WHERE estado = 'aplicada' {filtro}
             ORDER BY creado DESC, archivos DESC OFFSET $1 LIMIT $2
        """, offset, limit)
    return {"total": total, "items": [
        {"id": f["id"], "titulo": f["titulo"], "motivo": f["motivo"], "porque": f["porque"],
         "ficha": json.loads(f["sugerencia"]) if isinstance(f["sugerencia"], str) else f["sugerencia"],
         "archivos": f["archivos"], "creado": f["creado"].isoformat(), "por_ia": f["ia"] is not None}
        for f in filas]}


async def deshacer(id_: int) -> int:
    """Devuelve el grupo a como estaba y no lo vuelve a tocar (ni a sugerir)."""
    from app.database.connection import get_pool
    from app.services import revision

    pool = get_pool()
    async with pool.acquire() as conn:
        f = await conn.fetchrow("SELECT antes, titulo FROM revision_auto WHERE id = $1 AND estado = 'aplicada'", id_)
    if not f:
        return 0
    antes = json.loads(f["antes"]) if isinstance(f["antes"], str) else (f["antes"] or [])
    n = await revision.deshacer(antes)
    async with pool.acquire() as conn:
        await conn.execute("UPDATE revision_auto SET estado = 'deshecha' WHERE id = $1", id_)
    logger.info("Revision automatica: deshecho «%s» (%d archivos)", f["titulo"], n)
    return n


async def descartar(clave: str) -> bool:
    """La sugerencia no era: no se vuelve a sugerir. El grupo sigue en la
    lista para corregirlo a mano."""
    from app.database.connection import get_pool

    pool = get_pool()
    async with pool.acquire() as conn:
        r = await conn.execute("UPDATE revision_auto SET estado = 'descartada' WHERE clave = $1 AND estado = 'sugerida'",
                               clave)
    return r.endswith("1")


async def aceptar(clave: str, api_key: str) -> int:
    """El si a una sugerencia: se aplica como si fuera segura (con su `antes`,
    asi que tambien sale en «Corregido solo» y se puede deshacer)."""
    from app.database.connection import get_pool
    from app.services import revision

    g = await revision.grupo(clave)
    if not g:
        return 0
    pool = get_pool()
    async with pool.acquire() as conn:
        f = await conn.fetchrow("SELECT sugerencia FROM revision_auto WHERE clave = $1 AND estado = 'sugerida'", clave)
    if not f:
        return 0
    s = json.loads(f["sugerencia"]) if isinstance(f["sugerencia"], str) else f["sugerencia"]
    antes = await revision.poner_ficha(g["miembros"], s["tmdb_id"], s["media_type"], api_key,
                                       titulo=titulo_buscable(g["titulo"]) or g["titulo"])
    await _guardar(clave, g["titulo"], g["motivo"], "aplicada", "aceptada a mano", s, len(g["miembros"]), antes)
    revision.quitar(clave)
    logger.info("Revision: sugerencia aceptada «%s» -> %s/%d (%d archivos)", g["titulo"], s["media_type"],
                s["tmdb_id"], len(g["miembros"]))
    return len(g["miembros"])
