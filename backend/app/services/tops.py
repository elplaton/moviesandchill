"""Los tops: lo mas visto (o lo que mas interes genera) en cada plataforma en
España, como la fila "Top 10" de Netflix. Se saca una foto al dia y se
guarda en `tops`, asi que queda historico.

De donde sale cada uno, y por que:

* **Netflix: su top 10 oficial de España.** Netflix publica cada semana, por
  pais, un archivo con sus diez peliculas y diez series mas vistas
  (`all-weeks-countries.tsv` de Tudum). Son sus datos de visualizaciones, lo
  mas fiable que hay, aunque sean diez y semanales. Los titulos vienen en
  ingles y sin id, asi que se emparejan con TMDB buscando por nombre y
  quedandose con el resultado que este en Netflix en España.
* **El resto: las tendencias de la semana de TMDB** filtradas por lo que esta
  en esa plataforma en España. Ninguna otra publica su top (solo lo enseñan
  dentro de la app, con sesion), y FlixPatrol, que lo recoge, esta detras de
  una proteccion anti-bots y su API es de pago. Se probo antes la popularidad
  de TMDB a secas y no sirve: acumula, y el top de Disney+ salia lleno de
  series eternas ("Anatomia de Grey") en vez de lo que se esta viendo ahora.
* **Entra lo que no tenemos**, con un boton para pedirlo: el top es el de
  verdad, no "lo mejor de lo nuestro".
"""
import asyncio
import csv
import io
import logging
from datetime import date

logger = logging.getLogger("tmd")

NETFLIX_TSV = "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv"
PAIS_NETFLIX = "Spain"
TOP = 15
# Paginas de tendencias que se miran (20 titulos cada una). Con 15 sale un
# top lleno incluso en las plataformas pequeñas (Filmin, Atresplayer).
PAGINAS_TENDENCIA = 15
AMBITO_TODAS = "todas"
HORAS_ENTRE_FOTOS = 24


def _item(r: dict, tipo: str) -> dict:
    """Lo que se guarda de cada titulo del top: lo justo para pintarlo aunque
    no lo tengamos (entonces no hay ficha en el catalogo de donde sacarlo)."""
    from app.services.tmdb import IMAGE_BASE

    fecha = r.get("release_date") or r.get("first_air_date") or ""
    return {
        "titulo": r.get("title") or r.get("name") or "",
        "poster": f"{IMAGE_BASE}/w342{r['poster_path']}" if r.get("poster_path") else None,
        "backdrop": f"{IMAGE_BASE}/w780{r['backdrop_path']}" if r.get("backdrop_path") else None,
        "year": int(fecha[:4]) if fecha[:4].isdigit() else None,
        "rating": r.get("vote_average"),
        "overview": r.get("overview") or "",
    }


async def _proveedores(api_key: str, claves: list[tuple[int, str]]) -> dict[tuple[int, str], set[int]]:
    """Las plataformas de cada titulo. Lo mirado hace menos de una semana se
    lee de `tmdb_plataformas`; lo demas se mira ahora (y queda guardado)."""
    from app.database.connection import get_pool
    from app.services.plataformas import CONCURRENCIA, DIAS_VIGENCIA, mirar

    pool = get_pool()
    if not pool or not claves:
        return {}
    async with pool.acquire() as conn:
        filas = await conn.fetch("""
            SELECT tp.tmdb_id, tp.media_type, tp.proveedores
            FROM tmdb_plataformas tp
            JOIN unnest($1::int[], $2::text[]) AS c(tmdb_id, media_type)
              ON c.tmdb_id = tp.tmdb_id AND c.media_type = tp.media_type
            WHERE tp.comprobado_en > NOW() - make_interval(days => $3)
        """, [c[0] for c in claves], [c[1] for c in claves], DIAS_VIGENCIA)
    out = {(f["tmdb_id"], f["media_type"]): set(f["proveedores"]) for f in filas}
    faltan = [c for c in claves if c not in out]
    sem = asyncio.Semaphore(CONCURRENCIA)

    async def _uno(tmdb_id: int, tipo: str):
        async with sem:
            try:
                await mirar(api_key, tmdb_id, tipo)
            except Exception as e:
                logger.debug("Plataformas de %s/%d: %s", tipo, tmdb_id, e)

    await asyncio.gather(*[_uno(i, t) for i, t in faltan])
    if faltan:
        async with pool.acquire() as conn:
            filas = await conn.fetch("""
                SELECT tp.tmdb_id, tp.media_type, tp.proveedores
                FROM tmdb_plataformas tp
                JOIN unnest($1::int[], $2::text[]) AS c(tmdb_id, media_type)
                  ON c.tmdb_id = tp.tmdb_id AND c.media_type = tp.media_type
            """, [c[0] for c in faltan], [c[1] for c in faltan])
        out.update({(f["tmdb_id"], f["media_type"]): set(f["proveedores"]) for f in filas})
    return out


async def _tendencias(api_key: str, tipo: str) -> list[dict]:
    """Las tendencias de la semana en TMDB, en orden, sin repetir."""
    from app.services.tmdb import _get

    vistos, out = set(), []
    for pagina in range(1, PAGINAS_TENDENCIA + 1):
        data = await _get(f"/trending/{tipo}/week", {"api_key": api_key, "language": "es-ES",
                                                     "page": pagina})
        for r in (data or {}).get("results", []):
            if r.get("id") and r["id"] not in vistos and not r.get("adult"):
                vistos.add(r["id"])
                out.append(r)
    return out


# Para completar las listas cortas: lo mas popular *reciente* de la propia
# plataforma. Las tendencias son mundiales y en una plataforma pequeña
# (Filmin, Atresplayer) apenas salen dos o tres titulos; con la popularidad a
# secas volverian las series eternas, asi que se limita a lo reciente.
MESES_PELICULA = 12
MESES_SERIE = 24


async def _relleno(api_key: str, ids: set[int], tipo: str, ya: set[int], faltan: int) -> list[dict]:
    from datetime import timedelta

    from app.services.tmdb import _get

    hoy = date.today()
    params = {"api_key": api_key, "language": "es-ES", "watch_region": "ES",
              "with_watch_providers": "|".join(str(i) for i in sorted(ids)),
              "with_watch_monetization_types": "flatrate|ads", "sort_by": "popularity.desc",
              "include_adult": "false"}
    if tipo == "movie":
        params["primary_release_date.gte"] = (hoy - timedelta(days=MESES_PELICULA * 31)).isoformat()
        params["primary_release_date.lte"] = hoy.isoformat()
    else:
        params["first_air_date.gte"] = (hoy - timedelta(days=MESES_SERIE * 31)).isoformat()
        params["first_air_date.lte"] = hoy.isoformat()
    out = []
    for pagina in (1, 2):
        data = await _get(f"/discover/{tipo}", {**params, "page": pagina})
        for r in (data or {}).get("results", []):
            if r.get("id") and r["id"] not in ya:
                ya.add(r["id"])
                out.append({"tmdb_id": r["id"], **_item(r, tipo)})
                if len(out) >= faltan:
                    return out
        if not (data or {}).get("results"):
            break
    return out


async def _bajar_netflix() -> tuple[str | None, list[dict]]:
    """La ultima semana publicada para España y sus filas, sin emparejar.
    (None, []) si no se puede bajar o leer."""
    import aiohttp

    texto = None
    # Son unos 30 MB y a veces el primer intento se corta: uno mas, con pausa.
    for intento in (1, 2):
        try:
            async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (MoviesAndChill)"}) as s:
                async with s.get(NETFLIX_TSV, timeout=aiohttp.ClientTimeout(total=300)) as resp:
                    if resp.status != 200:
                        logger.warning("Top de Netflix: el archivo contesto %d", resp.status)
                        return None, []
                    texto = await resp.text()
                    break
        except Exception as e:
            # Un TimeoutError no trae mensaje: sin el tipo, el log diria solo
            # "no se pudo bajar:" y nada mas.
            logger.warning("Top de Netflix: no se pudo bajar (intento %d): %s %s",
                           intento, type(e).__name__, e)
            if intento == 1:
                await asyncio.sleep(30)
    if texto is None:
        return None, []
    filas = [f for f in csv.DictReader(io.StringIO(texto), delimiter="\t")
             if f.get("country_name") == PAIS_NETFLIX]
    if not filas:
        return None, []
    semana = max(f["week"] for f in filas)
    return semana, sorted((f for f in filas if f["week"] == semana), key=lambda f: int(f["weekly_rank"]))


async def _netflix_oficial(api_key: str, semana_guardada: str | None = None
                           ) -> tuple[str | None, dict[str, list[dict]]]:
    """El top 10 oficial de Netflix en España de la ultima semana publicada,
    ya emparejado con TMDB: (semana, {"movie": [...], "tv": [...]}). Si la
    semana no es mas nueva que `semana_guardada` no se empareja nada (es lo
    caro) y se devuelve vacio. Vacio tambien si no se puede bajar o leer."""
    semana, filas = await _bajar_netflix()
    if not semana or (semana_guardada and semana <= semana_guardada):
        return semana, {}
    out: dict[str, list[dict]] = {"movie": [], "tv": []}
    for f in filas:
        tipo = "movie" if f["category"] == "Films" else "tv"
        r, tipo_real = await _emparejar_netflix(api_key, f["show_title"], tipo)
        if r:
            item = {"tmdb_id": r["id"], "semana": semana, **_item(r, tipo_real)}
            if tipo_real != tipo:
                # Netflix y TMDB no siempre coinciden en que es serie y que
                # pelicula ("Instadocs" es serie para Netflix y peliculas en
                # TMDB): el puesto es de la lista de Netflix, pero la ficha y
                # el "Pedir" tienen que usar el tipo de TMDB.
                item["tipo"] = tipo_real
        else:
            # Sin pareja: se enseña igual con su nombre, sin caratula. Un top
            # de Netflix con un hueco no se parece al de Netflix.
            logger.info("Top de Netflix: sin pareja en TMDB para «%s»", f["show_title"])
            item = {"tmdb_id": 0, "semana": semana, "titulo": f["show_title"], "poster": None,
                    "backdrop": None, "year": None, "rating": None, "overview": ""}
        temporada = (f.get("season_title") or "").split(": ")[-1]
        if tipo == "tv" and temporada and temporada != "N/A":
            item["subtitulo"] = (temporada.replace("Season", "Temporada")
                                 .replace("Limited Series", "Miniserie"))
        out[tipo].append(item)
    logger.info("Top de Netflix (semana del %s): %d peliculas, %d series",
                semana, len(out["movie"]), len(out["tv"]))
    return semana, out


async def _emparejar_netflix(api_key: str, titulo: str, tipo: str) -> tuple[dict | None, str]:
    """El resultado de TMDB que corresponde a un titulo del top de Netflix: de
    los primeros, el que este en Netflix en España; si ninguno, el primero.
    Si buscando con su tipo no sale nada, se busca en todo TMDB: hay titulos
    que Netflix cuenta como serie y TMDB como pelicula. Devuelve tambien el
    tipo que tiene en TMDB."""
    from app.services.plataformas import POR_CLAVE
    from app.services.tmdb import _get

    data = await _get(f"/search/{tipo}", {"api_key": api_key, "query": titulo,
                                          "language": "es-ES", "include_adult": "false"})
    candidatos = [(c, tipo) for c in (data or {}).get("results", [])[:5]]
    if not candidatos:
        data = await _get("/search/multi", {"api_key": api_key, "query": titulo,
                                            "language": "es-ES", "include_adult": "false"})
        candidatos = [(c, c["media_type"]) for c in (data or {}).get("results", [])
                      if c.get("media_type") in ("movie", "tv")][:5]
    if not candidatos:
        return None, tipo
    netflix = set(POR_CLAVE["netflix"]["ids"])
    prov = await _proveedores(api_key, [(c["id"], t) for c, t in candidatos])

    def exacto(c: dict) -> bool:
        buscado = titulo.strip().lower()
        return any((c.get(k) or "").strip().lower() == buscado
                   for k in ("title", "original_title", "name", "original_name"))

    def en_netflix(c: dict, t: str) -> bool:
        return bool(prov.get((c["id"], t), set()) & netflix)

    def año(c: dict) -> str:
        return (c.get("release_date") or c.get("first_air_date") or "")[:4]

    # Primero lo que se llama exactamente asi; entre eso, lo que esta en
    # Netflix y, si no, lo mas reciente (el top es de estrenos). Solo sin
    # ninguno exacto vale "lo primero que este en Netflix": con eso a secas,
    # "The Storm" se emparejaba con "La tormenta perfecta" (2000) porque esa
    # si esta en Netflix y la nueva aun no tenia plataformas en TMDB.
    exactos = [(c, t) for c, t in candidatos if exacto(c)]
    if exactos:
        return max(exactos, key=lambda ct: (en_netflix(*ct), año(ct[0])))
    for c, t in candidatos:
        if en_netflix(c, t):
            return c, t
    return candidatos[0]


async def foto(api_key: str) -> int:
    """Saca la foto de hoy de todos los tops y la guarda. Devuelve cuantas
    listas se han guardado."""
    from app.services.plataformas import PLATAFORMAS

    if not api_key:
        return 0
    listas: dict[tuple[str, str], tuple[str, list[dict]]] = {}
    for tipo in ("movie", "tv"):
        tendencia = await _tendencias(api_key, tipo)
        prov = await _proveedores(api_key, [(r["id"], tipo) for r in tendencia])
        todas = {i for p in PLATAFORMAS for i in p["ids"]}
        for ambito, ids in [(AMBITO_TODAS, todas)] + [(p["clave"], set(p["ids"])) for p in PLATAFORMAS]:
            elegidos = [{"tmdb_id": r["id"], **_item(r, tipo)} for r in tendencia
                        if prov.get((r["id"], tipo), set()) & ids][:TOP]
            if len(elegidos) < TOP:
                elegidos += await _relleno(api_key, ids, tipo, {e["tmdb_id"] for e in elegidos},
                                           TOP - len(elegidos))
            listas[(ambito, tipo)] = ("tmdb", elegidos)

    _, oficial = await _netflix_oficial(api_key)
    for tipo, items in oficial.items():
        if items:
            listas[("netflix", tipo)] = ("netflix", items)

    guardadas = 0
    for (ambito, tipo), (fuente, items) in listas.items():
        if items:
            await _guardar(ambito, tipo, fuente, items)
            guardadas += 1
    logger.info("Tops: %d listas guardadas", guardadas)
    if guardadas:
        from app.services import cache
        cache.olvidar("plataformas", "portada")
    return guardadas


async def _guardar(ambito: str, tipo: str, fuente: str, items: list[dict]) -> None:
    import json

    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM tops WHERE fecha = CURRENT_DATE AND ambito = $1 AND media_type = $2",
                               ambito, tipo)
            await conn.executemany("""
                INSERT INTO tops (fecha, ambito, media_type, puesto, tmdb_id, fuente, datos)
                VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6::jsonb)
            """, [(ambito, tipo, n, it["tmdb_id"], fuente,
                   json.dumps({k: v for k, v in it.items() if k != "tmdb_id"}, ensure_ascii=False))
                  for n, it in enumerate(items, start=1)])


async def ultimo(ambito: str, tipo: str) -> tuple[str | None, str, list[dict]]:
    """La ultima foto de un top: (fecha, fuente, items en orden)."""
    import json

    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return None, "", []
    async with pool.acquire() as conn:
        filas = await conn.fetch("""
            SELECT fecha, puesto, tmdb_id, fuente, datos FROM tops
            WHERE ambito = $1 AND media_type = $2
              AND fecha = (SELECT MAX(fecha) FROM tops WHERE ambito = $1 AND media_type = $2)
            ORDER BY puesto
        """, ambito, tipo)
    if not filas:
        return None, "", []
    items = [{"tmdb_id": f["tmdb_id"], "puesto": f["puesto"],
              **(json.loads(f["datos"]) if isinstance(f["datos"], str) else (f["datos"] or {}))}
             for f in filas]
    return filas[0]["fecha"].isoformat(), filas[0]["fuente"], items


async def _semana_guardada() -> str | None:
    """La semana de Netflix que tiene la ultima foto."""
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        return await conn.fetchval("""
            SELECT MAX(datos->>'semana') FROM tops
            WHERE ambito = 'netflix' AND fuente = 'netflix'
              AND fecha = (SELECT MAX(fecha) FROM tops WHERE ambito = 'netflix')
        """)


async def actualizar_netflix(api_key: str) -> bool:
    """Si Netflix ha publicado una semana nueva, la pone ya en la foto de hoy
    sin esperar a la de mañana. Devuelve si habia semana nueva."""
    semana, oficial = await _netflix_oficial(api_key, await _semana_guardada())
    if not any(oficial.values()):
        return False
    for tipo, items in oficial.items():
        if items:
            await _guardar("netflix", tipo, "netflix", items)
    from app.services import cache
    cache.olvidar("plataformas", "portada")
    logger.info("Top de Netflix: semana nueva (%s) puesta en la foto de hoy", semana)
    return True


# Netflix publica la semana los martes (a lo largo del dia, hora de EEUU):
# martes y miercoles se mira cada tantas horas hasta que aparezca. El archivo
# pesa unos 30 MB, asi que el resto de la semana basta con la foto diaria.
DIAS_DE_PUBLICACION = (1, 2)  # martes y miercoles (lunes = 0)
HORAS_ENTRE_MIRADAS = 3


async def hay_foto_de_hoy() -> bool:
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return True
    async with pool.acquire() as conn:
        return bool(await conn.fetchval("SELECT 1 FROM tops WHERE fecha = CURRENT_DATE LIMIT 1"))


async def fotografo(api_key: str) -> None:
    """Una foto al dia. Mira cada hora si la de hoy ya esta: asi un reinicio
    no la repite y un servidor que estuvo apagado la saca al volver."""
    import time

    await asyncio.sleep(150)
    ultima_mirada = time.time()
    while True:
        try:
            if not await hay_foto_de_hoy():
                await foto(api_key)
                ultima_mirada = time.time()
            elif (date.today().weekday() in DIAS_DE_PUBLICACION
                  and time.time() - ultima_mirada > HORAS_ENTRE_MIRADAS * 3600):
                ultima_mirada = time.time()
                await actualizar_netflix(api_key)
        except Exception as e:
            logger.error("Tops: la foto del dia fallo: %s", e)
        await asyncio.sleep(3600)
