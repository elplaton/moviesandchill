"""Comprueba que una descarga interrumpida al apagar se resuelve bien.

Sin base de datos: se le pone a reconciliar_interrumpidas() un pool de mentira
que apunta las consultas que lanza, y una biblioteca de mentira en disco.
"""
import asyncio, os, sys, tempfile, types

raiz = tempfile.mkdtemp()
estado = tempfile.mkdtemp()
os.environ["TMD_STATE_DIR"] = estado

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import downloads as D


class ConexionFalsa:
    def __init__(self, filas):
        self.filas, self.hechas = filas, []

    async def fetch(self, *_a):
        return self.filas

    async def execute(self, sql, *args):
        self.hechas.append((" ".join(sql.split())[:46], args))


class PoolFalso:
    def __init__(self, conn): self.conn = conn
    def acquire(self):
        conn = self.conn
        class Ctx:
            async def __aenter__(self): return conn
            async def __aexit__(self, *a): return False
        return Ctx()


def fila(id, ruta, nombre, owner="elpajas"):
    return {"id": id, "folder_path": ruta, "folder_name": nombre, "owner": owner}


def correr(filas, pausados=()):
    conn = ConexionFalsa(filas)
    D.get_pool = lambda: PoolFalso(conn)
    falso = types.ModuleType("app.services.storage")
    falso.load_paused_batches = lambda: {b: {"folder_path": b} for b in pausados}
    sys.modules["app.services.storage"] = falso
    n = asyncio.run(D.reconciliar_interrumpidas(raiz))
    return n, conn.hechas


fallos = []
def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  FALLA ") + que)
    if not ok:
        print(f"         esperaba {esperado!r}\n         obtuvo   {obtenido!r}")
        fallos.append(que)


print("Una carpeta de trabajo que no se puede reanudar:")
trabajo = os.path.join(raiz, "Final Space", "Temporada 1", ".dl_2229558644")
os.makedirs(trabajo)
open(os.path.join(trabajo, "parte.rar"), "wb").write(b"x" * 10)
n, hechas = correr([fila(5, trabajo, "Final Space 1x01")])
comprueba("se resuelve una", 1, n)
comprueba("se borra la fila (no se marca done)", True, hechas[0][0].startswith("DELETE FROM downloads"))
comprueba("se borra la carpeta temporal", False, os.path.exists(trabajo))
comprueba("y se podan las carpetas que quedan vacias", False,
          os.path.exists(os.path.join(raiz, "Final Space")))

print("\nLa carpeta temporal ya no estaba (el caso de produccion):")
n, hechas = correr([fila(5, os.path.join(raiz, "Otra", "Temporada 1", ".dl_9"), "Otra 1x01")])
comprueba("tambien se olvida la fila", True, hechas[0][0].startswith("DELETE FROM downloads"))

print("\nSi el lote sigue pausado en disco, no se toca nada:")
trabajo2 = os.path.join(raiz, "Suits", "Temporada 1", ".dl_77")
os.makedirs(trabajo2)
open(os.path.join(trabajo2, "parte1.rar"), "wb").write(b"x" * 10)
n, hechas = correr([fila(7, trabajo2, "Suits 1x01")], pausados=[trabajo2])
comprueba("se corrige a pausada", True, "status='paused'" in hechas[0][0])
comprueba("y las partes ya bajadas sobreviven", True, os.path.isfile(os.path.join(trabajo2, "parte1.rar")))

print("\nSi llego a moverse a su sitio, se da por terminada:")
final = os.path.join(raiz, "Dune (2021)")
os.makedirs(final)
open(os.path.join(final, "Dune (2021).mp4"), "wb").write(b"x" * 1234)
n, hechas = correr([fila(9, final, "Dune (2021)")])
comprueba("se marca done y no se borra", True, "status='done'" in hechas[0][0])
comprueba("con su tamaño real", 1234, hechas[0][1][1])
comprueba("y el archivo sigue ahi", True, os.path.isfile(os.path.join(final, "Dune (2021).mp4")))

print("\nSin nada colgado no hace nada:")
n, hechas = correr([])
comprueba("cero filas, cero consultas", (0, []), (n, hechas))

print()
print(f"{12 - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
