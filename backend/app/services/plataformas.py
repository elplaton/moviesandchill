"""En que plataforma de pago esta cada titulo del catalogo, y desde cuando hay
algo nuevo en el.

La pestaña "Plataformas" enseña lo mas novedoso de Netflix, HBO Max, Disney+,
Prime Video y Crunchyroll, pero **solo lo que tenemos**: lo que se puede ver o
descargar al pulsarlo. Hacerlo al reves (pedir a TMDB lo ultimo de Netflix y
buscarlo en el catalogo) dejaba filas de tres tarjetas, porque lo mas nuevo de
una plataforma casi nunca esta aun en los canales. Asi que se pregunta por
cada titulo nuestro en que plataformas esta en España (TMDB lo saca de
JustWatch) y se guarda en `tmdb_plataformas`.

Dos detalles:

* **Una serie es nueva por su ultima temporada, no por su estreno.** "The
  Bear" empezo en 2022, pero si la temporada 4 salio el mes pasado es de lo
  mas nuevo de Disney+. Por eso se guarda `ultima_fecha` (el ultimo episodio
  emitido) y por eso entran **todas** las series, no solo las recientes.
* **Las plataformas cambian de catalogo.** Lo que hoy esta en Netflix el mes
  que viene puede no estar, asi que cada titulo se vuelve a mirar pasada una
  semana. Una consulta por titulo, con la ficha y las plataformas en la misma
  (`append_to_response`), y diez a la vez: unos minutos por pasada.
"""
import asyncio
import logging
from datetime import date

logger = logging.getLogger("tmd")

PAIS = "ES"

# Las plataformas de la pestaña, en el orden en que salen. Cada una con todos
# sus ids de TMDB: el plan con anuncios y el canal dentro de Amazon son la
# misma plataforma para quien la mira.
PLATAFORMAS: list[dict] = [
    {"clave": "netflix", "nombre": "Netflix", "ids": [8, 1796]},
    {"clave": "hbo", "nombre": "HBO Max", "ids": [1899, 1825]},
    {"clave": "disney", "nombre": "Disney+", "ids": [337]},
    {"clave": "prime", "nombre": "Prime Video", "ids": [119, 2100]},
    {"clave": "crunchyroll", "nombre": "Crunchyroll", "ids": [283, 1968]},
]
POR_CLAVE = {p["clave"]: p for p in PLATAFORMAS}
# Solo se guardan estas: el resto (Movistar, Filmin, los cuarenta canales de
# Amazon) no lo pinta nadie y engordaria la tabla.
_IDS = {i for p in PLATAFORMAS for i in p["ids"]}

# Peliculas de cuantos años atras se miran. Una pelicula vieja no es novedad en
# ninguna plataforma; una serie si puede serlo, y esas entran todas.
AÑOS_PELICULAS = 5
# Cada cuanto se vuelve a mirar un titulo.
DIAS_VIGENCIA = 7
POR_PASADA = 2500
CONCURRENCIA = 10


async def pendientes(limite: int = POR_PASADA) -> list[tuple[int, str]]:
    """Lo del catalogo que no se ha mirado nunca o hace mas de una semana. Lo
    nunca mirado primero, y dentro de eso lo mas reciente: es lo que antes
    llena las filas."""
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return []
    desde = date.today().year - AÑOS_PELICULAS
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            WITH catalogo AS (
                SELECT DISTINCT mi.tmdb_id, mi.tmdb_type AS media_type
                FROM media_items mi
                WHERE mi.tmdb_id IS NOT NULL AND mi.tmdb_valid IS TRUE
            )
            SELECT c.tmdb_id, c.media_type
            FROM catalogo c
            JOIN tmdb_cache tc ON tc.tmdb_id = c.tmdb_id AND tc.media_type = c.media_type
            LEFT JOIN tmdb_plataformas tp ON tp.tmdb_id = c.tmdb_id AND tp.media_type = c.media_type
            WHERE tc.poster IS NOT NULL
              AND (c.media_type = 'tv' OR tc.year >= $1)
              AND (tp.comprobado_en IS NULL
                   OR tp.comprobado_en < NOW() - make_interval(days => $2))
            ORDER BY (tp.comprobado_en IS NULL) DESC, tc.year DESC NULLS LAST
            LIMIT $3
        """, desde, DIAS_VIGENCIA, limite)
    return [(r["tmdb_id"], r["media_type"]) for r in rows]


def _proveedores(data: dict) -> list[int]:
    """Los de suscripcion en España: `flatrate` y `ads` (el plan con anuncios).
    Alquiler y compra no cuentan: "esta en Prime Video" quiere decir que entra
    en la cuota, no que se puede alquilar alli."""
    pais = ((data.get("watch/providers") or {}).get("results") or {}).get(PAIS) or {}
    ids = {p.get("provider_id") for tipo in ("flatrate", "ads") for p in pais.get(tipo) or []}
    return sorted(i for i in ids if i in _IDS)


def _ultima_fecha(data: dict, media_type: str) -> str | None:
    if media_type == "tv":
        return data.get("last_air_date") or data.get("first_air_date") or None
    return data.get("release_date") or None


async def mirar(api_key: str, tmdb_id: int, media_type: str) -> bool:
    """Pregunta a TMDB por un titulo y guarda lo que diga. Devuelve si se pudo
    preguntar: un titulo sin plataformas se guarda igual (con la lista vacia),
    porque "no esta en ninguna" tambien es una respuesta y no hay que volver a
    preguntarla mañana."""
    from app.database.connection import get_pool
    from app.services.tmdb import _get

    data = await _get(f"/{media_type}/{tmdb_id}",
                      {"api_key": api_key, "language": "es-ES",
                       "append_to_response": "watch/providers"})
    if not data:
        return False
    fecha = _ultima_fecha(data, media_type)
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO tmdb_plataformas (tmdb_id, media_type, proveedores, ultima_fecha, comprobado_en)
            VALUES ($1, $2, $3::int[], $4::date, NOW())
            ON CONFLICT (tmdb_id, media_type) DO UPDATE
               SET proveedores = $3::int[], ultima_fecha = $4::date, comprobado_en = NOW()
        """, tmdb_id, media_type, _proveedores(data),
            date.fromisoformat(fecha) if fecha else None)
    return True


async def rellenar(api_key: str, limite: int = POR_PASADA) -> int:
    if not api_key:
        return 0
    faltan = await pendientes(limite)
    if not faltan:
        return 0
    logger.info("Plataformas: %d titulos por mirar", len(faltan))
    sem = asyncio.Semaphore(CONCURRENCIA)
    hechos = 0

    async def _uno(tmdb_id: int, media_type: str):
        nonlocal hechos
        async with sem:
            try:
                if await mirar(api_key, tmdb_id, media_type):
                    hechos += 1
            except Exception as e:
                logger.warning("Plataformas de %s/%d fallo: %s", media_type, tmdb_id, str(e)[:80])

    await asyncio.gather(*[_uno(i, t) for i, t in faltan], return_exceptions=True)
    logger.info("Plataformas: %d/%d mirados", hechos, len(faltan))
    if hechos:
        # Las filas de la pestaña salen de esta tabla: lo cacheado ya no vale.
        from app.services import cache
        cache.olvidar("plataformas", "fila")
    return hechos


async def relleno_periodico(api_key: str, horas: float = 6) -> None:
    """Al arrancar y cada seis horas. La primera pasada llena lo que falta y
    las siguientes solo repasan lo que tiene mas de una semana, asi que casi
    siempre son unas pocas consultas."""
    await asyncio.sleep(90)
    while True:
        try:
            # Mientras queden pendientes se sigue sin esperar seis horas: la
            # primera vez son varios miles y la pestaña estaria a medias.
            while await rellenar(api_key) >= POR_PASADA:
                await asyncio.sleep(5)
        except Exception as e:
            logger.error("Relleno de plataformas fallo: %s", e)
        await asyncio.sleep(max(horas, 1) * 3600)
