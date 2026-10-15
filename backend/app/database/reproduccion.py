"""Tabla `reproduccion`: si un archivo de Telegram se puede ver sin
descargarlo, y como (ver services/reproduccion.py).

Se guarda porque averiguarlo cuesta leer de Telegram y pasar ffprobe, y la
respuesta no cambia: un mensaje no cambia de contenido. Lo que si puede
cambiar (Telegram desconectado, una parte que aun no esta indexada) no llega
aqui.
"""
import json

from app.database.connection import get_pool


async def leer(channel_id: int, message_id: int) -> dict | None:
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        datos = await conn.fetchval(
            "SELECT datos FROM reproduccion WHERE channel_id = $1 AND message_id = $2",
            channel_id, message_id)
    if datos is None:
        return None
    return json.loads(datos) if isinstance(datos, str) else datos


async def guardar(channel_id: int, message_id: int, datos: dict) -> None:
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO reproduccion (channel_id, message_id, modo, datos, comprobado_en)
            VALUES ($1, $2, $3, $4::jsonb, NOW())
            ON CONFLICT (channel_id, message_id)
            DO UPDATE SET modo = $3, datos = $4::jsonb, comprobado_en = NOW()
        """, channel_id, message_id, datos.get("modo", ""), json.dumps(datos, ensure_ascii=False))
