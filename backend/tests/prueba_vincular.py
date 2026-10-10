"""Comprueba la entrada en la tele con el movil (services/vincular.py).

Lo que importa aqui es lo que no se ve: que el codigo corto que sale en
pantalla no sirva para llevarse los tokens, que los tokens se entreguen una
sola vez, que todo caduque y que un codigo aprobado o rechazado no se pueda
volver a usar.

Se lanza solo, sin framework y sin base de datos:
  PYTHONPATH=backend python3 backend/tests/prueba_vincular.py
"""
import sys

from app.services import vincular as v

fallos = []
total = 0
def comprueba(que, esperado, obtenido):
    global total
    total += 1
    ok = esperado == obtenido
    print(("  ok   " if ok else "  FALLA ") + que)
    if not ok:
        fallos.append(que)
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")

T = 1000.0

print("El camino normal")
p = v.crear("Fire TV", ahora=T)
comprueba("el codigo mide seis", 6, len(p.codigo))
comprueba("el codigo no lleva letras que se confundan",
          True, all(c in v.ALFABETO for c in p.codigo))
comprueba("el secreto es largo", True, len(p.secreto) >= 40)
comprueba("antes de aprobar, pendiente", ("pendiente", None), v.consultar(p.secreto, ahora=T + 1))
comprueba("el movil ve que aparato es", "Fire TV", v.buscar(p.codigo, ahora=T + 2).aparato)
comprueba("se aprueba tecleado a mano, con espacio y en minusculas",
          True, v.aprobar(p.codigo[:3].lower() + " " + p.codigo[3:], "juanjo", ahora=T + 3))
comprueba("la tele recoge la cuenta", ("aprobado", "juanjo"), v.consultar(p.secreto, ahora=T + 4))
comprueba("y solo una vez", ("caducado", None), v.consultar(p.secreto, ahora=T + 5))
comprueba("el codigo ya no se puede volver a aprobar", False, v.aprobar(p.codigo, "otro", ahora=T + 6))

print("\nLo que no debe pasar")
p = v.crear("Samsung", ahora=T)
comprueba("con el codigo corto no se recoge nada", ("caducado", None), v.consultar(p.codigo, ahora=T + 1))
comprueba("un secreto vacio no encuentra nada", ("caducado", None), v.consultar("", ahora=T + 1))
v.aprobar(p.codigo, "juanjo", ahora=T + 2)
comprueba("aprobado, ya no se ofrece a otro movil", None, v.buscar(p.codigo, ahora=T + 3))

p = v.crear("LG", ahora=T)
comprueba("rechazar", True, v.rechazar(p.codigo, ahora=T + 1))
comprueba("la tele se entera del rechazo", ("rechazado", None), v.consultar(p.secreto, ahora=T + 2))
comprueba("y el rechazo tampoco se repite", ("caducado", None), v.consultar(p.secreto, ahora=T + 3))

print("\nCaducidad")
p = v.crear("PS4", ahora=T)
comprueba("vivo justo antes de caducar", "PS4", v.buscar(p.codigo, ahora=T + v.DURACION_S - 1).aparato)
comprueba("caducado no se puede aprobar", False, v.aprobar(p.codigo, "juanjo", ahora=T + v.DURACION_S))
comprueba("y la tele lo ve caducado", ("caducado", None), v.consultar(p.secreto, ahora=T + v.DURACION_S))
comprueba("los segundos que quedan", 60, v.segundos_restantes(v.crear("x", ahora=T), ahora=T + v.DURACION_S - 60))

print("\nTope de codigos vivos")
for i in range(v.MAX_PENDIENTES + 5):
    ultimo = v.crear("bucle", ahora=T + 10_000)
comprueba("pasado el tope no se crean mas", None, ultimo)
comprueba("al caducar los viejos se puede volver a pedir",
          True, v.crear("tele", ahora=T + 10_000 + v.DURACION_S) is not None)

print()
print(f"{total - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
