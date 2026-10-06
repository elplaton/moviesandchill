"""Comprueba la fila "Continuar viendo" contra una biblioteca de mentira."""
import datetime, os, sys, tempfile, types

raiz = tempfile.mkdtemp()
# Una serie con cuatro episodios repartidos en dos temporadas, y una pelicula
# con dos calidades (el caso que antes se contaba como una serie de dos).
for rel in ["Suits/Temporada 3/3x07.mp4", "Suits/Temporada 3/3x08.mp4",
            "Suits/Temporada 4/4x01.mp4", "Suits/Temporada 4/4x02.mp4",
            "Dune (2021)/Dune (2021) - 2160p BluRay.mp4",
            "Dune (2021)/Dune (2021) - 1080p.mp4",
            # Estructura antigua: una carpeta por temporada.
            "Lost S1/1x12.mkv", "Lost S2/2x01.mkv"]:
    os.makedirs(os.path.join(raiz, os.path.dirname(rel)), exist_ok=True)
    open(os.path.join(raiz, rel), "wb").close()

# El servicio pide config a app.routers.download; se le da uno de mentira para
# no arrancar FastAPI ni la base de datos.
falso = types.ModuleType("app.routers.download")
falso.config = {"extract_path": raiz}
sys.modules["app.routers.download"] = falso

from app.services.continuar import (continuar_viendo, grupo_de, siguiente_episodio,
                                     temporada_y_episodio)

ahora = datetime.datetime.now()
def fila(path, pos, dur, mins, **extra):
    base = {"path": path, "grupo": grupo_de(path), "position": pos, "duration": dur,
            "updated_at": ahora - datetime.timedelta(minutes=mins), "title": None,
            "subtitle": None, "poster": None, "backdrop": None, "tmdb_id": None,
            "tmdb_type": None}
    s, e = temporada_y_episodio(path)
    base["season"], base["episode"] = s, e
    base.update(extra)
    return base

fallos = []
def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  FALLA ") + que)
    if not ok:
        print(f"         esperaba {esperado!r}\n         obtuvo   {obtenido!r}")
        fallos.append(que)

print("Temporada y episodio del nombre y de la carpeta:")
comprueba("3x07 dentro de Temporada 3", (3, 7), temporada_y_episodio("Suits/Temporada 3/3x07.mp4"))
comprueba("una pelicula no tiene", (None, None), temporada_y_episodio("Dune (2021)/Dune (2021) - 1080p.mp4"))

print("\nSiguiente episodio:")
comprueba("despues del 3x07 va el 3x08", "Suits/Temporada 3/3x08.mp4",
          (siguiente_episodio("Suits/Temporada 3/3x07.mp4") or {}).get("path"))
comprueba("al acabar temporada salta a la siguiente", "Suits/Temporada 4/4x01.mp4",
          (siguiente_episodio("Suits/Temporada 3/3x08.mp4") or {}).get("path"))
comprueba("el ultimo no tiene siguiente", None, siguiente_episodio("Suits/Temporada 4/4x02.mp4"))
comprueba("se salta lo ya visto", "Suits/Temporada 4/4x01.mp4",
          (siguiente_episodio("Suits/Temporada 3/3x07.mp4",
                              {"Suits/Temporada 3/3x08.mp4"}) or {}).get("path"))

print("\nEstructura antigua (una carpeta por temporada):")
comprueba("'Lost S1' y 'Lost S2' son el mismo titulo", ("Lost", "Lost"),
          (grupo_de("Lost S1/1x12.mkv"), grupo_de("Lost S2/2x01.mkv")))
comprueba("el siguiente cruza de carpeta de temporada", "Lost S2/2x01.mkv",
          (siguiente_episodio("Lost S1/1x12.mkv") or {}).get("path"))

r = continuar_viendo([fila("Lost S2/2x01.mkv", 300, 2400, 1),
                      fila("Lost S1/1x12.mkv", 900, 2400, 30)])
comprueba("una sola tarjeta aunque sean dos carpetas", ["Lost S2/2x01.mkv"],
          [t["path"] for t in r])

print("\nLa fila:")
r = continuar_viendo([fila("Suits/Temporada 3/3x07.mp4", 600, 2400, 1)])
comprueba("un episodio a medias se reanuda", ("Suits/Temporada 3/3x07.mp4", 600, False),
          (r[0]["path"], r[0]["position"], r[0]["next_episode"]) if r else None)

r = continuar_viendo([fila("Suits/Temporada 3/3x07.mp4", 2399, 2400, 1)])
comprueba("terminado ofrece el siguiente desde cero", ("Suits/Temporada 3/3x08.mp4", 0.0, True),
          (r[0]["path"], r[0]["position"], r[0]["next_episode"]) if r else None)

r = continuar_viendo([fila("Suits/Temporada 3/3x08.mp4", 300, 2400, 1),
                      fila("Suits/Temporada 3/3x07.mp4", 900, 2400, 30)])
comprueba("una sola tarjeta por serie, la mas reciente", ["Suits/Temporada 3/3x08.mp4"],
          [t["path"] for t in r])

r = continuar_viendo([fila("Suits/Temporada 3/3x07.mp4", 2399, 2400, 1, subtitle="3x07")])
comprueba("la tarjeta del siguiente lleva SU etiqueta, no la del anterior", "3x08",
          r[0]["subtitle"] if r else None)

r = continuar_viendo([fila("Dune (2021)/Dune (2021) - 1080p.mp4", 2399, 2400, 1)])
comprueba("una pelicula terminada desaparece", [], [t["path"] for t in r])

r = continuar_viendo([fila("Dune (2021)/Dune (2021) - 2160p BluRay.mp4", 500, 9000, 1),
                      fila("Dune (2021)/Dune (2021) - 1080p.mp4", 800, 9000, 20)])
comprueba("las dos calidades son un solo titulo", ["Dune (2021)/Dune (2021) - 2160p BluRay.mp4"],
          [t["path"] for t in r])

r = continuar_viendo([fila("Suits/Temporada 3/3x07.mp4", 12, 2400, 1)])
comprueba("abrir y cerrar a los 12 s no cuenta", [], [t["path"] for t in r])

r = continuar_viendo([fila("Suits/Temporada 9/9x99.mp4", 600, 2400, 1)])
comprueba("lo borrado de la biblioteca no sale", [], [t["path"] for t in r])

r = continuar_viendo([fila("Suits/Temporada 4/4x02.mp4", 2399, 2400, 1)])
comprueba("serie terminada sin mas episodios desaparece", [], [t["path"] for t in r])

# Lo marcado como visto a mano: no se ofrece como siguiente aunque este en
# disco y sin reproducir.
r = continuar_viendo([fila("Suits/Temporada 3/3x07.mp4", 2399, 2400, 1, tmdb_id=37680)],
                     20, {37680: {(3, 8)}})
comprueba("un episodio marcado visto no se ofrece como siguiente",
          ["Suits/Temporada 4/4x01.mp4"], [t["path"] for t in r])

r = continuar_viendo([fila("Suits/Temporada 3/3x07.mp4", 2399, 2400, 1, tmdb_id=37680)],
                     20, {37680: {(3, 8), (4, 1), (4, 2)}})
comprueba("con todo lo que queda marcado, el titulo desaparece", [], [t["path"] for t in r])

r = continuar_viendo([fila("Suits/Temporada 3/3x07.mp4", 2399, 2400, 1, tmdb_id=37680)],
                     20, {99999: {(3, 8)}})
comprueba("lo marcado de otra serie no estorba",
          ["Suits/Temporada 3/3x08.mp4"], [t["path"] for t in r])

print()
print(f"{9 + 9 + 3 - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
