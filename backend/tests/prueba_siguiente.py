"""Comprueba la decision del "siguiente episodio" contra una biblioteca de mentira.

Lo que se prueba es la regla que se pidio, que tiene tres estados y es facil
equivocarse en los bordes:

  nada descargado delante  -> ofrecer bajar DOS
  uno descargado delante   -> ofrecer ver ese y bajar UNO (reponer la reserva)
  dos o mas delante        -> no preguntar nada

Mas los dos casos que ya rompieron la fila "Continuar viendo" en su dia: lo
que la cuenta ya ha visto no se ofrece como siguiente, y el salto de final de
temporada al primero de la siguiente tiene que salir solo.

Se lanza solo, sin framework y sin base de datos:
  PYTHONPATH=backend python3 backend/tests/prueba_siguiente.py
"""
import os, sys, tempfile, types

raiz = tempfile.mkdtemp()
for rel in ["Suits/Temporada 3/3x07.mp4", "Suits/Temporada 3/3x08.mp4",
            "Suits/Temporada 4/4x01.mp4",
            "Dune (2021)/Dune (2021) - 1080p.mp4"]:
    os.makedirs(os.path.join(raiz, os.path.dirname(rel)), exist_ok=True)
    open(os.path.join(raiz, rel), "wb").close()

falso = types.ModuleType("app.routers.download")
falso.config = {"extract_path": raiz}
falso.downloader = None
sys.modules["app.routers.download"] = falso

from app.services.siguiente import (cuantos_bajar, elegir_archivo, episodios_delante,
                                    etiqueta, pendientes_de_bajar, terminados_de)

fallos = []
def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  FALLA ") + que)
    if not ok:
        fallos.append(que)
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")


print("\nLa regla de cuantos bajar")
comprueba("sin nada delante, dos", 2, cuantos_bajar(0))
comprueba("con uno delante, uno", 1, cuantos_bajar(1))
comprueba("con dos delante, ninguno", 0, cuantos_bajar(2))
comprueba("con media temporada delante, ninguno", 0, cuantos_bajar(9))

print("\nQue queda en disco por delante")
comprueba("del 3x07 quedan dos (el 3x08 y el 4x01)",
          ["Suits/Temporada 3/3x08.mp4", "Suits/Temporada 4/4x01.mp4"],
          [r for _, _, r in episodios_delante("Suits/Temporada 3/3x07.mp4", set(), set())])
comprueba("del 3x08 se salta a la temporada siguiente",
          ["Suits/Temporada 4/4x01.mp4"],
          [r for _, _, r in episodios_delante("Suits/Temporada 3/3x08.mp4", set(), set())])
comprueba("del ultimo que hay no queda nada",
          [], episodios_delante("Suits/Temporada 4/4x01.mp4", set(), set()))
comprueba("un episodio ya terminado no se ofrece",
          ["Suits/Temporada 4/4x01.mp4"],
          [r for _, _, r in episodios_delante("Suits/Temporada 3/3x07.mp4",
                                              {"Suits/Temporada 3/3x08.mp4"}, set())])
comprueba("un episodio marcado a mano tampoco",
          ["Suits/Temporada 4/4x01.mp4"],
          [r for _, _, r in episodios_delante("Suits/Temporada 3/3x07.mp4",
                                              set(), {(3, 8)})])
comprueba("una pelicula no tiene siguiente",
          [], episodios_delante("Dune (2021)/Dune (2021) - 1080p.mp4", set(), set()))

print("\nQue se puede bajar")
catalogo = [
    {"message_id": 10, "channel_id": 1, "season": 3, "episode": 7,
     "file_name": "Suits.S03E07.mkv", "file_size": 1_000, "size_str": "1 KB"},
    {"message_id": 11, "channel_id": 1, "season": 3, "episode": 9,
     "file_name": "Suits.S03E09.720p.mkv", "file_size": 1_000, "size_str": "1 KB"},
    {"message_id": 12, "channel_id": 1, "season": 3, "episode": 9,
     "file_name": "Suits.S03E09.1080p.mkv", "file_size": 9_000, "size_str": "9 KB"},
    {"message_id": 13, "channel_id": 1, "season": 3, "episode": 10,
     "file_name": "Suits.S03E10.mkv", "file_size": 2_000, "size_str": "2 KB"},
    {"message_id": 14, "channel_id": 1, "season": 3, "episode": 8,
     "file_name": "Suits.S03E08.mkv", "file_size": 2_000, "size_str": "2 KB"},
    {"message_id": 15, "channel_id": 1, "season": None, "episode": None,
     "file_name": "Suits.Temporada.3.Completa.rar", "file_size": 50_000, "size_str": "50 KB"},
]
en_disco = {(3, 8)}

r = pendientes_de_bajar(catalogo, (3, 7), en_disco, set(), 2)
comprueba("se ofrecen los dos siguientes que no estan en disco",
          ["3x09", "3x10"], [x["label"] for x in r])
comprueba("de dos archivos del mismo episodio se coge el mas grande",
          12, r[0]["message_id"])
comprueba("un pack sin episodio no se cuenta como episodio",
          [9, 10], [x["episode"] for x in r])

r = pendientes_de_bajar(catalogo, (3, 7), en_disco, {(3, 9)}, 2)
comprueba("lo que ya esta bajando no se vuelve a pedir",
          ["3x10"], [x["label"] for x in r])

r = pendientes_de_bajar(catalogo, (3, 9), en_disco, set(), 2)
comprueba("nada hacia atras: desde el 3x09 solo el 3x10",
          ["3x10"], [x["label"] for x in r])

comprueba("sin nada que bajar, lista vacia",
          [], pendientes_de_bajar(catalogo, (3, 10), en_disco, set(), 2))

print("\nDetalles")
comprueba("la etiqueta lleva dos digitos", "3x08", etiqueta(3, 8))
comprueba("sin temporada se nombra el episodio", "Episodio 149", etiqueta(None, 149))
comprueba("el mas grande gana", 12, elegir_archivo(catalogo[1:3])["message_id"])
comprueba("terminado es a partir del 95 %",
          {"a"}, terminados_de([{"path": "a", "position": 96, "duration": 100},
                                {"path": "b", "position": 90, "duration": 100},
                                {"path": "c", "position": 10, "duration": 0}]))

print()
print(f"{21 - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
