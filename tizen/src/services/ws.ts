import { getAccessToken } from './api';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
type MessageHandler = (data: unknown) => void;
const handlers: Set<MessageHandler> = new Set();

function wsUrl(): string {
  const origin = import.meta.env.VITE_API_BASE || window.location.origin;
  const protocol = origin.startsWith('https') ? 'wss' : 'ws';
  const host = origin.replace(/^https?:\/\//, '');
  return `${protocol}://${host}/api/ws/progress`;
}

export function connectProgressWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const token = getAccessToken();
  if (!token) return;

  ws = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(token)}`);

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
