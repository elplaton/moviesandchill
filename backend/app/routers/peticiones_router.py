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

    fechas = ("creada_en", "conseguida_en", "pedida_en", "intento_en")
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

    from app.services.peticiones import MINUTOS_ENTRE_ENVIOS, segundos_para_siguiente

    cuenta = await _cuenta(user)
    hoy = await db.mandadas_hoy(cuenta["id"])
    from app.services.peticiones import ajustes

    return {"peticiones": [_salida(p) for p in await db.de_usuario(cuenta["id"])],
            "quedan_hoy": None if cuenta.get("role") == "admin" else max(0, LIMITE_DIA - hoy),
            # Con la publicacion en pausa no hay hora estimada: sale cuando se reanude.
            "pausadas": (await ajustes()).get("pausadas", False),
            # Para decir "sale en unos 40 min": la del puesto N sale cuando
            # falte esto mas (N - 1) huecos de MINUTOS_ENTRE_ENVIOS.
            "segundos_para_siguiente": await segundos_para_siguiente(),
            "minutos_entre_envios": MINUTOS_ENTRE_ENVIOS}


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
    from app.services.peticiones import AVISO_COLA, MINUTOS_ENTRE_ENVIOS, ajustes, segundos_para_siguiente

    return {"peticiones": [_salida(p) for p in await db.todas()], "ajustes": await ajustes(),
            "cola": {"segundos_para_siguiente": await segundos_para_siguiente(),
                     "pausadas": (await ajustes()).get("pausadas", False),
                     "minutos_entre_envios": MINUTOS_ENTRE_ENVIOS, "aviso_a_partir_de": AVISO_COLA + 1}}


class Mover(BaseModel):
    como: str  # 'arriba', 'abajo' o 'primera'


@router.post("/admin/peticiones/{peticion_id}/mover")
async def mover(peticion_id: int, req: Mover, admin: Annotated[str, Depends(get_current_admin)]):
    from app.database import peticiones as db

    if req.como not in ("arriba", "abajo", "primera"):
        raise HTTPException(400, "Movimiento desconocido")
    return {"ok": await db.mover(peticion_id, req.como)}


@router.post("/admin/peticiones/{peticion_id}/enviar")
async def enviar_ya(peticion_id: int, admin: Annotated[str, Depends(get_current_admin)]):
    """Manda una de la cola sin esperar su turno (cuenta como el envio de esta
    hora). Si Telegram no la deja salir, queda fallida con el motivo."""
    from app.database import peticiones as db
    from app.services.peticiones import PeticionError, enviar_ya as enviar_ya_

    try:
        await enviar_ya_(peticion_id)
    except PeticionError as e:
        raise _fallo(e)
    p = await db.por_id(peticion_id)
    return {"estado": p["estado"] if p else None, "error": p.get("error") if p else None}


@router.post("/admin/peticiones/{peticion_id}/quitar")
async def quitar_de_la_cola(peticion_id: int, admin: Annotated[str, Depends(get_current_admin)]):
    """La saca de la cola sin mandarla."""
    from app.database import peticiones as db
    from app.services.peticiones import avisar_cola

    await db.descartar(peticion_id)
    await avisar_cola()
    return {"ok": True}


@router.post("/admin/peticiones/{peticion_id}/a-la-cola")
async def volver_a_la_cola(peticion_id: int, admin: Annotated[str, Depends(get_current_admin)]):
    """Vuelve a poner al final de la cola una que fallo o se descarto."""
    from app.database import peticiones as db
    from app.services.peticiones import avisar_cola

    p = await db.por_id(peticion_id)
    if not p or p["estado"] not in ("fallida", "descartada"):
        raise HTTPException(409, "Solo se puede volver a encolar una petición fallida o descartada")
    await db.encolar({"tmdb_id": p["tmdb_id"], "media_type": p["media_type"], "titulo": p["titulo"],
                      "year": p.get("year"), "poster": p.get("poster")})
    await avisar_cola()
    return {"ok": True}


@router.get("/admin/peticiones/chats")
async def chats(admin: Annotated[str, Depends(get_current_admin)]):
    from app.services.peticiones import PeticionError, chats as chats_

    try:
        return {"chats": await chats_()}
    except PeticionError as e:
        raise _fallo(e)


@router.get("/admin/peticiones/temas")
async def temas_de(chat_id: int, admin: Annotated[str, Depends(get_current_admin)]):
    from app.services.peticiones import PeticionError, temas

    try:
        return {"temas": await temas(chat_id)}
    except PeticionError as e:
        raise _fallo(e)


class Ajustes(BaseModel):
    chat_id: int | None = None
    chat_nombre: str | None = None
    # Con el chat se manda tambien el tema; 0 o ausente = sin tema (General).
    tema_id: int | None = None
    tema_nombre: str | None = None
    plantilla: str | None = None
    # Pausar o reanudar la publicacion en Telegram (la cola se sigue llenando).
    pausadas: bool | None = None


@router.post("/admin/peticiones/ajustes")
async def guardar_ajustes(req: Ajustes, admin: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import set_app_settings
    from app.services.peticiones import (CLAVE_CHAT_ID, CLAVE_CHAT_NOMBRE, CLAVE_PAUSA, CLAVE_PLANTILLA,
                                         CLAVE_TEMA_ID, CLAVE_TEMA_NOMBRE,
                                         PLANTILLA_POR_DEFECTO, ajustes)

    valores: dict[str, str] = {}
    if req.pausadas is not None:
        valores[CLAVE_PAUSA] = "1" if req.pausadas else "0"
    if req.chat_id is not None:
        valores[CLAVE_CHAT_ID] = str(req.chat_id)
        valores[CLAVE_CHAT_NOMBRE] = (req.chat_nombre or "")[:200]
        # El tema es de ese chat: al cambiar de chat, el de antes ya no vale.
        valores[CLAVE_TEMA_ID] = str(req.tema_id) if req.tema_id else ""
        valores[CLAVE_TEMA_NOMBRE] = (req.tema_nombre or "")[:200] if req.tema_id else ""
    if req.plantilla is not None:
        plantilla = req.plantilla.strip()[:1000]
        if "{titulo}" not in plantilla and "{titulo_original}" not in plantilla:
            raise HTTPException(400, "La plantilla tiene que llevar {titulo}: si no, el mensaje no dice qué se pide")
        valores[CLAVE_PLANTILLA] = plantilla or PLANTILLA_POR_DEFECTO
    await set_app_settings(valores)
    return await ajustes()


class Prueba(BaseModel):
    plantilla: str | None = None


@router.post("/admin/peticiones/probar")
async def probar(req: Prueba, admin: Annotated[str, Depends(get_current_admin)]):
    """Manda el ejemplo a los Mensajes guardados de la cuenta de Telegram."""
    from app.services.peticiones import PeticionError, probar as probar_

    try:
        return {"texto": await probar_(_api_key(), req.plantilla)}
    except PeticionError as e:
        raise _fallo(e)


class Vista(BaseModel):
    plantilla: str


@router.post("/admin/peticiones/vista-previa")
async def vista_previa(req: Vista, admin: Annotated[str, Depends(get_current_admin)]):
    from app.services.peticiones import EJEMPLO, rellenar

    return {"texto": rellenar(req.plantilla, EJEMPLO)}
