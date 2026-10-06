"""Las filas de la portada: novedades, lo añadido, y un carril por genero.

Dos decisiones gobiernan este archivo:

1. **Las novedades se miran por fecha, no por año.** Ordenar por `year` dejaba
   la fila congelada: con 2026 entero empatado, el desempate (votos, nota) es
   el mismo en cada visita y salian siempre las mismas veinte peliculas. Ahora
   cuenta el dia del estreno (`tmdb_cache.release_date`) y el muestreo es
   aleatorio ponderado, asi que la fila rota en cada visita pero siempre con lo
   mas reciente. En el frontal no se escribe el mes en ningun sitio: la fecha
   es para ordenar, no para mostrarse.

2. **Los carriles de genero se paginan.** Antes se cogia una muestra de 400
   titulos en Python y se cortaba a 20 por genero: el resto del catalogo no
   existia. Ahora el orden lo decide una clave *determinista* (un hash del
   titulo mezclado con la semilla de la sesion, ponderado hacia lo reciente),
   de modo que la pagina 2 continua donde acabo la 1 aunque sean dos
   peticiones distintas, y cada sesion ve el carril en otro orden.
"""
from datetime import date

from app.database.connection import get_pool

# Un titulo por (tmdb_id, tipo) con los datos del primer archivo y el recuento
# de episodios distintos (no de archivos: un pack de 8 partes de una temporada
# contaba como 8 episodios). Solo entran los archivos cuyo tipo detectado
# coincide con el de TMDB (tmdb_valid): asi una pelicula mal emparejada con
# una serie no aparece en la fila de series con "1 episodios".
_TITULOS = """
    titles AS (
        SELECT mi.tmdb_id, mi.tmdb_type,
               MIN(mi.id) AS id,
               MIN(mi.channel_id) AS channel_id,
               MIN(mi.channel_name) AS channel_name,
               MIN(mi.message_id) AS message_id,
               MIN(mi.clean_title) AS clean_title,
               MAX(mi.indexed_at) AS last_indexed,
               COUNT(DISTINCT CASE WHEN mi.episode IS NOT NULL
                                   THEN COALESCE(mi.season, 0) * 1000 + mi.episode
                                   ELSE -COALESCE(mi.season, 0) END) AS episode_count,
               COUNT(*) AS file_count
        FROM media_items mi
        WHERE mi.tmdb_id IS NOT NULL AND mi.tmdb_valid IS TRUE
        GROUP BY mi.tmdb_id, mi.tmdb_type
    )
"""

# La ficha de cada titulo. `fecha` es el estreno: la de TMDB si la tenemos y,
# mientras el relleno no haya pasado por ese titulo, el 1 de enero de su año
# (que es exactamente la precision que habia antes).
_FICHAS = """
    fichas AS (
        SELECT t.id, t.tmdb_id, t.channel_id, t.channel_name, t.message_id,
               t.clean_title, t.last_indexed, t.episode_count, t.file_count,
               tc.media_type AS tmdb_type,
               tc.title AS tmdb_title, tc.year, tc.rating, tc.poster, tc.backdrop,
               tc.overview, tc.genres, tc.vote_count,
               COALESCE(tc.release_date,
                        make_date(GREATEST(COALESCE(tc.year, 2000), 1000), 1, 1)) AS fecha
        FROM titles t
        JOIN tmdb_cache tc ON tc.tmdb_id = t.tmdb_id AND tc.media_type = t.tmdb_type
        WHERE tc.poster IS NOT NULL
    )
"""

# Peso por antiguedad en años, para el muestreo de la portada (Efraimidis-
# Spirakis: clave = RANDOM()^(1/peso)). Un titulo de 2026 pesa ~8 veces mas
# que uno de 2008 o anterior; antes era RANDOM() puro sobre 7.500 titulos y la
# Home salia llena de clasicos.
_PESO_AÑO = "(1 + GREATEST(COALESCE(year, 2000) - 2008, 0) * 0.4)"

# Peso por antiguedad en dias, para las novedades. De 31 (estrenada hoy) a 1
# (al borde de la ventana), asi que lo de esta semana sale casi siempre y lo
# del año pasado de vez en cuando.
def _peso_dias(ventana: int) -> str:
    return (f"(1 + 30 * (1 - GREATEST(LEAST(CURRENT_DATE - fecha, {ventana}), 0)::numeric / {ventana}))")


def _filtro_tipo(media_type: str | None) -> str:
    if media_type in ("movie", "tv"):
        return f" AND tmdb_type = '{media_type}'"
    return ""


def _consulta(*trozos: str) -> str:
    return "WITH " + ",".join([_TITULOS, _FICHAS]) + " " + " ".join(trozos)


async def _filas(sql: str, *args) -> list[dict]:
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        return [dict(r) for r in await conn.fetch(sql, *args)]


# ---------------------------------------------------------------------------
# Portada
# ---------------------------------------------------------------------------

async def get_browse_pool(tmdb_type: str, limit: int = 300) -> list[dict]:
    """Muestra aleatoria ponderada hacia lo reciente. La usa "Recomendado para
    ti", que puntua en Python y por eso necesita un monton de candidatos."""
    return await _filas(_consulta(f"""
        SELECT * FROM fichas
        WHERE tmdb_type = $1
        ORDER BY RANDOM() ^ (1.0 / {_PESO_AÑO}) DESC
        LIMIT $2
    """), tmdb_type, limit)


async def get_estrenos(limit: int = 20, media_type: str | None = None,
                        meses: int = 24, semilla: str = "", offset: int = 0) -> tuple[list[dict], int]:
    """La fila "Novedades": lo estrenado hace poco, rotando y paginado.

    Se llama `get_estrenos` y no `get_novedades` porque eso ya existe en
    `connection.py` para el registro de lo que llega en vivo a los canales, que
    es otra cosa: aqui son estrenos de TMDB, alli ficheros de Telegram.

    El orden es el mismo muestreo ponderado de siempre, pero con la clave
    **determinista** de la semilla en vez de RANDOM(): con RANDOM() la pagina 2
    no continuaba a la 1, repetia titulos y se saltaba otros. La semilla cambia
    en cada visita, asi que la fila sigue rotando.

    Se admite algo de futuro (45 dias) porque TMDB fecha el estreno en cines y
    aqui puede llegar antes; mas alla de eso un "estreno de 2028" es un
    emparejamiento erroneo y no cuenta.
    """
    ventana = meses * 31
    sql = _consulta(f"""
        , recientes AS (
            SELECT f.*, {_clave("$1", _peso_dias(ventana))} AS clave
            FROM fichas f
            WHERE f.fecha BETWEEN CURRENT_DATE - INTERVAL '{meses} months'
                               AND CURRENT_DATE + INTERVAL '45 days'
              {_filtro_tipo(media_type)}
        )
    """, *_pagina("recientes", "clave DESC, tmdb_id", "$2", "$3"))
    filas = await _filas(sql, semilla, offset, limit)
    total = filas[0]["total"] if filas else 0
    if offset > 0 or len(filas) >= limit:
        return filas, total

    # La ventana da poco: pasa mientras el relleno de fechas no ha llegado a
    # todo. Se completa con el criterio de antes, por año, solo en la primera
    # pagina; `total` se queda en lo que hay en la ventana, asi que el cliente
    # no pide una pagina 2 que no existe.
    vistos = {(f["tmdb_id"], f["tmdb_type"]) for f in filas}
    for extra in await get_recent_releases(limit, max_year=date.today().year,
                                           media_type=media_type):
        if (extra["tmdb_id"], extra["tmdb_type"]) not in vistos:
            filas.append(extra)
            if len(filas) >= limit:
                break
    return filas, total


async def get_recent_releases(limit: int = 20, min_year: int = 0, max_year: int = 9999,
                              media_type: str | None = None) -> list[dict]:
    """Lo mas nuevo por año, sin aleatoriedad. Es el respaldo de get_estrenos
    y lo que se usaba antes de que hubiera fecha de estreno."""
    return await _filas(_consulta(f"""
        SELECT * FROM fichas
        WHERE year BETWEEN $1 AND $2 {_filtro_tipo(media_type)}
        ORDER BY year DESC, COALESCE(vote_count, 50) DESC, rating DESC NULLS LAST
        LIMIT $3
    """), min_year, max_year, limit)


async def get_recently_added(limit: int = 20, media_type: str | None = None,
                             offset: int = 0) -> tuple[list[dict], int]:
    """Lo ultimo que ha entrado. Aqui el orden ya era reproducible (la fecha de
    indexado no depende del azar), asi que paginar es solo contar y cortar."""
    sql = _consulta(f"""
        , entradas AS (
            SELECT f.* FROM fichas f WHERE TRUE {_filtro_tipo(media_type)}
        )
    """, *_pagina("entradas", "last_indexed DESC, id DESC", "$1", "$2"))
    filas = await _filas(sql, offset, limit)
    return filas, (filas[0]["total"] if filas else 0)


async def get_recomendados(semilla: str, gustos: dict[str, float], liked_years: list[int],
                           offset: int = 0, limit: int = 20,
                           media_type: str | None = None) -> tuple[list[dict], int]:
    """"Recomendado para ti", puntuado en la base y paginado.

    Antes se puntuaba en Python sobre una muestra aleatoria de 800 titulos, lo
    que tenia dos problemas: la fila se acababa a las veinte tarjetas y, peor,
    las "mejores recomendaciones" eran las mejores **de una muestra al azar**.
    Aqui se puntua el catalogo entero: los puntos son la suma de los pesos de
    los generos que gustan, mas un empujon por acercarse a los años marcados en
    el onboarding y otro a lo reciente. El desempate es la clave determinista
    de la semilla, asi que el orden rota por sesion pero la pagina 2 continua a
    la 1.

    Los pesos van como dos arrays en paralelo (genero y peso) y no como JSON:
    asi el filtro es un `= ANY(...)` contra el array de generos del titulo.
    """
    generos = list(gustos.keys())
    pesos = [float(v) for v in gustos.values()]
    corte_reciente = date.today().year - 2
    sql = _consulta(f"""
        , gustos AS (
            SELECT g.genero, g.peso FROM unnest($2::text[], $3::float8[]) AS g(genero, peso)
        ),
        puntuado AS (
            SELECT f.*,
                   COALESCE((SELECT SUM(g.peso) FROM gustos g WHERE g.genero = ANY(f.genres)), 0)
                   -- Cercania a lo que marco en el onboarding. Un año nulo no
                   -- entra en ninguna condicion y se queda en 0, no en NULL.
                   + COALESCE((SELECT MAX(CASE WHEN abs(f.year - ly) <= 3 THEN 3
                                               WHEN abs(f.year - ly) <= 8 THEN 1
                                               ELSE 0 END)
                               FROM unnest($4::int[]) AS ly), 0)
                   + CASE WHEN f.year >= $5::int THEN 2 ELSE 0 END AS puntos
            FROM fichas f
            WHERE TRUE {_filtro_tipo(media_type)}
        ),
        elegidos AS (
            SELECT p.*, {_clave("$1")} AS clave
            FROM puntuado p
            WHERE p.puntos >= 2
        )
    """, *_pagina("elegidos", "puntos DESC, clave DESC, tmdb_id", "$6", "$7"))
    filas = await _filas(sql, semilla, generos, pesos, liked_years or [],
                         corte_reciente, offset, limit)
    return filas, (filas[0]["total"] if filas else 0)


# ---------------------------------------------------------------------------
# Carriles de genero, paginados
# ---------------------------------------------------------------------------

# Clave de orden determinista: un uniforme(0,1) sacado del hash del titulo y de
# la semilla, elevado a 1/peso. Es el mismo muestreo ponderado de la portada,
# pero reproducible: con la misma semilla, la pagina 3 sigue donde acabo la 2.
# El hash va de 48 bits (12 digitos hex) porque bit(48)::bigint siempre es
# positivo; con bit(32) Postgres devuelve enteros con signo y la mitad de las
# claves salian negativas, que es tanto como ordenar al azar sin ponderar.
_CLAVE = """
    (
        ('x' || substr(md5($SEMILLA$::text || tmdb_id::text || tmdb_type), 1, 12))::bit(48)::bigint::numeric
        / 281474976710655.0
    ) ^ (1.0 / _PESO_)
"""


def _clave(param: str, peso: str | None = None) -> str:
    return _CLAVE.replace("$SEMILLA$", param).replace("_PESO_", peso or _PESO_AÑO)


# Numera y cuenta sobre un conjunto ya ordenado por `clave`. Es el mismo molde
# para novedades, añadidos y recomendados: lo unico que cambia es de donde
# salen las filas y con que se desempata.
_PAGINADO = """,
    clasificado AS (
        SELECT c.*,
               COUNT(*) OVER () AS total,
               ROW_NUMBER() OVER (ORDER BY {orden}) AS pos
        FROM {origen} c
    )
"""


def _pagina(origen: str, orden: str, p_offset: str, p_limit: str) -> list[str]:
    """Los dos ultimos trozos de una consulta paginada."""
    return [
        _PAGINADO.format(origen=origen, orden=orden),
        f"SELECT * FROM clasificado WHERE pos > {p_offset}::int "
        f"AND pos <= {p_offset}::int + {p_limit}::int ORDER BY pos",
    ]


# Empieza por coma: son dos CTE que se añaden a las de `_consulta()`. Sin ella
# Postgres ve "fichas AS (...) desplegado AS (...)" y no hay consulta.
_POR_GENERO = """,
    desplegado AS (
        SELECT f.*, g.genero, {clave} AS clave
        FROM fichas f, unnest(f.genres) AS g(genero)
        WHERE TRUE {filtro} {solo}
    ),
    clasificado AS (
        SELECT d.*,
               COUNT(*) OVER (PARTITION BY genero) AS total,
               ROW_NUMBER() OVER (PARTITION BY genero ORDER BY clave DESC, tmdb_id) AS pos
        FROM desplegado d
    )
"""


async def get_genre_rows(semilla: str, por_fila: int = 20, media_type: str | None = None,
                         max_filas: int = 14) -> list[dict]:
    """La primera pagina de cada carril de genero, en una sola consulta.

    Una consulta por genero serian quince viajes a la base por cada carga de
    la portada, y la parte cara es la misma en todas (agrupar media_items).
    """
    sql = _consulta(_POR_GENERO.format(clave=_clave("$1"), filtro=_filtro_tipo(media_type), solo=""),
                    "SELECT * FROM clasificado WHERE pos <= $2::int ORDER BY total DESC, genero, pos")
    filas = await _filas(sql, semilla, por_fila)

    carriles: dict[str, dict] = {}
    for fila in filas:
        carril = carriles.setdefault(fila["genero"], {"genre": fila["genero"],
                                                      "total": fila["total"], "items": []})
        carril["items"].append(fila)
    return list(carriles.values())[:max_filas]


async def get_genre_page(semilla: str, genero: str, offset: int = 0, limit: int = 20,
                         media_type: str | None = None) -> tuple[list[dict], int]:
    """Una pagina concreta de un genero. El genero se filtra antes de numerar:
    asi Postgres no tiene que ordenar los otros catorce para nada."""
    sql = _consulta(
        _POR_GENERO.format(clave=_clave("$1"), filtro=_filtro_tipo(media_type),
                           solo="AND g.genero = $2"),
        "SELECT * FROM clasificado WHERE pos > $3::int AND pos <= $3::int + $4::int ORDER BY pos")
    filas = await _filas(sql, semilla, genero, offset, limit)
    total = filas[0]["total"] if filas else 0
    return filas, total


# Compatibilidad con el codigo que aun llama a las funciones antiguas.
async def get_browse_movies(limit: int = 300):
    return await get_browse_pool("movie", limit)


async def get_browse_series(limit: int = 300):
    return await get_browse_pool("tv", limit)
