"""Comprueba `services/tops.py`: una tarjeta por titulo en el top de Netflix.

El top oficial de Netflix cuenta cada parte o temporada por separado, y una
semana de noviembre de 2026 salio «Lupin» cuatro veces entre las diez series.

    PYTHONPATH=backend python3 backend/tests/prueba_tops.py
"""
import sys

from app.services.tops import juntar_partes

fallos = []


def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok   " if ok else "  MAL  ") + que + ("" if ok else f": esperado {esperado!r}, obtenido {obtenido!r}"))
    if not ok:
        fallos.append(que)


# La semana del 4 de noviembre de 2026, tal cual estaba guardada.
semana = [(335535, "Grande de España", "Temporada 1"), (96677, "Lupin", "Part 4"),
          (333533, "El de Matthew Perry", "Temporada 1"), (96677, "Lupin", "Part 1"),
          (336240, "El intercambio", "Miniserie"), (250923, "Nadie quiere esto", "Temporada 3"),
          (285322, "Bajo la superficie", "Miniserie"), (96677, "Lupin", "Part 3"),
          (96677, "Lupin", "Part 2"), (338689, "La Caída de El Mayo", "Miniserie")]
items = [{"tmdb_id": i, "titulo": t, "subtitulo": s, "puesto": n} for n, (i, t, s) in enumerate(semana, 1)]
r = juntar_partes(items)
comprueba("Lupin sale una vez", 1, sum(1 for x in r if x["titulo"] == "Lupin"))
comprueba("en su mejor puesto", 2, next(x["puesto"] for x in r if x["titulo"] == "Lupin"))
comprueba("con todas sus partes", "Partes 1 a 4", next(x["subtitulo"] for x in r if x["titulo"] == "Lupin"))
comprueba("y los de detras suben", list(range(1, 8)), [x["puesto"] for x in r])
comprueba("el resto, igual", "Temporada 3", next(x["subtitulo"] for x in r if x["titulo"] == "Nadie quiere esto"))
r = juntar_partes([{"tmdb_id": 1, "titulo": "X", "subtitulo": "Part 2"}])
comprueba("una sola parte, en español", "Parte 2", r[0]["subtitulo"])
r = juntar_partes([{"tmdb_id": 1, "titulo": "X", "subtitulo": "Season 1"}, {"tmdb_id": 1, "titulo": "X", "subtitulo": "Season 3"}])
comprueba("temporadas sueltas", "Temporadas 1 y 3", r[0]["subtitulo"])
r = juntar_partes([{"tmdb_id": 0, "titulo": "Sin ficha", "subtitulo": "Part 1"}, {"tmdb_id": 0, "titulo": "Sin ficha", "subtitulo": "Part 2"},
                   {"tmdb_id": 0, "titulo": "Otra", "subtitulo": None}])
comprueba("sin ficha de TMDB, se juntan por titulo", ["Sin ficha", "Otra"], [x["titulo"] for x in r])

print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
