/**
 * Consola remota de la app.
 *
 * Esta television bloquea `sdb shell`, y sin el no se puede arrancar la app en
 * modo depuracion ni abrir el inspector web de Tizen. Asi que el canal se monta
 * al reves: la app se conecta a un servidor en el equipo de desarrollo y le
 * manda lo que pasa por consola.
 *
 * Solo existe si VITE_DEBUG_HOST esta definido al compilar, cosa que unicamente
 * hace `deploy.sh --debug`. En una compilacion normal la condicion es
 * constante-falsa y Vite elimina todo este modulo del paquete, incluida la
 * evaluacion de expresiones.
 */
const HOST = import.meta.env.VITE_DEBUG_HOST as string | undefined;

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
const MAX_QUEUE = 300;

function serialise(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`;
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      if (typeof v === 'function') return `[function ${v.name || 'anonima'}]`;
      return v;
    });
  } catch {
    return String(value);
  }
}

export function startRemoteConsole(): void {
  if (!HOST) return;

  let socket: WebSocket | null = null;
  const pending: string[] = [];

  const send = (payload: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: Date.now(), ...payload });
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(line);
    } else {
      pending.push(line);
      if (pending.length > MAX_QUEUE) pending.shift();
    }
  };

  const connect = () => {
    try {
      socket = new WebSocket(HOST);
    } catch {
      setTimeout(connect, 3000);
      return;
    }

    socket.onopen = () => {
      send({ type: 'hello', url: location.href, ua: navigator.userAgent });
      while (pending.length && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(pending.shift()!);
      }
    };

    socket.onclose = () => {
      socket = null;
      setTimeout(connect, 3000);
    };

    socket.onmessage = (event) => {
      let request: { id?: number; expr?: string };
      try {
        request = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!request.expr) return;
      try {
        // eslint-disable-next-line no-eval
        const value = (0, eval)(request.expr);
        Promise.resolve(value).then(
          (v) => send({ type: 'result', id: request.id, value: serialise(v) }),
          (e) => send({ type: 'result', id: request.id, error: serialise(e) }),
        );
      } catch (e) {
        send({ type: 'result', id: request.id, error: serialise(e) });
      }
    };
  };

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      send({ type: 'console', level, text: args.map(serialise).join(' ') });
      original(...args);
    };
  }

  window.addEventListener('error', (e) => {
    send({
      type: 'error',
      text: `${e.message} (${e.filename}:${e.lineno}:${e.colno})`,
      stack: e.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    send({ type: 'error', text: `Promesa sin capturar: ${serialise(e.reason)}` });
  });

  connect();
}
