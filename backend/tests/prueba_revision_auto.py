"""Comprueba la revision automatica (services/revision_auto.py) sin TMDB ni
base de datos: que titulo se busca, que tipo se deduce de los archivos y
cuando se aplica sola una ficha y cuando solo se sugiere.

Los nombres son de grupos reales de Admin -> Revision (noviembre de 2026).

    PYTHONPATH=backend python3 backend/tests/prueba_revision_auto.py
"""
import sys

from app.services.revision import capitulo_de
from app.services.revision_auto import decidir, tipo_y_episodios, titulo_buscable

fallos = []


def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  FALLA ") + que)
    if not ok:
        fallos.append(que)
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")


def miembros(*nombres, temporada=None, episodio=None):
    return [(i, 1, "canal", temporada, episodio, n) for i, n in enumerate(nombres, 1)]


print("\nQue titulo se busca")
for titulo, esperado in [
    ("Black Clover", "Black Clover"),
    ("La Patrulla Galáctica", "La Patrulla Galáctica"),
    ("Serie Dragon Ball Super", "Dragon Ball Super"),
    ("SIPNOSIS SERIE TRIADA", "TRIADA"),
    ("Sîpńõsïs:SERIE RABO DE PEIXE", "RABO DE PEIXE"),
    ("Dejo por aquí la serie Embrujadas", "Embrujadas"),
    ("Stitch! anime 3 seasons + especiales", "Stitch!"),
    ("Haven ESP", "Haven"),
    ("RECOMENDADA", None),
    ("Temporada-15", None),
    ("19 episodios", None),
    ("23 EPISODIOS", None),
    ("Capítulo", None),
    ("Episodio", None),
    ("T6", None),
    ("HMAX DD5.1", None),
    ("Cap", None),
]:
    comprueba(f"«{titulo}» -> {esperado!r}", esperado, titulo_buscable(titulo))

print("\nEl capitulo, en nombres que el parser general no entiende")
for nombre, titulo, esperado in [
    ("Dragon Ball Super 078 [ESP-JAP] [WEB-DL 1080p].mkv", "Dragon Ball Super", (None, 78)),
    ("Bob el Genio (49).mkv", "BOB EL GENIO DE LA BOTELLA", (None, 49)),
    ("83.mp4", "Pájaro soñador", (None, 83)),
    ("S1.03 FELIX EL GATO.mp4", "Félix el gato", (1, 3)),
    ("AnimeOnlineNinja_Pokemon_2019_Castellano_48_¡Intercambio_con_casi.mp4", "Pokémon viajes 1", (None, 48)),
    ("Tiro Loco Mcgraw (12).mp4", "TIRO LOCO McGRAW", (None, 12)),
    ("Belfy Y Lillibit C07.mp4", "BELFY Y LILLIBIT", (None, 7)),
    ("Star Wars la remesa mala 2 x 1.mp4", "Star Wars la remesa mala", (2, 1)),
    ("Monarch_El_Legado_De_Los_Monstruos_HDTV_720pCap_102wolfmax4k_com.mp4", "Monarch", (1, 2)),
    ("Farscape 3xE02 - Entrevistas detrás de las cámaras.mkv", "Farscape", (3, 2)),
    ("[S1-E003-CAST]-_El_Inmortal.mkv.mp4", "El Inmortal", (1, 3)),
    ("And Just Like That... - T03, E05 (2025).mkv", "And Just Like That", (3, 5)),
    ("Larga_Vida_al_Rey_Julien_Exiled_#05_En_Busca_De_Lord_Tiburón.mp4", "Larga vida al rey Julien", (None, 5)),
    ("ERIKO - E39 Marcha hacia la gloria.mkv", "Eriko", (None, 39)),
    ("Medabots 2 54 - La tentación de la lucha.avi", "MEDABOTS", (None, None)),
    ("Más que rivales online _2025_ - Movistar Plus+.mp4", "MAS QUE RIVALES", (None, None)),
    ("master.mp4", "La Verdad Sobre el Caso de Harry Quebert", (None, None)),
    ("Capítulo 1639", None, (None, 1639)),
    ("Capítulo 2061", None, (None, 2061)),
    ("chunklist_b648000 (404p_aac).mp4", None, (None, None)),
    ("Pokemon 2019 Castellano 48", None, (None, 48)),
]:
    comprueba(f"{nombre[:55]} -> {esperado}", esperado, capitulo_de(nombre, titulo))

print("\nEl tipo, por los archivos")
tipo, eps = tipo_y_episodios(miembros("135 - Black Clover 1080p @AnimeFlix.mkv", "136 - Black Clover 1080p @AnimeFlix.mkv",
                                      "137 - Black Clover 1080p @AnimeFlix.mkv"), "movie", None)
comprueba("capitulos numerados delante: serie", "series", tipo)
comprueba("y cada uno con su capitulo", {1: (1, 135), 2: (1, 136), 3: (1, 137)}, eps)
tipo, eps = tipo_y_episodios(miembros("Minky Momo 10.mkv", "Minky Momo 11.mkv", "Minky Momo 12.mkv"), "movie", None)
comprueba("numerados al final: serie con capitulos", ("series", {1: (1, 10), 2: (1, 11), 3: (1, 12)}), (tipo, eps))
tipo, eps = tipo_y_episodios(miembros("T1.part01.rar", "T1.part02.rar", "T1.part03.rar"), "movie",
                             "Ben 10 (2005) - Temporada 1 (1080p)")
comprueba("partes de un rar: serie (lo dice la ficha), pero sin capitulos", ("series", None), (tipo, eps))
tipo, eps = tipo_y_episodios(miembros("Dune Parte dos 2024 1080p.mkv", "Dune Parte dos 2024 4K.mkv"), "movie", None)
comprueba("dos calidades de una pelicula: pelicula", ("movie", None), (tipo, eps))
tipo, eps = tipo_y_episodios(miembros("Una Vida Perfecta 008.mp4", "Una Vida Perfecta 009.mp4",
                                      "Una Vida Perfecta 010.mp4", "Una Vida Perfecta.mp4"), "movie", None)
comprueba("si a uno le falta el numero: serie, pero sin capitulos (no se aplica sola)", ("series", None), (tipo, eps))

print("\nLa decision")
bc = {"tmdb_id": 73223, "media_type": "tv", "title": "Black Clover", "year": 2017, "poster": "/p.jpg", "vote_count": 900}
comprueba("una serie exacta y todos sus capitulos: se aplica sola", "segura",
          decidir([bc], "series", None, {1: (1, 135), 2: (1, 136), 3: (1, 137)}, None)[0])
comprueba("la misma sin capitulos de todos: solo sugerencia", "sugerida",
          decidir([bc], "series", None, None, None)[0])
dune = {"tmdb_id": 693134, "media_type": "movie", "title": "Dune: Parte dos", "year": 2024, "poster": "/d.jpg"}
comprueba("pelicula exacta y mismo año: se aplica sola", "segura", decidir([dune], "movie", 2024, None, None)[0])
comprueba("pelicula exacta sin año en el canal: sugerencia", "sugerida", decidir([dune], "movie", None, None, None)[0])
comprueba("pelicula exacta de otro año: sugerencia", "sugerida", decidir([dune], "movie", 2019, None, None)[0])
addams = [{"tmdb_id": 1, "media_type": "movie", "title": "La familia Addams", "year": 1991, "poster": "/a", "vote_count": 3000},
          {"tmdb_id": 2, "media_type": "movie", "title": "La familia Addams", "year": 2019, "poster": "/b", "vote_count": 2000}]
cual, elegida, _ = decidir(addams, "movie", 2019, None, None)
comprueba("dos que se llaman igual: el año decide", ("segura", 2), (cual, elegida["tmdb_id"]))
cual, elegida, _ = decidir(addams, "movie", None, None, None)
comprueba("dos que se llaman igual y sin año: sugerida la mas votada", ("sugerida", 1), (cual, elegida["tmdb_id"]))
ben = [{"tmdb_id": 10, "media_type": "tv", "title": "Ben 10", "year": 2005, "poster": "/x", "vote_count": 500},
       {"tmdb_id": 11, "media_type": "tv", "title": "Ben 10", "year": 2016, "poster": "/y", "vote_count": 100}]
cual, elegida, _ = decidir(ben, "series", 2005, {1: (1, 1)}, None)
comprueba("serie con el año de la ficha: la de ese año", ("segura", 10), (cual, elegida["tmdb_id"]))
cual, elegida, _ = decidir(ben, "series", 2008, {1: (1, 1)}, None)
comprueba("serie con el año de una temporada posterior: la unica que ya existia", ("segura", 10),
          (cual, elegida["tmdb_id"]))
comprueba("dos que pudieron empezar antes y sin año que las separe: sugerencia", "sugerida",
          decidir(ben, "series", 2020, {1: (1, 1)}, None)[0])
comprueba("dos calidades con su resolucion no son capitulos", ("movie", None),
          tipo_y_episodios(miembros("Akira 1988 1080p.mkv", "Akira 1988 720p.mkv", "Akira 1988 2160p.mkv"), "movie", None))
sin_poster = {**dune, "poster": None}
comprueba("sin caratula no se aplica sola", "sugerida", decidir([sin_poster], "movie", 2024, None, None)[0])
comprueba("nada exacto: nada", "nada", decidir([], "movie", 2024, None, None)[0])
al_limite = {"tmdb_id": 303525, "media_type": "tv", "title": "Al Límite", "year": 2006, "poster": "/l"}
comprueba("una serie de un solo capitulo y sin año: sugerencia", "sugerida",
          decidir([al_limite], "series", None, {1: (4, 4)}, None)[0])
comprueba("la misma con el año que cuadra: sola", "segura",
          decidir([al_limite], "series", 2010, {1: (4, 4)}, None)[0])
cual, _, porque = decidir([dune], "movie", 2024, None, {"tmdb_id": 693134, "media_type": "movie"})
comprueba("si es la que ya tenia, se confirma y lo dice", ("segura", "la ficha que tenía es la buena"), (cual, porque))

print("\nLo que se le manda a Claude (revision_ia)")
from app.services import revision_ia
cands = [{"tmdb_id": 73223, "media_type": "tv", "title": "Black Clover", "year": 2017},
         {"tmdb_id": 1, "media_type": "movie", "title": "Black Clover: La espada del rey mago", "year": 2023}]
esq = revision_ia.esquema([revision_ia.clave_de(c) for c in cands])
comprueba("solo puede elegir entre las candidatas o ninguna", ["tv:73223", "movie:1", "ninguna"],
          esq["properties"]["eleccion"]["enum"])
comprueba("una serie guardada como 'series' tambien es tv:", "tv:5", revision_ia.clave_de({"tmdb_id": 5, "media_type": "series"}))
g = {"titulo": "Black Clover", "original": None, "año": None, "ficha": None, "pie": None,
     "miembros": [(i, 1, "c", None, None, f"{i} - Black Clover.mkv") for i in range(1, 136)]}
import json as _json
m = _json.loads(revision_ia.mensaje(g, cands))
comprueba("el mensaje lleva cuantos archivos son y como mucho 5 nombres", (135, True),
          (m["n_archivos"], 0 < len(m["archivos"]) <= 5))
comprueba("y la clave de cada candidata", ["tv:73223", "movie:1"], [c["clave"] for c in m["candidatas"]])

print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
