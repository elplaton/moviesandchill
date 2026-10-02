#!/usr/bin/env python3
"""Pide a Coolify que despliegue y espera a saber como ha acabado.

Va en Python y no en una tuberia de curl porque hay que leer JSON y decidir
sobre el, y porque interesa distinguir tres cosas que una tuberia confunde:
que el despliegue no se haya podido *pedir* (eso es un fallo del workflow),
que haya acabado *mal* (fallo tambien, y es lo que se quiere ver en rojo), y
que simplemente no se pueda *consultar* su estado (eso no es motivo para dar
el push por fallido: el despliegue ya esta en marcha).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ["COOLIFY_URL"].rstrip("/")
TOKEN = os.environ["COOLIFY_TOKEN"]
UUID = os.environ["COOLIFY_APP_UUID"]

ESPERA = 10          # segundos entre consultas
LIMITE = 120         # 20 minutos
FALLOS_SEGUIDOS = 6  # consultas fallidas antes de rendirse (sin dar error)

ACABADO_BIEN = {"finished", "success", "succeeded", "done"}
ACABADO_MAL = {"failed", "error", "cancelled", "canceled", "cancelled_by_user"}


def pedir(ruta: str, metodo: str = "GET") -> dict:
    req = urllib.request.Request(
        f"{BASE}{ruta}",
        method=metodo,
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        cuerpo = r.read().decode("utf-8", "replace")
    return json.loads(cuerpo) if cuerpo.strip() else {}


def buscar(dato, clave: str):
    """Primera aparicion de `clave` en un JSON anidado.

    La forma exacta de la respuesta de Coolify ha cambiado entre versiones, y
    no hay especificacion publica en la instancia para comprobarla. Buscar la
    clave donde sea es mas robusto que asumir una ruta concreta.
    """
    if isinstance(dato, dict):
        if clave in dato and dato[clave] is not None:
            return dato[clave]
        for v in dato.values():
            hallado = buscar(v, clave)
            if hallado is not None:
                return hallado
    elif isinstance(dato, list):
        for v in dato:
            hallado = buscar(v, clave)
            if hallado is not None:
                return hallado
    return None


def main() -> int:
    # 1. Pedir el despliegue. Si esto falla, el workflow debe fallar.
    try:
        respuesta = pedir(f"/api/v1/deploy?uuid={UUID}&force=false")
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:500]
        print(f"Coolify ha rechazado la peticion ({e.code}): {detalle}", file=sys.stderr)
        if e.code in (401, 403):
            print("Revisa COOLIFY_TOKEN y que tenga permiso de despliegue.", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"No se ha podido contactar con Coolify en {BASE}: {e}", file=sys.stderr)
        print("¿Ha entrado el runner en la tailnet? ¿Es correcta COOLIFY_URL?", file=sys.stderr)
        return 1

    print("Despliegue pedido.")
    print(json.dumps(respuesta, indent=1)[:800])

    despliegue = buscar(respuesta, "deployment_uuid") or buscar(respuesta, "uuid")
    if not despliegue:
        print("\nNo viene identificador de despliegue en la respuesta, asi que no "
              "se puede seguir su estado. El despliegue esta en marcha: mira "
              "Coolify para ver como acaba.")
        return 0

    # 2. Esperar. No saber el estado no es motivo para dar el push por fallido.
    print(f"\nSiguiendo el despliegue {despliegue}...")
    fallos = 0
    for _ in range(LIMITE):
        try:
            estado = str(buscar(pedir(f"/api/v1/deployments/{despliegue}"), "status") or "").lower()
            fallos = 0
        except Exception as e:
            fallos += 1
            if fallos >= FALLOS_SEGUIDOS:
                print(f"\nNo se puede consultar el estado ({e}). El despliegue sigue "
                      "en marcha; compruebalo en Coolify.")
                return 0
            time.sleep(ESPERA)
            continue

        if estado in ACABADO_BIEN:
            print(f"\nDespliegue terminado correctamente ({estado}).")
            return 0
        if estado in ACABADO_MAL:
            print(f"\nEl despliegue ha terminado en: {estado}", file=sys.stderr)
            return 1
        print(f"  ... {estado or 'sin estado'}")
        time.sleep(ESPERA)

    print("\nSe ha agotado la espera sin que el despliegue terminara. "
          "Sigue en marcha, compruebalo en Coolify.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
