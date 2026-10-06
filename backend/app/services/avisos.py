"""Avisar de los episodios nuevos de las series que alguien sigue.

Por que es un vigilante periodico y no un aviso en el momento en que llega el
archivo: cuando `index_live_message()` mete un episodio todavia no se sabe de
que serie es (el emparejamiento con TMDB va en un bucle aparte, segundos o
minutos despues), y sin `tmdb_id` no hay a quien avisar. Mirar cada pocos
minutos lo que se ha indexado *y ya tiene ficha* resuelve las dos cosas.

Tres reglas que evitan el spam, que es la unica forma de que esto acabe
silenciado en los ajustes del telefono:

1. **Solo lo que ha llegado despues de empezar a seguir.** Si sigues "Suits"
   hoy, no te llegan los 134 episodios que ya estaban.
2. **Un aviso por serie y pasada**, aunque lleguen ocho episodios de golpe.
3. **Lo ya avisado no se repite** (tabla `series_avisos`): lo que hace nuevo a
   un episodio no es su fecha, es que esta cuenta todavia no lo sabe.

Y la primera vez que corre no avisa de nada: deja la marca de tiempo y espera.
En un servidor recien indexado "lo nuevo" son 160.000 archivos.
"""
import asyncio
import logging
from datetime import datetime, timedelta

logger = logging.getLogger("tmd")

MARCA = "avisos_episodios_desde"
# Solape: un episodio puede entrar en la tabla antes de tener ficha de TMDB, y
# entonces en su pasada no se ve. Se vuelve a mirar hacia atras unas horas; lo
# que ya se avisara no se repite, asi que el solape no cuesta nada.
SOLAPE_HORAS = 6
# Por mucho que se retrase el emparejamiento, nada mas viejo que esto se
# anuncia como novedad.
MAXIMO_DIAS = 7
# Cuantos episodios se nombran en el texto antes de resumir.
MAX_NOMBRADOS = 3


def etiqueta_episodio(season: int | None, episode: int) -> str:
    """'3x08'. Sin temporada (los animes numerados de corrido) solo el numero."""
    if season:
        return f"{season}x{episode:02d}"
    return f"episodio {episode}"


def texto_aviso(titulo: str, episodios: list[tuple[int | None, int]]) -> tuple[str, str]:
    """El titulo y el cuerpo del aviso.

    Con un episodio se dice cual; con varios, cuantos y los tres primeros. El
    numero va en el titulo porque en el telefono el cuerpo se corta.
    """
    titulo = titulo or "Serie"
    etiquetas = [etiqueta_episodio(s, e) for s, e in episodios]
    if len(etiquetas) == 1:
        return titulo, f"Ya está disponible {etiquetas[0]}"
    nombrados = ", ".join(etiquetas[:MAX_NOMBRADOS])
    if len(etiquetas) > MAX_NOMBRADOS:
        nombrados += f" y {len(etiquetas) - MAX_NOMBRADOS} más"
    return f"{titulo} · {len(etiquetas)} episodios nuevos", f"Ya están {nombrados}"


def ordenar_episodios(episodios: list[tuple[int | None, int]]) -> list[tuple[int | None, int]]:
    return sorted(episodios, key=lambda se: ((se[0] or 0), se[1]))


async def _leer_marca() -> datetime | None:
    from app.database.connection import get_app_settings

    valor = (await get_app_settings()).get(MARCA)
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor)
    except ValueError:
        return None


async def _guardar_marca(cuando: datetime) -> None:
    from app.database.connection import set_app_settings
    await set_app_settings({MARCA: cuando.isoformat()})


async def _ahora_del_servidor() -> datetime:
    """La hora de la base de datos, no la del proceso.

    `indexed_at` y `series_follows.created_at` los pone `NOW()`, y una TIMESTAMP
    sin zona se lee en la zona de la sesion de Postgres. Si el contenedor de la
    base no va en UTC (Europe/Madrid, por ejemplo), una marca calculada aqui en
    UTC quedaria una o dos horas **en el futuro** y no se avisaria nunca de
    nada. Comparando siempre con el mismo reloj eso no puede pasar.
    """
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return datetime.utcnow()
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT NOW()::timestamp")


async def _episodios_llegados(desde: datetime, ids: list[int]) -> list[dict]:
    """Episodios de series seguidas indexados desde `desde`, con su ficha."""
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool or not ids:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mi.tmdb_id, mi.season, mi.episode,
                   MAX(mi.indexed_at) AS visto,
                   tc.title AS tmdb_title, tc.poster, tc.backdrop
            FROM media_items mi
            JOIN tmdb_cache tc ON tc.tmdb_id = mi.tmdb_id AND tc.media_type = 'tv'
            WHERE mi.tmdb_valid IS TRUE AND mi.tmdb_type = 'tv'
              AND mi.episode IS NOT NULL
              AND mi.indexed_at > $1
              AND mi.tmdb_id = ANY($2::int[])
            GROUP BY mi.tmdb_id, mi.season, mi.episode, tc.title, tc.poster, tc.backdrop
            ORDER BY mi.tmdb_id, mi.season, mi.episode
        """, desde, ids)
    return [dict(r) for r in rows]


async def _seguidores(tmdb_id: int) -> list[dict]:
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT user_id, created_at FROM series_follows
            WHERE tmdb_id = $1 AND active
        """, tmdb_id)
    return [dict(r) for r in rows]


async def repasar() -> int:
    """Una pasada. Devuelve cuantos avisos se han mandado."""
    from app.database.follows import followed_series_ids
    from app.database.push import episodios_sin_avisar, marcar_avisado
    from app.services.push import enviar

    ahora = await _ahora_del_servidor()
    marca = await _leer_marca()
    if marca is None:
        # Primera vez: se deja la marca y no se avisa de nada.
        await _guardar_marca(ahora)
        logger.info("Vigilante de episodios: primera pasada, marca puesta en %s", ahora)
        return 0

    ids = await followed_series_ids()
    if not ids:
        await _guardar_marca(ahora)
        return 0

    desde = max(marca - timedelta(hours=SOLAPE_HORAS), ahora - timedelta(days=MAXIMO_DIAS))
    llegados = await _episodios_llegados(desde, ids)
    if not llegados:
        await _guardar_marca(ahora)
        return 0

    # Agrupado por serie: un aviso por serie, no uno por episodio.
    por_serie: dict[int, dict] = {}
    for fila in llegados:
        serie = por_serie.setdefault(fila["tmdb_id"], {
            "titulo": fila["tmdb_title"], "poster": fila["poster"],
            "backdrop": fila["backdrop"], "episodios": [],
        })
        serie["episodios"].append((fila["season"], fila["episode"], fila["visto"]))

    enviados = 0
    for tmdb_id, serie in por_serie.items():
        for seguidor in await _seguidores(tmdb_id):
            desde_cuando = seguidor["created_at"]
            # Lo que ya estaba cuando empezo a seguirla no es novedad para el.
            suyos = [(s, e) for s, e, visto in serie["episodios"]
                     if desde_cuando is None or visto is None or visto > desde_cuando]
            pendientes = ordenar_episodios(
                await episodios_sin_avisar(seguidor["user_id"], tmdb_id, [(s, e) for s, e in suyos]))
            if not pendientes:
                continue
            titulo, cuerpo = texto_aviso(serie["titulo"] or "Serie", pendientes)
            llego = await enviar(seguidor["user_id"], {
                "title": titulo,
                "body": cuerpo,
                "tmdb_id": tmdb_id,
                "kind": "series",
                "poster": serie["poster"],
                "tag": f"serie-{tmdb_id}",
            })
            # Se marca aunque no haya llegado a ningun aparato: si la cuenta no
            # tiene ninguno suscrito, guardar que "ya se intento" evita que el
            # dia que se suscriba le caiga encima todo el historial.
            for s, e in pendientes:
                await marcar_avisado(seguidor["user_id"], tmdb_id, s, e)
            if llego:
                enviados += 1
                logger.info("Aviso: %s -> cuenta %d (%d aparatos)", titulo,
                            seguidor["user_id"], llego)

    await _guardar_marca(ahora)
    return enviados


async def vigilante(minutos: float = 10) -> None:
    """Bucle de fondo. Arranca con un retraso para no competir con el escaneo
    inicial, que es lo que mas trabajo da al arrancar."""
    await asyncio.sleep(90)
    while True:
        try:
            await repasar()
        except Exception as e:
            logger.error("Vigilante de episodios fallo: %s", e)
        await asyncio.sleep(max(minutos, 1) * 60)
