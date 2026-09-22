"""Panel de administracion: cuentas, cuotas y descargas de todo el mundo.

Solo lo usan la web de escritorio y la PWA de movil; la tele no lo ve.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_admin
from app.tasks import spawn

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api/admin", tags=["admin"])

GB = 1024 ** 3


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "user"
    quota_gb: float | None = None


class UpdateUserRequest(BaseModel):
    role: str | None = None
    quota_gb: float | None = None
    unlimited: bool | None = None
    active: bool | None = None
    password: str | None = None


def _user_out(u: dict) -> dict:
    return {
        "id": u["id"], "username": u["username"], "role": u["role"], "active": u.get("active", True),
        "quota_bytes": u.get("quota_bytes"), "used_bytes": int(u.get("used_bytes") or 0),
        "downloads": int(u.get("downloads") or 0), "created_at": str(u.get("created_at") or ""),
    }


@router.get("/users")
async def users(admin: Annotated[str, Depends(get_current_admin)]):
    from app.database.connection import list_users
    return {"users": [_user_out(u) for u in await list_users()]}


@router.post("/users")
async def create(req: CreateUserRequest, admin: Annotated[str, Depends(get_current_admin)]):
    from app.auth.service import hash_password
    from app.database.connection import create_user, get_user_by_username
    name = req.username.strip()
    if not name or len(name) > 100:
        raise HTTPException(status_code=400, detail="Nombre de usuario no válido")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="La contraseña es demasiado corta")
    if req.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Rol no válido")
    if await get_user_by_username(name):
        raise HTTPException(status_code=409, detail="Ese usuario ya existe")
    quota = int(req.quota_gb * GB) if req.quota_gb is not None and req.quota_gb > 0 else None
    user_id = await create_user(name, hash_password(req.password), role=req.role, quota_bytes=quota)
    logger.info("Cuenta creada | %s (rol=%s, cuota=%s) por %s", name, req.role, quota, admin)
    return {"status": "created", "id": user_id}


@router.patch("/users/{user_id}")
async def update(user_id: int, req: UpdateUserRequest, admin: Annotated[str, Depends(get_current_admin)]):
    from app.auth.service import hash_password
    from app.database.connection import get_user_by_id, get_user_by_username, update_user
    target = await get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    me = await get_user_by_username(admin)
    fields: dict = {}
    if req.role is not None:
        if req.role not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="Rol no válido")
        if me and me["id"] == user_id and req.role != "admin":
            raise HTTPException(status_code=400, detail="No puedes quitarte el rol de administrador a ti mismo")
        fields["role"] = req.role
    if req.unlimited:
        fields["quota_bytes"] = None
    elif req.quota_gb is not None:
        fields["quota_bytes"] = int(req.quota_gb * GB) if req.quota_gb > 0 else None
    if req.active is not None:
        if me and me["id"] == user_id and not req.active:
            raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta")
        fields["active"] = req.active
    if req.password:
        if len(req.password) < 4:
            raise HTTPException(status_code=400, detail="La contraseña es demasiado corta")
        fields["password_hash"] = hash_password(req.password)
    await update_user(user_id, **fields)
    logger.info("Cuenta %s actualizada por %s: %s", target["username"], admin, list(fields.keys()))
    return {"status": "updated"}


@router.delete("/users/{user_id}")
async def remove(user_id: int, admin: Annotated[str, Depends(get_current_admin)]):
    """Borra la cuenta; sus descargas pasan al admin que la borra."""
    from app.database.connection import get_user_by_id, get_user_by_username, delete_user
    from app.database.downloads import reassign_downloads
    target = await get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    me = await get_user_by_username(admin)
    if me and me["id"] == user_id:
        raise HTTPException(status_code=400, detail="No puedes borrar tu propia cuenta")
    if me:
        await reassign_downloads(user_id, me["id"])
    await delete_user(user_id)
    logger.info("Cuenta %s borrada por %s", target["username"], admin)
    return {"status": "deleted"}


@router.get("/downloads")
async def downloads(admin: Annotated[str, Depends(get_current_admin)]):
    from app.database.downloads import list_downloads
    rows = await list_downloads()
    return {"downloads": [{
        "id": r["id"], "folder_name": r["folder_name"], "folder_path": r["folder_path"], "base_name": r["base_name"],
        "size_bytes": int(r["size_bytes"] or 0), "status": r["status"], "owner": r["owner"], "owner_id": r["owner_id"],
        "created_at": str(r["created_at"]),
    } for r in rows]}


@router.post("/convert-library")
async def convert_library(admin: Annotated[str, Depends(get_current_admin)]):
    """Reempaqueta a MP4 (H.264/AAC) todo lo que haya en disco en otro
    contenedor, para que se reproduzca tambien en iPhone."""
    from app.services.compat import convert_library_job, library_conversion_status
    if library_conversion_status()["running"]:
        return {"status": "already_running"}
    from app.routers.download import config
    spawn(convert_library_job(config["extract_path"]), "convertir_biblioteca")
    return {"status": "started"}


@router.get("/convert-library")
async def convert_library_status(admin: Annotated[str, Depends(get_current_admin)]):
    from app.services.compat import library_conversion_status
    return library_conversion_status()
