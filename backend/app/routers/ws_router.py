from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api", tags=["ws"])

active_ws: list[WebSocket] = []


@router.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    await websocket.accept()
    active_ws.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_ws:
            active_ws.remove(websocket)


async def broadcast_progress(data):
    disconnected = []
    for ws in active_ws:
        try:
            await ws.send_json(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in active_ws:
            active_ws.remove(ws)


async def _broadcast_index(data):
    await broadcast_progress(data)
