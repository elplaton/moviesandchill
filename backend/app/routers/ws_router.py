import logging
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.auth.dependencies import get_current_user_ws

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["ws"])

active_ws: list[WebSocket] = []


@router.websocket("/ws/progress")
async def ws_progress(
    websocket: WebSocket,
    user: Annotated[str | None, Depends(get_current_user_ws)] = None,
):
    # Sin esta comprobacion cualquiera que alcance el puerto podia suscribirse al
    # progreso y ver nombres de fichero y rutas del servidor.
    if not user:
        await websocket.close(code=1008, reason="Token invalido o ausente")
        return

    await websocket.accept()
    active_ws.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("WebSocket cerrado inesperadamente: %s", e)
    finally:
        if websocket in active_ws:
            active_ws.remove(websocket)


async def broadcast_progress(data):
    disconnected = []
    # Se itera sobre una copia: hay awaits dentro del bucle y una conexion nueva
    # o cerrada mientras tanto alteraria la lista original.
    for ws in list(active_ws):
        try:
            await ws.send_json(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in active_ws:
            active_ws.remove(ws)


async def _broadcast_index(data):
    await broadcast_progress(data)
