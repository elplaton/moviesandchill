import { getAccessToken } from './api';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
type MessageHandler = (data: unknown) => void;
const handlers: Set<MessageHandler> = new Set();

export function connectProgressWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const token = getAccessToken();
  if (!token) return;

  ws = new WebSocket(`${protocol}//${host}/api/ws/progress?token=${encodeURIComponent(token)}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handlers.forEach((h) => h(data));
    } catch {}
  };

  ws.onclose = () => {
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectProgressWs, 5000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function disconnectProgressWs() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  ws = null;
}

export function onProgress(handler: MessageHandler) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}
