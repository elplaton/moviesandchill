"""Peticiones de titulos que no tenemos (ver services/peticiones.py).

Para cualquier cuenta: buscar en TMDB (`/peticiones/buscar`, que dice de cada
resultado si ya lo tenemos o si ya esta pedido), pedir, ver lo pedido y dejar
de esperarlo. Para el admin: elegir el chat de Telegram y la plantilla, y ver
todas las peticiones con quien las espera.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_admin, get_current_user

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["peticiones"])


def _api_key() -> str:
    from app.routers.download import config

    if not config or not config.get("tmdb_enabled"):
        return ""
    return config.get("tmdb_api_key", "") or ""


async def _cuenta(username: str) -> dict:
    from app.database.users import get_user_by_username

    user = await get_user_by_username(username)
    if not user:
        raise HTTPException(401, "Cuenta desconocida")
    return user


def _fallo(e) -> HTTPException:
    return HTTPException(getattr(e, "codigo", 400), str(e))


def _salida(p: dict) -> dict:
    from app.services.peticiones import tipo_cliente

    fechas = ("creada_en", "conseguida_en", "pedida_en")
    return {**{k: v for k, v in p.items() if k not in fechas and k != "media_type"},
            "media_type": tipo_cliente(p["media_type"]),
            **{k: p[k].isoformat() if p.get(k) else None for k in fechas if k in p}}


@router.get("/peticiones/buscar")
async def buscar(q: str, user: Annotated[str, Depends(get_current_user)]):
    """Busca en TMDB y dice, de cada resultado, si ya lo tenemos y si ya esta
    pedido (y si por esta cuenta). Solo peliculas y series."""
    from app.database import peticiones as db
    from app.services.peticiones import tipo_cliente
    from app.services.tmdb import IMAGE_BASE, _get

    q = (q or "").strip()
    api_key = _api_key()
    if len(q) < 2 or not api_key:
        return {"results": []}
    cuenta = await _cuenta(user)
    data = await _get("/search/multi", {"api_key": api_key, "query": q,
                                        "language": "es-ES", "include_adult": "false"})
    crudos = [r for r in (data or {}).get("results", []) if r.get("media_type") in ("movie", "tv")][:20]
    claves = [(r["id"], r["media_type"]) for r in crudos]
    tenemos = await db.en_catalogo(claves)
    pedidas = await db.de_titulos(claves, cuenta["id"])
    out = []
    for r in crudos:
        clave = (r["id"], r["media_type"])
        fecha = r.get("release_date") or r.get("first_air_date") or ""
        pet = pedidas.get(clave)
        out.append({
            "tmdb_id": r["id"],
            "media_type": tipo_cliente(r["media_type"]),
            "title": r.get("title") or r.get("name") or "",
            "original_title": r.get("original_title") or r.get("original_name") or "",
            "year": int(fecha[:4]) if fecha[:4].isdigit() else None,
            "poster": f"{IMAGE_BASE}/w342{r['poster_path']}" if r.get("poster_path") else None,
            "overview": r.get("overview") or "",
            "en_catalogo": clave in tenemos,
            "peticion": {"estado": pet["estado"], "mia": pet["mia"]} if pet else None,
        })
    return {"results": out}


class Pedir(BaseModel):
    tmdb_id: int
    media_type: str


@router.post("/peticiones")
async def pedir(req: Pedir, user: Annotated[str, Depends(get_current_user)]):
    from app.services.peticiones import PeticionError, pedir as pedir_

    cuenta = await _cuenta(user)
    try:
        return await pedir_(cuenta["id"], cuenta.get("role") == "admin",
                            req.tmdb_id, req.media_type, _api_key())
    except PeticionError as e:
        raise _fallo(e)


@router.get("/peticiones")
async def mias(user: Annotated[str, Depends(get_current_user)]):
    from app.database import peticiones as db
    from app.services.peticiones import LIMITE_DIA

    cuenta = await _cuenta(user)
    hoy = await db.mandadas_hoy(cuenta["id"])
    return {"peticiones": [_salida(p) for p in await db.de_usuario(cuenta["id"])],
            "quedan_hoy": None if cuenta.get("role") == "admin" else max(0, LIMITE_DIA - hoy)}


@router.delete("/peticiones/{peticion_id}")
async def dejar(peticion_id: int, user: Annotated[str, Depends(get_current_user)]):
    """Dejar de esperar una peticion. El mensaje de Telegram no se borra: ya
    lo han leido, y puede que alguien mas la espere."""
    from app.database import peticiones as db

    cuenta = await _cuenta(user)
    await db.quitar(peticion_id, cuenta["id"])
    return {"ok": True}


# --- Admin -------------------------------------------------------------------

@router.get("/admin/peticiones")
async def todas(admin: Annotated[str, Depends(get_current_admin)]):
    from app.database import peticiones as db
    from app.services.peticiones import ajustes

    return {"peticiones": [_salida(p) for p in await db.todas()], "ajustes": await ajustes()}


@router.get("/admin/peticiones/chats")
async def chats(admin: Annotated[str, Depends(get_current_admin)]):
    from app.services.peticiones import PeticionError, chats as chats_

    try:
        return {"chats": await chats_()}
    except PeticionError as e:
        raise _fallo(e)


class Ajustes(BaseModel):
    chat_id: int | None = None
    chat_nombre: str | None = None
    plantilla: str | None = None


@router.post("/admin/peticiones/ajustes")
async def guardar_ajustes(req: Ajustes, admin: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import set_app_settings
    from app.services.peticiones import (CLAVE_CHAT_ID, CLAVE_CHAT_NOMBRE, CLAVE_PLANTILLA,
                                         PLANTILLA_POR_DEFECTO, ajustes)

    valores: dict[str, str] = {}
    if req.chat_id is not None:
        valores[CLAVE_CHAT_ID] = str(req.chat_id)
        valores[CLAVE_CHAT_NOMBRE] = (req.chat_nombre or "")[:200]
    if req.plantilla is not None:
        plantilla = req.plantilla.strip()[:1000]
        if "{titulo}" not in plantilla and "{titulo_original}" not in plantilla:
            raise HTTPException(400, "La plantilla tiene que llevar {titulo}: si no, el mensaje no dice qué se pide")
        valores[CLAVE_PLANTILLA] = plantilla or PLANTILLA_POR_DEFECTO
    await set_app_settings(valores)
    return await ajustes()


class Vista(BaseModel):
    plantilla: str


@router.post("/admin/peticiones/vista-previa")
async def vista_previa(req: Vista, admin: Annotated[str, Depends(get_current_admin)]):
    from app.services.peticiones import EJEMPLO, rellenar

    return {"texto": rellenar(req.plantilla, EJEMPLO)}
