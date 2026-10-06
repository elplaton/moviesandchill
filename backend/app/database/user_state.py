"""Estado de la interfaz que es de la cuenta, no del aparato.

Lo ultimo que se busco es el primer inquilino. Vivia en el almacenamiento del
navegador, y eso tiene dos problemas: se queda escrito en un aparato que puede
ser de mas gente, y no sirve de nada en el resto (buscas algo en el movil y en
la tele no esta). Aqui es de la cuenta y se ve desde donde entres.

Es el gemelo por usuario de `app_settings`. Las claves son una lista cerrada a
proposito: esto no es un cajon donde ir metiendo cosas sin pensar, y el valor
va recortado porque lo escribe un cliente.
"""
from app.database.connection import get_pool

# Lo que se admite guardar, y cuanto mide como mucho.
CLAVES = {
    "last_search": 200,
}


async def leer_estado(user_id: int) -> dict[str, str]:
    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT clave, valor FROM user_state WHERE user_id = $1", user_id)
    return {r["clave"]: r["valor"] for r in rows if r["clave"] in CLAVES}


async def guardar_estado(user_id: int, valores: dict[str, str | None]) -> dict[str, str]:
    """Guarda las claves conocidas y devuelve lo que ha quedado. Un valor vacio
    borra la fila: "no hay nada guardado" y "hay un vacio" son lo mismo y no
    merece la pena distinguirlos."""
    pool = get_pool()
    if not pool:
        return {}
    guardado: dict[str, str] = {}
    async with pool.acquire() as conn:
        for clave, tope in CLAVES.items():
            if clave not in valores:
                continue
            valor = (valores.get(clave) or "").strip()[:tope]
            if not valor:
                await conn.execute(
                    "DELETE FROM user_state WHERE user_id = $1 AND clave = $2", user_id, clave)
                continue
            await conn.execute("""
                INSERT INTO user_state (user_id, clave, valor, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (user_id, clave)
                DO UPDATE SET valor = $3, updated_at = NOW()
            """, user_id, clave, valor)
            guardado[clave] = valor
    return guardado
