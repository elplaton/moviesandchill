"""Tablas `creditos` y `creditos_enlace`: donde empiezan los creditos.

La logica (de donde sale el dato, como se predice para un enlace sin medir)
esta en services/creditos.py; aqui solo se lee y se escribe.

Las fuentes tienen prioridad: lo puesto a mano manda sobre los capitulos del
archivo, y los capitulos sobre lo que diga el analisis de la imagen. Una
escritura de una fuente mas floja no pisa a una mas fuerte (`_PESO`).
"""
from app.database.connection import get_pool

# Lo que se sabe con mas certeza pesa mas.
_PESO = "(CASE {} WHEN 'manual' THEN 3 WHEN 'capitulos' THEN 2 WHEN 'imagen' THEN 1 ELSE 0 END)"


async def guardar_enlace(ruta: str, *, inicio: float | None, duracion: float | None, estado: str,
                         fuente: str, tmdb_id: int | None = None, tmdb_type: str | None = None,
                         temporada: int | None = None, postcreditos: bool = False,
                         version: int = 1) -> bool:
    """Lo medido en un archivo. Devuelve False si no se escribio porque ya
    habia un dato de una fuente mas fiable."""
    pool = get_pool()
    if not pool:
        return False
    async with pool.acquire() as conn:
        r = await conn.fetchval(f"""
            INSERT INTO creditos_enlace (ruta, tmdb_id, tmdb_type, temporada, inicio, duracion,
                                         estado, fuente, postcreditos, version, actualizado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (ruta) DO UPDATE SET
                tmdb_id = COALESCE(EXCLUDED.tmdb_id, creditos_enlace.tmdb_id),
                tmdb_type = COALESCE(EXCLUDED.tmdb_type, creditos_enlace.tmdb_type),
                temporada = COALESCE(EXCLUDED.temporada, creditos_enlace.temporada),
                inicio = EXCLUDED.inicio, duracion = EXCLUDED.duracion,
                estado = EXCLUDED.estado, fuente = EXCLUDED.fuente,
                postcreditos = EXCLUDED.postcreditos, version = EXCLUDED.version,
                actualizado = NOW()
            WHERE {_PESO.format('EXCLUDED.fuente')} >= {_PESO.format('creditos_enlace.fuente')}
            RETURNING 1
        """, ruta, tmdb_id, tmdb_type, temporada, inicio, duracion, estado, fuente, postcreditos, version)
        return r is not None


async def guardar_referencia(tmdb_id: int, tmdb_type: str, temporada: int, *, antes_del_final: float,
                             fuente: str, ruta: str | None, duracion: float | None,
                             postcreditos: bool = False, solo_si_no_hay: bool = False) -> bool:
    """La referencia de un titulo o una temporada. Con `solo_si_no_hay` no
    toca una que ya exista (para la de la serie entera, que la pone el
    primer episodio medido y no el ultimo)."""
    pool = get_pool()
    if not pool:
        return False
    conflicto = ("DO NOTHING" if solo_si_no_hay else f"""DO UPDATE SET
                antes_del_final = EXCLUDED.antes_del_final, postcreditos = EXCLUDED.postcreditos,
                fuente = EXCLUDED.fuente, ruta = EXCLUDED.ruta, duracion = EXCLUDED.duracion,
                actualizado = NOW()
            WHERE {_PESO.format('EXCLUDED.fuente')} >= {_PESO.format('creditos.fuente')}""")
    async with pool.acquire() as conn:
        r = await conn.fetchval(f"""
            INSERT INTO creditos (tmdb_id, tmdb_type, temporada, antes_del_final, postcreditos,
                                  fuente, ruta, duracion, actualizado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (tmdb_id, tmdb_type, temporada) {conflicto}
            RETURNING 1
        """, tmdb_id, tmdb_type, temporada, antes_del_final, postcreditos, fuente, ruta, duracion)
        return r is not None


async def enlace(ruta: str) -> dict | None:
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM creditos_enlace WHERE ruta = $1", ruta)
        return dict(r) if r else None


async def referencia(tmdb_id: int, tmdb_type: str, temporada: int) -> dict | None:
    """La de esa temporada y, si no hay, la de la serie entera (temporada 0)."""
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        r = await conn.fetchrow("""
            SELECT * FROM creditos
            WHERE tmdb_id = $1 AND tmdb_type = $2 AND temporada IN ($3, 0)
            ORDER BY (temporada = $3) DESC LIMIT 1
        """, tmdb_id, tmdb_type, temporada)
        return dict(r) if r else None


async def titulo_de_mensaje(channel_id: int, message_id: int) -> dict | None:
    """Titulo y temporada de un archivo del catalogo (solo con ficha valida)."""
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        r = await conn.fetchrow("""
            SELECT tmdb_id, tmdb_type, season FROM media_items
            WHERE channel_id = $1 AND message_id = $2 AND tmdb_valid IS TRUE AND tmdb_id IS NOT NULL
            LIMIT 1
        """, channel_id, message_id)
        return dict(r) if r else None


async def enlaces_de_titulo(tmdb_id: int, tmdb_type: str) -> list[dict]:
    """Los archivos del catalogo de un titulo (solo con ficha valida)."""
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT channel_id, channel_name, message_id, file_name, file_size, season, episode
            FROM media_items
            WHERE tmdb_id = $1 AND tmdb_type = $2 AND tmdb_valid IS TRUE
        """, tmdb_id, tmdb_type)
        return [dict(r) for r in rows]


async def proceso(tmdb_id: int, tmdb_type: str, temporada: int) -> dict | None:
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        r = await conn.fetchrow("""
            SELECT *, EXTRACT(EPOCH FROM (NOW() - intentado)) AS hace
            FROM creditos_proceso WHERE tmdb_id = $1 AND tmdb_type = $2 AND temporada = $3
        """, tmdb_id, tmdb_type, temporada)
        return dict(r) if r else None


async def marcar_proceso(tmdb_id: int, tmdb_type: str, temporada: int, estado: str,
                         detalle: str = "") -> None:
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO creditos_proceso (tmdb_id, tmdb_type, temporada, estado, detalle, intentado)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (tmdb_id, tmdb_type, temporada) DO UPDATE SET
                estado = EXCLUDED.estado, detalle = EXCLUDED.detalle, intentado = NOW()
        """, tmdb_id, tmdb_type, temporada, estado, detalle[:500])


async def rehacer_tras_cambiar_detector() -> tuple[int, int]:
    """Lo que hay que volver a medir porque ha cambiado el detector de imagen
    (analisis_creditos.VERSION): las referencias de peliculas sacadas de la
    imagen y, de peliculas y temporadas, lo que se quedo sin resultado. Se
    borra su fila de `creditos_proceso` y la pasada lo vuelve a coger. Lo que
    salio de capitulos o se puso a mano no se toca, ni lo que no se pudo
    analizar (eso no depende del detector). Las referencias de temporadas
    medidas se quedan: son la mediana de tres episodios con tarjetas sueltas,
    que el detector ya reconocia. Devuelve (referencias, procesos) borrados."""
    pool = get_pool()
    if not pool:
        return 0, 0
    async with pool.acquire() as conn, conn.transaction():
        refs = await conn.fetch("""
            DELETE FROM creditos WHERE tmdb_type = 'movie' AND fuente = 'imagen' RETURNING tmdb_id""")
        procs = await conn.fetch("""
            DELETE FROM creditos_proceso p
            WHERE p.estado = 'sin_resultado'
               OR (p.tmdb_type = 'movie' AND p.estado = 'hecho' AND NOT EXISTS (
                       SELECT 1 FROM creditos c
                       WHERE c.tmdb_id = p.tmdb_id AND c.tmdb_type = 'movie' AND c.temporada = 0))
            RETURNING tmdb_id""")
        return len(refs), len(procs)


async def resumen() -> dict:
    """Cifras para el panel: cuanto se sabe y de donde ha salido."""
    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        titulos = await conn.fetch(
            "SELECT tmdb_type, fuente, COUNT(*) AS n FROM creditos GROUP BY 1, 2 ORDER BY 1, 2")
        enlaces = await conn.fetch(
            "SELECT estado, fuente, COUNT(*) AS n FROM creditos_enlace GROUP BY 1, 2 ORDER BY 1, 2")
        procesos = await conn.fetch(
            "SELECT tmdb_type, estado, COUNT(*) AS n FROM creditos_proceso GROUP BY 1, 2 ORDER BY 1, 2")
        return {"titulos": [dict(r) for r in titulos], "enlaces": [dict(r) for r in enlaces],
                "procesos": [dict(r) for r in procesos]}
