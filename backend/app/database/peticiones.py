"""Las peticiones de titulos que no tenemos: que se pidio, quien lo espera y
si ya ha llegado. La logica (a donde se manda, con que texto, el limite) vive
en `services/peticiones.py`; aqui solo hay SQL."""
from app.database.connection import get_pool


async def _uno(sql: str, *args) -> dict | None:
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        fila = await conn.fetchrow(sql, *args)
    return dict(fila) if fila else None


async def _varios(sql: str, *args) -> list[dict]:
    pool = get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        return [dict(f) for f in await conn.fetch(sql, *args)]


async def _ejecutar(sql: str, *args) -> None:
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute(sql, *args)


async def de_titulo(tmdb_id: int, media_type: str) -> dict | None:
    return await _uno("SELECT * FROM peticiones WHERE tmdb_id = $1 AND media_type = $2",
                      tmdb_id, media_type)


async def de_titulos(claves: list[tuple[int, str]], user_id: int) -> dict[tuple[int, str], dict]:
    """El estado de varias peticiones a la vez (para pintar el buscador), con
    si esta cuenta es de las que esperan."""
    if not claves:
        return {}
    filas = await _varios("""
        SELECT p.tmdb_id, p.media_type, p.estado,
               EXISTS (SELECT 1 FROM peticiones_usuarios u
                       WHERE u.peticion_id = p.id AND u.user_id = $3) AS mia
        FROM peticiones p
        JOIN unnest($1::int[], $2::text[]) AS c(tmdb_id, media_type)
          ON c.tmdb_id = p.tmdb_id AND c.media_type = p.media_type
    """, [c[0] for c in claves], [c[1] for c in claves], user_id)
    return {(f["tmdb_id"], f["media_type"]): f for f in filas}


async def en_catalogo(claves: list[tuple[int, str]]) -> set[tuple[int, str]]:
    """Que titulos tenemos ya. Cuenta lo `tmdb_valid`, que es lo que sale en
    la portada: un archivo mal emparejado no es "tenerlo"."""
    if not claves:
        return set()
    filas = await _varios("""
        SELECT DISTINCT mi.tmdb_id, mi.tmdb_type
        FROM media_items mi
        JOIN unnest($1::int[], $2::text[]) AS c(tmdb_id, media_type)
          ON c.tmdb_id = mi.tmdb_id AND c.media_type = mi.tmdb_type
        WHERE mi.tmdb_valid IS TRUE
    """, [c[0] for c in claves], [c[1] for c in claves])
    return {(f["tmdb_id"], f["tmdb_type"]) for f in filas}


async def mandadas_hoy(user_id: int) -> int:
    """Cuantas ha mandado esta cuenta en las ultimas 24 horas (las que de
    verdad escribieron en Telegram, no las que se sumaron a otra)."""
    pool = get_pool()
    if not pool:
        return 0
    async with pool.acquire() as conn:
        return await conn.fetchval("""
            SELECT COUNT(*) FROM peticiones_usuarios
            WHERE user_id = $1 AND origen AND creada_en > NOW() - INTERVAL '24 hours'
        """, user_id) or 0


async def guardar_enviada(datos: dict, chat_id: int, chat_nombre: str, mensaje_id: int | None) -> int:
    """La peticion ya salio: se crea, o se reabre si una anterior habia
    fallado. Devuelve su id."""
    fila = await _uno("""
        INSERT INTO peticiones (tmdb_id, media_type, titulo, year, poster, estado,
                                chat_id, chat_nombre, mensaje_id, error, creada_en)
        VALUES ($1, $2, $3, $4, $5, 'enviada', $6, $7, $8, NULL, NOW())
        ON CONFLICT (tmdb_id, media_type) DO UPDATE
           SET titulo = $3, year = $4, poster = $5, estado = 'enviada', chat_id = $6,
               chat_nombre = $7, mensaje_id = $8, error = NULL, creada_en = NOW(),
               conseguida_en = NULL
        RETURNING id
    """, datos["tmdb_id"], datos["media_type"], datos["titulo"], datos.get("year"),
        datos.get("poster"), chat_id, chat_nombre, mensaje_id)
    return fila["id"] if fila else 0


async def guardar_fallida(datos: dict, error: str) -> None:
    """No salio. Se apunta con el motivo (para el panel) pero sin nadie
    esperando: el siguiente que la pida la vuelve a intentar."""
    await _ejecutar("""
        INSERT INTO peticiones (tmdb_id, media_type, titulo, year, poster, estado, error)
        VALUES ($1, $2, $3, $4, $5, 'fallida', $6)
        ON CONFLICT (tmdb_id, media_type) DO UPDATE
           SET estado = 'fallida', error = $6
           WHERE peticiones.estado <> 'enviada'
    """, datos["tmdb_id"], datos["media_type"], datos["titulo"], datos.get("year"),
        datos.get("poster"), error[:500])


async def sumar(peticion_id: int, user_id: int, origen: bool) -> None:
    await _ejecutar("""
        INSERT INTO peticiones_usuarios (peticion_id, user_id, origen)
        VALUES ($1, $2, $3)
        ON CONFLICT (peticion_id, user_id) DO UPDATE SET avisado = FALSE
    """, peticion_id, user_id, origen)


async def quitar(peticion_id: int, user_id: int) -> None:
    await _ejecutar("DELETE FROM peticiones_usuarios WHERE peticion_id = $1 AND user_id = $2",
                    peticion_id, user_id)


async def de_usuario(user_id: int) -> list[dict]:
    return await _varios("""
        SELECT p.id, p.tmdb_id, p.media_type, p.titulo, p.year, p.poster, p.estado,
               p.creada_en, p.conseguida_en, u.creada_en AS pedida_en, u.origen
        FROM peticiones_usuarios u
        JOIN peticiones p ON p.id = u.peticion_id
        WHERE u.user_id = $1
        ORDER BY (p.estado = 'enviada') DESC, COALESCE(p.conseguida_en, u.creada_en) DESC
        LIMIT 200
    """, user_id)


async def todas(limite: int = 300) -> list[dict]:
    """Para el panel: todas, con quien las espera."""
    return await _varios("""
        SELECT p.*,
               COALESCE(array_agg(us.username ORDER BY u.creada_en)
                        FILTER (WHERE us.username IS NOT NULL), '{}') AS usuarios
        FROM peticiones p
        LEFT JOIN peticiones_usuarios u ON u.peticion_id = p.id
        LEFT JOIN users us ON us.id = u.user_id
        GROUP BY p.id
        ORDER BY (p.estado = 'enviada') DESC, p.creada_en DESC
        LIMIT $1
    """, limite)


async def llegadas() -> list[dict]:
    """Las pedidas que ya estan en el catalogo, con quien falta por avisar."""
    return await _varios("""
        SELECT p.id, p.tmdb_id, p.media_type, p.titulo, p.poster,
               COALESCE(array_agg(u.user_id) FILTER (WHERE NOT u.avisado), '{}') AS por_avisar
        FROM peticiones p
        LEFT JOIN peticiones_usuarios u ON u.peticion_id = p.id
        WHERE p.estado = 'enviada'
          AND EXISTS (SELECT 1 FROM media_items mi
                      WHERE mi.tmdb_id = p.tmdb_id AND mi.tmdb_type = p.media_type
                        AND mi.tmdb_valid IS TRUE)
        GROUP BY p.id
    """)


async def marcar_conseguida(peticion_id: int) -> None:
    await _ejecutar("UPDATE peticiones SET estado = 'conseguida', conseguida_en = NOW() WHERE id = $1",
                    peticion_id)


async def marcar_avisado(peticion_id: int, user_id: int) -> None:
    await _ejecutar("UPDATE peticiones_usuarios SET avisado = TRUE WHERE peticion_id = $1 AND user_id = $2",
                    peticion_id, user_id)
