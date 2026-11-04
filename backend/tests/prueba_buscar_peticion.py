"""Comprueba `services/buscar_peticion.py`: antes de pedir algo, decidir si
un archivo de los canales es ese titulo.

Lo que se vigila es no dar por encontrada otra pelicula: la secuela ("Dune"
no es "Dune: Parte dos"), la de otro año con el mismo titulo, un capitulo
cuando se pidio una pelicula, o una ficha del canal que enlaza a otra cosa.

    PYTHONPATH=backend python3 backend/tests/prueba_buscar_peticion.py
"""
import sys

from app.services.buscar_peticion import mismo_titulo, titulo_para_buscar, veredicto

fallos = []


def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  MAL  ") + que + ("" if ok else f": esperado {esperado!r}, obtenido {obtenido!r}"))
    if not ok:
        fallos.append(que)


DUNE2 = {"tmdb_id": 693134, "media_type": "movie", "titulo": "Dune: Parte dos",
         "titulo_original": "Dune: Part Two", "year": 2024}
ALIADOS = {"tmdb_id": 369885, "media_type": "movie", "titulo": "Aliados", "titulo_original": "Allied", "year": 2016}
BB = {"tmdb_id": 1396, "media_type": "tv", "titulo": "Breaking Bad", "titulo_original": "Breaking Bad", "year": 2008}


def si(nombre, peticion, pistas=None):
    return veredicto(nombre, pistas, peticion)[0]


print("El titulo con el que se busca")
comprueba("sin el año entre parentesis", "Dune: Parte dos", titulo_para_buscar("Dune: Parte dos (2024)"))
comprueba("tal cual si no lo lleva", "Aliados", titulo_para_buscar("Aliados"))
comprueba("un numero que es el titulo se queda", "1917", titulo_para_buscar("1917"))
comprueba("y uno dentro del titulo tambien", "Blade Runner 2049", titulo_para_buscar("Blade Runner 2049"))

print("Mismo titulo, no parecido")
comprueba("sin tildes ni signos", True, mismo_titulo("DUNE PARTE DOS", "Dune: Parte dos"))
comprueba("la secuela no es la primera", False, mismo_titulo("Dune", "Dune: Parte dos"))

print("Peliculas")
comprueba("nombre con titulo y año", True, si("Dune Parte Dos (2024) 1080p.mkv", DUNE2))
comprueba("el titulo original en formato escena", True, si("Dune.Part.Two.2024.2160p.WEB-DL.mkv", DUNE2))
comprueba("la primera parte no es la segunda", False, si("Dune (2021).mkv", DUNE2))
comprueba("mismo titulo de otro año", False, si("Aliados (1985).mkv", ALIADOS))
comprueba("un año de diferencia vale (estreno en España)", True, si("Aliados (2017) [BluRay].mkv", ALIADOS))
comprueba("sin año ni ficha no se arriesga", False, si("Dune Parte Dos.mkv", DUNE2))
comprueba("sin año pero con la ficha del canal", True,
          si("Dune Parte Dos.mkv", DUNE2, {"titulo": "DUNE PARTE DOS", "año": 2024}))
comprueba("la ficha del canal dice otro año", False,
          si("Dune Parte Dos.mkv", DUNE2, {"titulo": "DUNE PARTE DOS", "año": 1984}))
comprueba("nombre que no dice nada, ficha que si", True,
          si("60b016c396c7.mp4", DUNE2, {"titulo": "Dune: Parte dos", "año": 2024}))
comprueba("un capitulo no es la pelicula", False, si("Dune Parte Dos 1x01.mkv", DUNE2))
comprueba("la ficha enlaza a este titulo en TMDB", True,
          si("cualquier cosa.mkv", DUNE2, {"titulo": "x", "tmdb_id": 693134, "tmdb_tipo": "movie"}))
comprueba("la ficha enlaza a otro titulo: no, aunque el nombre cuadre", False,
          si("Dune Parte Dos (2024).mkv", DUNE2, {"titulo": "Dune", "tmdb_id": 438631, "tmdb_tipo": "movie"}))
comprueba("el nombre lleva su id de TMDB", True, si("Dune Parte Dos [tmdbid-693134].mkv", DUNE2))
# Casos reales de la prueba contra Telegram (noviembre de 2026).
comprueba("el 7z de la pelicula, año delante", True, si("[2016] Aliados [DuaL].7z.001", ALIADOS))
comprueba("los extras no son la pelicula aunque cuelguen de su ficha", False,
          si("Extra - Aliados.7z.001", ALIADOS, {"titulo": "Aliados", "año": 2016}))
comprueba("otra pelicula con la palabra", False,
          si("Nuestros Maravillosos Aliados (1987).mkv", ALIADOS, {"titulo": "Nuestros maravillosos aliados", "año": 1987}))
comprueba("la secuela con la ficha de la primera encima", False,
          si("Aliados 2 (2016).mkv", ALIADOS, {"titulo": "Aliados", "año": 2016}))

print("Series")
comprueba("un capitulo de la serie", True, si("Breaking Bad 1x01.mkv", BB))
comprueba("un capitulo de otra serie", False, si("Better Call Saul 1x01.mkv", BB))
comprueba("una pelicula con el nombre de la serie no", False, si("Breaking Bad (2008).mkv", BB))

print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
