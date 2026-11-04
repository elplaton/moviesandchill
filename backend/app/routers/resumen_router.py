"""La portada del panel de administracion: el estado de todo de un vistazo.

Antes, para saber si todo iba bien habia que entrar pestaña por pestaña (si
Telegram estaba conectado, en Telegram; si las peticiones estaban en pausa,
en Peticiones; el disco libre, en Ajustes). Esto lo junta en una respuesta,
con una tarjeta por area y, arriba, los avisos que piden atencion, cada uno
con la seccion del panel a la que lleva.

Cada dato se calcula por separado y lo que falla se queda en None: la
portada tiene que abrir aunque una parte este rota, que es justo cuando mas
se necesita. Y nada pesado: la revision (unos 10 s) solo sale si ya esta
calculada; si no, se calcula en segundo plano para la siguiente visita.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_admin

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Por debajo de esto el disco libre sale como aviso.
DISCO_POCO = 50 * 1024 ** 3


async def _parte(nombre: str, fn):
    try:
        return await fn()
    except Exception as e:
        logger.warning("Resumen del panel: %s fallo: %s", nombre, e)
        return None


async def _telegram() -> dict:
    from app.database.connection import get_active_channels
    from app.routers.download import downloader
    conectado = bool(downloader and downloader.client and downloader.client.is_connected())
    autorizado = bool(conectado and await downloader.client.is_user_authorized())
    return {"conectado": conectado, "autorizado": autorizado,
            "premium": getattr(downloader, "premium", None) if autorizado else None,
            "canales": len(downloader.channels) if downloader else 0,
            "canales_activos": len(await get_active_channels())}


async def _catalogo() -> dict:
    from app.database.index_progress import get_index_progress, get_index_stats
    from app.services import relectura
    s = await get_index_stats()
    progreso = await get_index_progress()
    return {"total": s.get("total", 0), "con_ficha": s.get("with_tmdb", 0),
            "peliculas": s.get("movies", 0), "series": s.get("series", 0),
            "escaneando": sum(1 for p in progreso if p.get("status") == "running"),
            "releyendo": bool(relectura._estado.get("corriendo"))}


async def _revision() -> dict | None:
    from app.services import revision
    from app.tasks import spawn
    grupos = revision._cache.get("grupos")
    if grupos is None:
        spawn(revision.grupos(), "revision_para_el_resumen")
        return None
    return {"archivos": sum(len(g["miembros"]) for gs in grupos.values() for g in gs),
            "grupos": sum(len(gs) for gs in grupos.values()),
            "por_motivo": {m: sum(len(g["miembros"]) for g in gs) for m, gs in grupos.items()}}


async def _descargas() -> dict:
    from app.routers.download import config, downloader
    from app.services.storage import get_free_space
    libre = get_free_space(config["extract_path"])
    return {"activas": len(downloader.active_batches) if downloader else 0, "disco_libre": libre}


async def _peticiones() -> dict:
    from app.database import peticiones as db
    from app.services.peticiones import ajustes
    conf = await ajustes()
    return {"en_cola": await db.cuantas_en_cola(), "pausadas": bool(conf.get("pausadas")),
            "chat": conf.get("chat_nombre") or None}


async def _creditos() -> dict:
    from app.routers.download import config
    from app.services import pasada_creditos
    p = pasada_creditos.estado()
    if p.get("estado") != "en_marcha":
        p = await pasada_creditos.resumen()
    return {"al_ver": bool(config.get("creditos_analizar")),
            "pasada": {k: p.get(k) for k in ("estado", "lanzada", "hechos", "total", "cediendo")}}


async def _comprimidos() -> dict:
    from app.database.connection import get_pool
    async with get_pool().acquire() as conn:
        f = await conn.fetchrow("""
            SELECT COUNT(*) AS revisados, COUNT(*) FILTER (WHERE clase = 'ver') AS ver FROM interior""")
    return dict(f)


async def _usuarios() -> dict:
    from app.database.connection import get_pool
    async with get_pool().acquire() as conn:
        f = await conn.fetchrow("""
            SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE active IS NOT FALSE) AS activos FROM users""")
    return dict(f)


def _avisos(r: dict) -> list[dict]:
    """Lo que pide atencion, de lo mas grave a lo menos. `seccion` es la
    pestaña del panel que lo arregla."""
    avisos = []
    tg = r.get("telegram")
    if tg is not None:
        if not tg["conectado"]:
            avisos.append({"nivel": "error", "seccion": "telegram",
                           "texto": "Telegram no está conectado: no se indexa nada ni se puede ver sin descargar"})
        elif not tg["autorizado"]:
            avisos.append({"nivel": "error", "seccion": "telegram",
                           "texto": "Telegram no tiene sesión iniciada"})
        elif tg["canales"] < tg["canales_activos"]:
            avisos.append({"nivel": "aviso", "seccion": "canales",
                           "texto": f"{tg['canales_activos'] - tg['canales']} de {tg['canales_activos']} canales "
                                    "sin resolver: lo nuevo de esos canales no se ve"})
    d = r.get("descargas")
    if d and d["disco_libre"] < DISCO_POCO:
        avisos.append({"nivel": "aviso", "seccion": "descargas",
                       "texto": f"Queda poco disco: {d['disco_libre'] / 1024 ** 3:.0f} GB libres"})
    p = r.get("peticiones")
    if p and p["pausadas"] and p["en_cola"]:
        avisos.append({"nivel": "aviso", "seccion": "peticiones",
                       "texto": f"La publicación de peticiones está en pausa con {p['en_cola']} en cola"})
    c = (r.get("creditos") or {}).get("pasada") or {}
    if c.get("estado") == "error":
        avisos.append({"nivel": "aviso", "seccion": "creditos",
                       "texto": "La pasada de créditos se ha parado por un error"})
    return avisos


@router.get("/resumen")
async def resumen(user: Annotated[str, Depends(get_current_admin)]):
    import asyncio
    partes = {"telegram": _telegram, "catalogo": _catalogo, "revision": _revision,
              "descargas": _descargas, "peticiones": _peticiones, "creditos": _creditos,
              "comprimidos": _comprimidos, "usuarios": _usuarios}
    valores = await asyncio.gather(*(_parte(n, f) for n, f in partes.items()))
    r = dict(zip(partes, valores))
    r["avisos"] = _avisos(r)
    return r
