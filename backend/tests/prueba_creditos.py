"""Comprueba donde empiezan los creditos (services/creditos.py), sin base de datos.

Tres cosas: que se reconozca el capitulo de creditos con nombres reales del
catalogo (y no un «Opening Credits» del principio), que la prevision para un
enlace sin medir sea creible, y que una medicion pase a ser la referencia de
su temporada y de la serie.

    PYTHONPATH=backend python3 backend/tests/prueba_creditos.py
"""
import asyncio
import sys
import types

# Base de datos de mentira: las funciones de database/creditos.py apuntan aqui.
fake = types.ModuleType("app.database.connection")
fake.get_pool = lambda: None
sys.modules["app.database.connection"] = fake

from app.database import creditos as db  # noqa: E402
from app.services import creditos as cr  # noqa: E402
from app.services.creditos import inicio_desde_capitulos, prevision, tipo_tmdb  # noqa: E402

fallos = 0


def ver(cond: bool, que: str):
    global fallos
    print(("  ok   " if cond else "  MAL  ") + que)
    if not cond:
        fallos += 1


def caps(*pares, fin):
    """[(inicio, titulo), ...] -> capitulos como los da leer_pistas()."""
    out = []
    for i, (ini, titulo) in enumerate(pares):
        out.append({"start": ini, "end": pares[i + 1][0] if i + 1 < len(pares) else fin, "title": titulo})
    return out


print("Capitulos reales")
mass = caps((0, "The Room"), (1200, "Protect Our Son"), (6464, "End Credits"), fin=6681)
ver(inicio_desde_capitulos(mass, 6681) == (6464.0, False), "Mass (2021): «End Credits» en 1:47:44")
shrek = caps((0, " 1. Dinner Theater"), (2500, " 2. Far Far Away"), (5200, "18. End Credits"), fin=5560)
ver(inicio_desde_capitulos(shrek, 5560)[0] == 5200.0, "Shrek tercero: «18. End Credits»")
kill = caps((0, "Intro"), (60, "Opening: Garnidelia - ambiguous"), (150, "Episode"),
            (1290, "Ending: Sayonara Ponytail - Shinsekai Koukyougaku"), (1380, "Preview"), fin=1420)
ver(inicio_desde_capitulos(kill, 1420) == (1290.0, False), "Kill la Kill: el «Ending», y el «Preview» no es escena")
boku = caps((0, "Avant"), (100, "Part A"), (700, "Part B"), (1310, "ED"), fin=1420)
ver(inicio_desde_capitulos(boku, 1420)[0] == 1310.0, "Boku Dake ga Inai Machi: «ED»")
deshielo = caps((0, "Intro"), (40, "Chapter 1"), (2550, "Credits"), fin=2640)
ver(inicio_desde_capitulos(deshielo, 2640)[0] == 2550.0, "El Deshielo: «Credits», no la «Intro»")
espanol = caps((0, "Introducción"), (300, "Película"), (5000, "Créditos finales"), fin=5300)
ver(inicio_desde_capitulos(espanol, 5300)[0] == 5000.0, "en español: «Créditos finales»")

print("Lo que no son creditos finales")
abre = caps((0, "Opening Credits"), (180, "Chapter 2"), (3000, "Chapter 3"), fin=3600)
ver(inicio_desde_capitulos(abre, 3600) == (None, False), "«Opening Credits» al principio no cuenta")
pronto = caps((0, "Chapter 1"), (600, "Credits"), (900, "Chapter 3"), fin=3600)
ver(inicio_desde_capitulos(pronto, 3600)[0] is None, "un «Credits» a mitad de pelicula no cuenta")
escenas = caps((0, "Scene 1"), (1000, "Scene 2"), (2000, "Scene 3"), fin=3000)
ver(inicio_desde_capitulos(escenas, 3000)[0] is None, "capitulos de escena: no dicen nada")
ver(inicio_desde_capitulos([], 3000) == (None, False), "sin capitulos")
marvel = caps((0, "Movie"), (7000, "End Credits"), (7400, "Post-credits scene"), fin=7600)
ver(inicio_desde_capitulos(marvel, 7600) == (7000.0, True), "escena tras los creditos")
solo_post = caps((0, "Movie"), (7400, "Post-credits scene"), fin=7600)
ver(inicio_desde_capitulos(solo_post, 7600)[0] is None, "«Post-credits scene» no es el inicio de los creditos")

print("Prevision para otro enlace")
ref_peli = {"antes_del_final": 217.0, "duracion": 6681.0}
ver(prevision(ref_peli, 6681.0, "movie") == 6464.0, "el mismo archivo: el mismo segundo")
ver(prevision(ref_peli, 6700.0, "movie") == 6483.0, "otro enlace con 19 s de logo delante")
ver(prevision(ref_peli, 6681 * 0.96, "movie") is not None, "copia europea (4 % mas rapida): se predice")
ver(prevision(ref_peli, 6681 * 1.2, "movie") is None, "un 20 % mas larga: otro montaje, no se predice")
ref_ep = {"antes_del_final": 90.0, "duracion": 1420.0}
ver(prevision(ref_ep, 1300.0, "tv") == 1210.0, "otro episodio mas corto: mismo final")
ver(prevision(ref_ep, 150.0, "tv") is None, "creditos antes de la mitad: no es creible")
ver(prevision(None, 1300.0, "tv") is None, "sin referencia")
ver(prevision(ref_ep, None, "tv") is None, "sin duracion")
ver(tipo_tmdb("series") == "tv" and tipo_tmdb("movie") == "movie" and tipo_tmdb("x") is None, "tipos")

print("Una medicion pasa a ser la referencia")
llamadas = []


async def g_enlace(ruta, **k):
    llamadas.append(("enlace", ruta, k))
    return True


async def g_ref(tid, tipo, temp, **k):
    llamadas.append(("ref", (tid, tipo, temp), k))
    return True


async def titulo(ch, msg):
    return {"tmdb_id": 94605, "tmdb_type": "tv", "season": 2}


db.guardar_enlace, db.guardar_referencia, db.titulo_de_mensaje = g_enlace, g_ref, titulo
asyncio.run(cr.guardar_medicion("tg:123:456", inicio=1310.0, duracion=1420.0, fuente="capitulos"))
refs = [c for c in llamadas if c[0] == "ref"]
ver(llamadas[0][0] == "enlace" and llamadas[0][2]["tmdb_id"] == 94605 and llamadas[0][2]["temporada"] == 2,
    "el enlace de Telegram sabe su titulo y temporada por el catalogo")
ver(len(refs) == 2 and refs[0][1] == (94605, "tv", 2) and refs[0][2]["antes_del_final"] == 110.0,
    "referencia de la temporada 2: los ultimos 110 s")
ver(refs[1][1] == (94605, "tv", 0) and refs[1][2]["solo_si_no_hay"], "y de la serie entera, si no tenia")

llamadas.clear()
asyncio.run(cr.guardar_medicion("Peli (2021)/Peli (2021).mp4", inicio=None, duracion=6000.0,
                                fuente="imagen", estado="sin_creditos", tmdb_id=1, tmdb_type="movie"))
ver([c[0] for c in llamadas] == ["enlace"], "«sin creditos» no crea referencia")

try:
    asyncio.run(cr.guardar_medicion("x", inicio=1.0, duracion=2.0, fuente="adivinado"))
    ver(False, "una fuente desconocida se rechaza")
except ValueError:
    ver(True, "una fuente desconocida se rechaza")

print()
print(f"{fallos} fallidas" if fallos else "todo bien")
sys.exit(1 if fallos else 0)
