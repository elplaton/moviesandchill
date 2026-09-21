#!/usr/bin/env python3
"""
Consola remota de la app de la television.

Por que este camino y no el inspector de Tizen: esta TV (y las de tienda en
general) llevan `secure_protocol:enabled`, que bloquea `sdb shell`. Sin shell
no se puede lanzar la app en modo depuracion, y sin eso la television no abre
ningun puerto de inspector. Comprobado: 7011, 9222, 9998 y 9999 cerrados.

Asi que el canal va al reves. La app, compilada con VITE_DEBUG_HOST, se conecta
a este servidor y le manda todo lo que pasa por consola, los errores y las
promesas sin capturar. Ademas acepta expresiones para evaluar en la TV.

    ./deploy.sh --debug                      despliega y abre la consola
    ../venv/bin/python tools/debug-server.py
    ../venv/bin/python tools/debug-server.py --eval "__focus().arbol"

Solo las compilaciones hechas con --debug llevan este canal; en las normales
Vite elimina el modulo entero del paquete.
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime

PORT = 9333
COLOR = {
    "error": "\033[31m", "warn": "\033[33m", "info": "\033[36m",
    "debug": "\033[90m", "log": "",
}
RESET = "\033[0m"
DIM = "\033[90m"


def stamp(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000).strftime("%H:%M:%S")


async def main():
    ap = argparse.ArgumentParser(description="Consola remota de la app en la TV")
    ap.add_argument("--eval", dest="expr", help="evalua una expresion en la TV y sale")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--timeout", type=float, default=60,
                    help="segundos de espera a que la app conecte (modo --eval)")
    args = ap.parse_args()

    try:
        import websockets
    except ImportError:
        sys.exit("Falta websockets. Usa: ../venv/bin/python tools/debug-server.py")

    done = asyncio.Event()
    request_id = 0

    async def handler(ws):
        nonlocal request_id
        print(f"{DIM}-- la app ha conectado --{RESET}")

        if args.expr:
            request_id += 1
            await ws.send(json.dumps({"id": request_id, "expr": args.expr}))

        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                kind = msg.get("type")
                when = stamp(msg.get("ts", 0)) if msg.get("ts") else "--:--:--"

                if kind == "hello":
                    print(f"{DIM}{when} conectada: {msg.get('url')}{RESET}")
                elif kind == "console":
                    level = msg.get("level", "log")
                    print(f"{COLOR.get(level, '')}{when} [{level}] {msg.get('text')}{RESET}")
                elif kind == "error":
                    print(f"{COLOR['error']}{when} [error] {msg.get('text')}{RESET}")
                    if msg.get("stack"):
                        print(f"{DIM}{msg['stack']}{RESET}")
                elif kind == "result":
                    if msg.get("error"):
                        print(f"{COLOR['error']}{msg['error']}{RESET}")
                    else:
                        print(msg.get("value"))
                    if args.expr:
                        done.set()
                        return
        except Exception:
            pass
        finally:
            print(f"{DIM}-- la app se ha desconectado --{RESET}")

    async with websockets.serve(handler, "0.0.0.0", args.port):
        if args.expr:
            print(f"{DIM}Esperando a que la app conecte en el puerto {args.port}...{RESET}")
            try:
                await asyncio.wait_for(done.wait(), timeout=args.timeout)
            except asyncio.TimeoutError:
                sys.exit(
                    "La app no ha conectado.\n"
                    "Comprueba que se desplego con ./deploy.sh --debug y que la TV\n"
                    "puede alcanzar este equipo."
                )
        else:
            print(f"{DIM}Escuchando en el puerto {args.port}. Ctrl-C para salir.{RESET}")
            await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nFin.")
