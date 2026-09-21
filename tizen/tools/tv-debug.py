#!/usr/bin/env python3
"""
Puente con el inspector web de la TV.

Tizen expone el mismo protocolo de depuracion que Chrome (CDP), asi que se
puede leer la consola y evaluar expresiones sin abrir un navegador. Da
visibilidad real de lo que pasa en la television: errores de JavaScript,
console.log, peticiones fallidas y el estado del motor de foco.

    ./tools/tv-debug.py                      lanza y sigue la consola
    ./tools/tv-debug.py --eval "location.href"
    ./tools/tv-debug.py --eval "__focus()"   estado del arbol de foco
    ./tools/tv-debug.py --attach             sin relanzar la app

Necesita el paquete `websockets`, que ya esta en el venv del backend:
    ../venv/bin/python tools/tv-debug.py
"""
import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import urllib.request

SDB = os.path.expanduser("~/tizen-studio/tools/sdb")
TIZEN = os.path.expanduser("~/tizen-studio/tools/ide/bin/tizen")
APP_ID = "MCchill026.MoviesChill"
LOCAL_PORT = 9222

COLORS = {
    "error": "\033[31m", "warning": "\033[33m", "info": "\033[36m",
    "log": "", "debug": "\033[90m",
}
RESET = "\033[0m"


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def sdb(serial, *args):
    return run([SDB, "-s", serial, *args])


def ensure_connected(tv_ip):
    serial = f"{tv_ip}:26101"
    run([SDB, "connect", serial])
    if serial not in run([SDB, "devices"]).stdout:
        sys.exit(
            f"No hay conexion con {serial}.\n"
            "Si la TV esta en reposo el puerto 26101 esta cerrado: enciendela.\n"
            "Si esta encendida, revisa Modo Desarrollador y la IP del PC host."
        )
    return serial


def launch_debug(serial):
    """Arranca la app en modo depuracion y devuelve el puerto del inspector."""
    out = sdb(serial, "shell", "0", "debug", APP_ID).stdout
    match = re.search(r"port:\s*(\d+)", out)
    if not match:
        sys.exit(
            "No he podido arrancar la app en modo depuracion.\n"
            f"Respuesta de la TV: {out.strip() or '(vacia)'}\n"
            "En algunos modelos hay que activar tambien 'Web Inspector' o\n"
            "reinstalar la app con el perfil de desarrollo."
        )
    return int(match.group(1))


def forward(serial, remote_port):
    run([SDB, "-s", serial, "forward", "--remove", f"tcp:{LOCAL_PORT}"])
    res = sdb(serial, "forward", f"tcp:{LOCAL_PORT}", f"tcp:{remote_port}")
    if res.returncode != 0:
        sys.exit(f"No he podido redirigir el puerto: {res.stderr.strip()}")


def find_target(retries=20):
    """Espera a que el inspector publique la pagina de la app."""
    for _ in range(retries):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{LOCAL_PORT}/json", timeout=2) as r:
                targets = json.load(r)
            for t in targets:
                if t.get("webSocketDebuggerUrl"):
                    return t
        except Exception:
            pass
        import time
        time.sleep(0.5)
    sys.exit("El inspector no ha publicado ninguna pagina. Prueba a relanzar la app.")


def fmt_arg(arg):
    if "value" in arg:
        return str(arg["value"])
    if arg.get("type") == "object":
        prev = arg.get("preview")
        if prev:
            parts = [f"{p.get('name')}: {p.get('value')}" for p in prev.get("properties", [])]
            return "{" + ", ".join(parts) + "}"
        return arg.get("description", "[object]")
    return arg.get("description", arg.get("type", "?"))


async def main():
    ap = argparse.ArgumentParser(description="Consola remota de la app en la TV")
    ap.add_argument("--tv", default=os.environ.get("TV_IP", "192.168.1.44"))
    ap.add_argument("--eval", dest="expr", help="evalua una expresion y sale")
    ap.add_argument("--attach", action="store_true",
                    help="no relanzar la app; conectar a la sesion existente")
    args = ap.parse_args()

    try:
        import websockets
    except ImportError:
        sys.exit("Falta el paquete websockets. Usa: ../venv/bin/python tools/tv-debug.py")

    serial = ensure_connected(args.tv)

    if args.attach:
        # Con --attach se asume que ya hay una redireccion viva.
        target = find_target(retries=4)
    else:
        print(f"==> Arrancando {APP_ID} en modo depuracion...")
        port = launch_debug(serial)
        forward(serial, port)
        print(f"    inspector de la TV en el puerto {port} -> localhost:{LOCAL_PORT}")
        target = find_target()

    print(f"==> Conectado a: {target.get('title') or target.get('url')}\n")

    async with websockets.connect(target["webSocketDebuggerUrl"],
                                  max_size=10 * 1024 * 1024) as ws:
        for i, method in enumerate(("Runtime.enable", "Log.enable", "Console.enable"), 1):
            await ws.send(json.dumps({"id": i, "method": method}))

        if args.expr:
            await ws.send(json.dumps({
                "id": 100, "method": "Runtime.evaluate",
                "params": {"expression": args.expr, "returnByValue": True,
                           "awaitPromise": True},
            }))

        while True:
            msg = json.loads(await ws.recv())

            if msg.get("id") == 100:
                result = msg.get("result", {})
                if "exceptionDetails" in result:
                    print("\033[31m" + json.dumps(result["exceptionDetails"], indent=2) + RESET)
                else:
                    value = result.get("result", {}).get("value")
                    print(json.dumps(value, indent=2, ensure_ascii=False)
                          if not isinstance(value, str) else value)
                return

            method = msg.get("method")
            params = msg.get("params", {})

            if method == "Runtime.consoleAPICalled":
                level = params.get("type", "log")
                text = " ".join(fmt_arg(a) for a in params.get("args", []))
                print(f"{COLORS.get(level, '')}[{level}] {text}{RESET}")

            elif method == "Log.entryAdded":
                entry = params.get("entry", {})
                level = entry.get("level", "info")
                print(f"{COLORS.get(level, '')}[{level}] {entry.get('text')}"
                      f"{' ' + entry.get('url', '') if entry.get('url') else ''}{RESET}")

            elif method == "Runtime.exceptionThrown":
                det = params.get("exceptionDetails", {})
                desc = det.get("exception", {}).get("description") or det.get("text")
                print(f"\033[31m[excepcion] {desc}{RESET}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nFin.")
