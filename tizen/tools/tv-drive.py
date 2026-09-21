#!/usr/bin/env python3
"""
Mando a distancia sobre la app de la television.

Se apoya en el canal de depuracion (deploy.sh --debug): inyecta eventos de
teclado en la app y lee el estado despues de cada paso. Permite recorrer los
menus y comprobar que todo responde sin estar delante del televisor.

    ./tools/tv-drive.py down down right enter
    ./tools/tv-drive.py --show
    ./tools/tv-drive.py --login
    ./tools/tv-drive.py right:5 enter wait:2 --show

Pasos: up down left right enter back, wait:<segundos>, y sufijo :<n> para
repetir (right:5). --show imprime el estado de la pantalla al terminar.
"""
import argparse
import asyncio
import json
import sys

PORT = 9333
DIM, RESET, CYAN, RED = "\033[90m", "\033[0m", "\033[36m", "\033[31m"

KEYS = {
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft",
    "right": "ArrowRight", "enter": "Enter", "back": "XF86Back",
}

# Distribucion del teclado en pantalla (src/components/OnScreenKeyboard.tsx):
# A-Z y 0-9 en una rejilla de 6 columnas.
KB_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
KB_COLUMNS = 6


def kb_path(word: str):
    """Pasos para teclear una palabra en la rejilla, empezando en la A."""
    steps = []
    row, col = 0, 0
    for char in word.upper():
        idx = KB_CHARS.find(char)
        if idx < 0:
            raise ValueError(f"el teclado no tiene la tecla {char!r}")
        target_row, target_col = divmod(idx, KB_COLUMNS)
        steps += ["right"] * (target_col - col) + ["left"] * (col - target_col)
        steps += ["down"] * (target_row - row) + ["up"] * (row - target_row)
        steps.append("enter")
        row, col = target_row, target_col
    return steps

# Resumen de lo que hay en pantalla. Es la "vista" que tengo del televisor:
# no hay captura de imagen, pero si el DOM, la ruta y el foco.
SCREEN_JS = """
(() => {
  const foco = document.querySelector('.is-focused');
  const texto = (el) => (el ? (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 90) : null);
  const filas = [...document.querySelectorAll('h2')].map(h => texto(h)).filter(Boolean);
  const modal = document.querySelector('.fixed.inset-0.z-50');
  const video = document.querySelector('video');
  return JSON.stringify({
    ruta: location.hash || '(raiz)',
    foco: window.__focus ? window.__focus().foco : null,
    focoTexto: texto(foco),
    problemas: window.__focus ? window.__focus().problemas : [],
    titulo: texto(document.querySelector('h1')),
    secciones: filas.slice(0, 12),
    tarjetas: document.querySelectorAll('.mc-card').length,
    modalAbierto: !!modal,
    modalTexto: modal ? texto(modal) : null,
    video: video ? {
      src: (video.currentSrc || video.src || '').slice(0, 80),
      estado: video.readyState, tiempo: +video.currentTime.toFixed(1),
      ancho: video.videoWidth, alto: video.videoHeight,
      error: video.error ? video.error.code : null,
    } : null,
  }, null, 2);
})()
"""

LOGIN_JS = """
(async () => {
  const base = %s;
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: %s, password: %s }),
  });
  if (!r.ok) return 'login fallido: ' + r.status;
  const d = await r.json();
  localStorage.setItem('access_token', d.access_token);
  localStorage.setItem('refresh_token', d.refresh_token);
  location.hash = '#/';
  location.reload();
  return 'sesion iniciada';
})()
"""


def press_js(key: str) -> str:
    return (
        "(() => { const e = new KeyboardEvent('keydown', "
        f"{{ key: {json.dumps(key)}, bubbles: true, cancelable: true }});"
        " window.dispatchEvent(e); return 'ok'; })()"
    )


class Driver:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def evaluate(self, expr, timeout=25):
        self.n += 1
        rid = self.n
        await self.ws.send(json.dumps({"id": rid, "expr": expr}))
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise TimeoutError(f"sin respuesta a la expresion {rid}")
            raw = await asyncio.wait_for(self.ws.recv(), timeout=remaining)
            msg = json.loads(raw)
            if msg.get("type") == "console" and msg.get("level") in ("warn", "error"):
                print(f"{RED}  [{msg['level']}] {msg.get('text')}{RESET}")
            elif msg.get("type") == "error":
                print(f"{RED}  [error] {msg.get('text')}{RESET}")
            if msg.get("type") == "result" and msg.get("id") == rid:
                if msg.get("error"):
                    raise RuntimeError(msg["error"])
                return msg.get("value")

    async def press(self, key):
        await self.evaluate(press_js(KEYS[key]))
        await asyncio.sleep(0.35)   # margen para el frame de navegacion

    async def screen(self):
        return json.loads(await self.evaluate(SCREEN_JS))


async def main():
    ap = argparse.ArgumentParser(description="Mando a distancia sobre la app de la TV")
    ap.add_argument("steps", nargs="*",
                    help="up down left right enter back, wait:N, right:5, type:PALABRA")
    ap.add_argument("--show", action="store_true", help="imprime el estado al terminar")
    ap.add_argument("--login", action="store_true", help="inicia sesion via API")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin")
    ap.add_argument("--backend", default=None, help="por defecto, el de .env.tizen")
    ap.add_argument("--eval", dest="expr")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--timeout", type=float, default=60)
    args = ap.parse_args()

    backend = args.backend
    if backend is None:
        try:
            with open(".env.tizen") as f:
                for line in f:
                    if line.startswith("VITE_API_BASE="):
                        backend = line.split("=", 1)[1].strip()
        except OSError:
            pass

    try:
        import websockets
    except ImportError:
        sys.exit("Falta websockets. Usa: ../venv/bin/python tools/tv-drive.py")

    done = asyncio.Event()

    async def handler(ws):
        d = Driver(ws)
        try:
            if args.login:
                print(f"{CYAN}==> Iniciando sesion como {args.user}{RESET}")
                expr = LOGIN_JS % (json.dumps(backend), json.dumps(args.user),
                                   json.dumps(args.password))
                print("   ", await d.evaluate(expr))
                return  # la app recarga; hay que volver a lanzar el driver

            if args.expr:
                print(await d.evaluate(args.expr))

            for step in args.steps:
                name, _, count = step.partition(":")
                if name == "wait":
                    await asyncio.sleep(float(count or 1))
                    continue
                if name == "type":
                    for k in kb_path(count):
                        await d.press(k)
                    print(f"{DIM}  escrito: {count.upper()}{RESET}")
                    continue
                if name not in KEYS:
                    sys.exit(f"Paso desconocido: {step}")
                for _ in range(int(count or 1)):
                    await d.press(name)
                print(f"{DIM}  {step}{RESET}")

            if args.show or args.steps:
                s = await d.screen()
                print(json.dumps(s, indent=2, ensure_ascii=False))
                for p in s.get("problemas", []):
                    print(f"{RED}  PROBLEMA: {p}{RESET}")
        except Exception as e:
            print(f"{RED}Error: {e}{RESET}")
        finally:
            done.set()

    async with websockets.serve(handler, "0.0.0.0", args.port):
        print(f"{DIM}Esperando a la app en el puerto {args.port}...{RESET}")
        try:
            await asyncio.wait_for(done.wait(), timeout=args.timeout)
        except asyncio.TimeoutError:
            sys.exit("La app no ha conectado. Despliega con ./deploy.sh --debug")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nFin.")
