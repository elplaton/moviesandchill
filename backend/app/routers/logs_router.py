import logging
import subprocess
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_user

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["logs"])


@router.get("/logs")
async def logs(lines: int = 100, user: Annotated[str, Depends(get_current_user)] = None):
    from app.config import load_config
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
        # En Docker no hay systemd: los logs salen por stdout del contenedor.
        return {"logs": [], "count": 0,
                "error": "journalctl no disponible (normal en Docker). "
                         "Usa: docker compose logs -f backend"}
    except Exception as e:
        return {"logs": [], "count": 0, "error": str(e)}
