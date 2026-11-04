import logging
import subprocess
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_admin

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["logs"])


@router.get("/logs")
async def logs(lines: int = 100, user: Annotated[str, Depends(get_current_admin)] = None):
    """Las ultimas lineas del log del servidor. Solo para el admin: lleva
    nombres de cuenta, rutas y lo que pide cada uno (antes bastaba con tener
    cuenta). Con systemd, de journalctl; si no (Docker), de lo que el
    servidor guarda en memoria (services/registro.py)."""
    from app.config import load_config
    from app.services import registro
    lines = max(1, min(lines, registro.LINEAS))
    unit = load_config().get("log_unit", "telegram-movie")
    try:
        result = subprocess.run(
            ["journalctl", "-u", unit,
             "-n", str(lines), "--no-pager",
             "-o", "short-iso"],
            capture_output=True, text=True, timeout=5,
        )
        out = result.stdout.strip()
        return {"logs": out.split("\n") if out else [], "count": len(out.split("\n")) if out else 0}
    except FileNotFoundError:
        # En Docker no hay systemd: lo guardado en memoria desde el arranque.
        lineas = registro.ultimas(lines)
        return {"logs": lineas, "count": len(lineas), "desde_memoria": True}
    except Exception as e:
        return {"logs": [], "count": 0, "error": str(e)}
