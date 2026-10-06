"""Lo que cada cuenta ya ha visto.

Es a nivel de **titulo**, no de archivo: "ya me he visto esta pelicula" vale
aunque no este descargada, y por eso no sirve `playback_progress`, que va por
ruta de disco. `season = 0, episode = 0` es el titulo entero (la pelicula, o la
serie completa); un episodio lleva sus numeros.

Sirve para tres cosas: pintar el visto en la ficha, sacar de "Continuar
viendo" lo que ya se termino, y **mover las recomendaciones**: lo que se ve va
sumando peso a sus generos, asi que la fila cambia poco a poco sin que haya
que volver a pasar por el onboarding.
"""
from app.database.connection import get_pool

# Desde donde se da por visto algo que solo se ha reproducido. Es el mismo
# criterio de "esto le interesa" que usa la fila de recomendados: pasada la
# mitad, ya cuenta como gusto aunque no se haya terminado.
MITAD = 0.5


async def marcar_visto(user_id: int, tmdb_id: int, media_type: str,
                       season: int = 0, episode: int = 0) -> bool:
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO user_watched (user_id, tmdb_id, media_type, season, episode)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING
        """, user_id, tmdb_id, media_type, season or 0, episode or 0)
    return True


async def desmarcar_visto(user_id: int, tmdb_id: int, media_type: str,
                          season: int = 0, episode: int = 0) -> bool:
    """Quitar el visto. Si se quita el del titulo entero se quitan tambien los
    de sus episodios: dejar "serie no vista" con ocho capitulos marcados seria
    un estado que la ficha no sabria pintar."""
    pool = get_pool()
    if not pool:
        return False
    entero = not (season or episode)
    async with pool.acquire() as conn:
        if entero:
            await conn.execute("""
                DELETE FROM user_watched
                WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
            """, user_id, tmdb_id, media_type)
        else:
            await conn.execute("""
                DELETE FROM user_watched
                WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
                  AND season = $4 AND episode = $5
            """, user_id, tmdb_id, media_type, season, episode)
    return True


async def visto_de_titulo(user_id: int, tmdb_id: int, media_type: str) -> dict:
    """Lo que esta cuenta ha visto de un titulo: si esta entero y que episodios."""
    pool = get_pool()
    if not pool:
        return {"whole": False, "episodes": []}
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT season, episode FROM user_watched
            WHERE user_id = $1 AND tmdb_id = $2 AND media_type = $3
        """, user_id, tmdb_id, media_type)
    entero = any(r["season"] == 0 and r["episode"] == 0 for r in rows)
    episodios = [[r["season"], r["episode"]] for r in rows
                 if not (r["season"] == 0 and r["episode"] == 0)]
    return {"whole": entero, "episodes": episodios}


async def titulos_vistos(user_id: int) -> set[tuple[int, str]]:
    """Los titulos marcados **enteros**. Un par de episodios vistos no es una
    serie terminada: sigue interesando que la recomienden."""
    pool = get_pool()
    if not pool:
        return set()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT tmdb_id, media_type FROM user_watched
            WHERE user_id = $1 AND season = 0 AND episode = 0
        """, user_id)
    return {(r["tmdb_id"], r["media_type"]) for r in rows}


async def episodios_vistos(user_id: int, tmdb_id: int) -> set[tuple[int, int]]:
    """Los (temporada, episodio) marcados de una serie. Los usa "Continuar
    viendo" para no ofrecer como siguiente algo que ya se vio."""
    pool = get_pool()
    if not pool:
        return set()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT season, episode FROM user_watched
            WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'tv'
              AND NOT (season = 0 AND episode = 0)
        """, user_id, tmdb_id)
    return {(r["season"], r["episode"]) for r in rows}


async def episodios_vistos_todos(user_id: int) -> dict[int, set[tuple[int, int]]]:
    """Todos los episodios marcados de la cuenta, agrupados por serie. En una
    sola consulta: "Continuar viendo" los necesita para no ofrecer como
    siguiente algo que ya se vio, y preguntar serie a serie serian veinte
    viajes a la base por cada carga de la portada."""
    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT tmdb_id, season, episode FROM user_watched
            WHERE user_id = $1 AND media_type = 'tv'
              AND NOT (season = 0 AND episode = 0)
        """, user_id)
    fuera: dict[int, set[tuple[int, int]]] = {}
    for r in rows:
        fuera.setdefault(r["tmdb_id"], set()).add((r["season"], r["episode"]))
    return fuera


_GUSTOS = f"""
    WITH vistos AS (
        -- Lo marcado a mano (el titulo entero o un episodio cualquiera)...
        SELECT DISTINCT tmdb_id, media_type FROM user_watched WHERE user_id = $1
        UNION
        -- ...y lo que se ha reproducido pasada la mitad, que tambien dice lo
        -- que le gusta a alguien aunque no lo haya terminado.
        -- Multiplicacion y no division: "duration > 0 AND position/duration"
        -- parece seguro, pero Postgres puede evaluar las condiciones en el
        -- orden que quiera y una division por cero es un error, no un NULL.
        SELECT DISTINCT tmdb_id, tmdb_type FROM playback_progress
        WHERE user_id = $1 AND tmdb_id IS NOT NULL AND tmdb_type IS NOT NULL
          AND duration > 0 AND position >= duration * {MITAD}
    )
    SELECT g.genero, COUNT(*)::int AS veces
    FROM vistos v
    JOIN tmdb_cache tc ON tc.tmdb_id = v.tmdb_id AND tc.media_type = v.media_type
    CROSS JOIN LATERAL unnest(tc.genres) AS g(genero)
    GROUP BY g.genero
"""


async def gustos_por_lo_visto(user_id: int) -> dict[str, int]:
    """Cuantos titulos vistos hay de cada genero.

    Misma escala que los pesos del onboarding (que son "de los titulos que
    marque, cuantos eran de este genero"), asi que los dos se suman sin
    normalizar nada: con seis elegidos al entrar y veinte vistos despues, lo
    visto pesa mas, que es justo lo que se quiere.
    """
    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch(_GUSTOS, user_id)
    return {r["genero"]: r["veces"] for r in rows}


def sumar_gustos(*fuentes: dict[str, float] | None) -> dict[str, float]:
    """Suma varios mapas de genero->peso. Es lo que hace que las
    recomendaciones se muevan: el onboarding es el punto de partida y lo visto
    se le va sumando encima."""
    total: dict[str, float] = {}
    for fuente in fuentes:
        for genero, peso in (fuente or {}).items():
            if not genero:
                continue
            total[genero] = total.get(genero, 0) + float(peso or 0)
    return {g: p for g, p in total.items() if p > 0}
