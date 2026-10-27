import logging
import re
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_admin
from app.tasks import spawn

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["channels"])


class AddChannelRequest(BaseModel):
    url: str


@router.get("/channels")
async def channels(user: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import get_active_channels
    db_channels = await get_active_channels()
    if db_channels:
        return {"channels": db_channels}
    from app.routers.download import downloader
    return {"channels": [{"id": ch["id"], "name": ch["name"]} for ch in downloader.channel_ids]}


@router.get("/dialogs")
async def dialogs(user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import downloader
    try:
        dialogs = await downloader.list_dialogs()
    except Exception:
        return {"dialogs": [], "error": "No se pudo conectar a Telegram"}
    from app.database.connection import get_all_channels
    db_all = await get_all_channels()
    configured_ids = {ch["id"] for ch in (db_all or []) if ch.get("active")}
    items = []
    for d in dialogs:
        items.append({
            "id": d["id"], "name": d["name"],
            "is_channel": d["is_channel"], "is_group": d["is_group"],
            "is_megagroup": d.get("is_megagroup", False),
            "active": d["id"] in configured_ids,
        })
    items.sort(key=lambda x: (not x["active"], not x["is_channel"], x["name"].lower()))
    return {"dialogs": items}


@router.post("/channels/add")
async def add_channel_by_url(req: AddChannelRequest, user: Annotated[str, Depends(get_current_admin)]):
    from app.routers.download import downloader, config
    url = req.url.strip()
    if not url:
        return {"error": "URL vacia"}

    # Se prueba cada formato por separado: con un unico regex de dos ramas los
    # grupos no coinciden y consultar group(2) en la rama de @usuario revienta.
    m_private = re.match(r'(?:https?://)?t\.me/c/(\d+)(?:/\d+)?$', url)
    m_numeric = re.match(r'(?:https?://)?t\.me/(-\d+)(?:/\d+)?$', url)
    m_user = re.match(r'(?:https?://)?t\.me/\+?([a-zA-Z][\w]{3,})(?:/\d+)?$', url)

    if url.startswith("@") and len(url) > 4:
        entity_input = url[1:]
    elif m_private:
        entity_input = int(f"-100{m_private.group(1)}")
    elif m_numeric:
        entity_input = int(m_numeric.group(1))
    elif m_user:
        entity_input = m_user.group(1)
    else:
        return {"error": "URL no valida"}

    try:
        entity = await downloader.client.get_entity(entity_input)
        name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Sin nombre"
        ch_id = entity.id
    except Exception as e:
        return {"error": f"No se pudo resolver el canal: {e}"}

    is_new = await downloader.add_channel(ch_id, name)
    try:
        from app.database.connection import upsert_channel
        await upsert_channel(ch_id, name)
    except Exception:
        pass

    logger.info("Canal %s | ID=%d | %s", "anadido" if is_new else "actualizado", ch_id, name)

    if is_new:
        from app.services.indexer import scan_channel
        api_key = config.get("tmdb_api_key", "") if config.get("tmdb_enabled", False) else ""
        total = await downloader.get_total_messages(ch_id)
        spawn(scan_channel(downloader, ch_id, name, api_key=api_key, total_estimate=total),
              f"scan_channel:{ch_id}")

    return {"status": "added" if is_new else "updated", "channel": {"id": ch_id, "name": name}}


# --- Temas de un canal con foro --------------------------------------------------
#
# Un grupo con temas mezcla de todo: "Peliculas" y "Series" junto a "Deportes",
# "Libros" o "APKs". Lo de esos otros temas se indexaba como si fueran
# peliculas (carreras de MotoGP, grabaciones con nombre de fecha) y llenaba el
# catalogo de cosas sin ficha. Aqui se elige que temas no se indexan.

class TemasIgnorados(BaseModel):
    temas: list[int]


async def _contados(channel_id: int) -> dict:
    from app.database.connection import get_pool

    pool = get_pool()
    if not pool:
        return {}
    async with pool.acquire() as conn:
        filas = await conn.fetch("""
            SELECT tema_id, COUNT(*) AS n FROM media_items WHERE channel_id = $1 GROUP BY tema_id
        """, channel_id)
    return {f["tema_id"]: f["n"] for f in filas}


@router.get("/channels/{channel_id}/temas")
async def temas_del_canal(channel_id: int, user: Annotated[str, Depends(get_current_admin)]):
    """Los temas del canal (si es un grupo con foro), con cuantos archivos hay
    indexados de cada uno y si se ignora. `sin_leer` son los archivos de los
    que aun no se sabe el tema: los indexados antes de leer el contexto, hasta
    que la relectura de fondo pase por ellos."""
    from app.database.media import temas_ignorados
    from app.routers.telegram_router import _peer_de
    from app.services.peticiones import PeticionError, temas

    try:
        lista = await temas(_peer_de(channel_id))
    except PeticionError:
        # No es un foro (o no se ha podido leer): no hay temas que elegir.
        return {"foro": False, "temas": [], "sin_leer": 0}
    ignorados = (await temas_ignorados()).get(channel_id, set())
    contados = await _contados(channel_id)
    return {"foro": True, "sin_leer": contados.get(None, 0),
            "temas": [{**t, "ignorado": t["id"] in ignorados, "indexados": contados.get(t["id"], 0)}
                      for t in lista]}


@router.post("/channels/{channel_id}/temas-ignorados")
async def guardar_temas_ignorados(channel_id: int, req: TemasIgnorados,
                                  user: Annotated[str, Depends(get_current_admin)]):
    """Guarda que temas no se indexan. Lo ya indexado de los que pasan a
    ignorarse sale del catalogo; los que dejan de ignorarse se vuelven a
    indexar en segundo plano (solo ese tema, no el canal entero)."""
    from app.database.connection import get_pool
    from app.database.media import borrar_de_temas, temas_ignorados

    antes = (await temas_ignorados()).get(channel_id, set())
    nuevos = set(int(t) for t in req.temas)
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            await conn.execute("UPDATE channels SET temas_ignorados = $2::int[] WHERE channel_id = $1",
                               channel_id, sorted(nuevos))
    quitados = await borrar_de_temas(channel_id, sorted(nuevos - antes))
    vuelven = sorted(antes - nuevos)
    if vuelven:
        from app.routers.download import config, downloader
        from app.services.indexer import reindexar_temas

        api_key = config.get("tmdb_api_key", "") if config and config.get("tmdb_enabled") else ""
        spawn(reindexar_temas(downloader, channel_id, vuelven, api_key), f"reindexar_temas_{channel_id}")
    logger.info("Temas ignorados de %d: %s (%d archivos quitados, %d temas vuelven)",
                channel_id, sorted(nuevos), quitados, len(vuelven))
    return {"ok": True, "quitados": quitados, "reindexando": vuelven}
