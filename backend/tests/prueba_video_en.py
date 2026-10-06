"""Comprueba `video_en()`: de lo que posee una descarga al archivo que se puede
reproducir.

Existe por un fallo concreto: `downloads.folder_path` no siempre es un archivo
—lo anterior a que cada calidad tuviera el suyo, y todo lo que adopta
`adopt_orphans()`, posee la **carpeta** de la pelicula—, esa ruta acababa tal
cual en el `<video>` del cliente y `/api/stream` contestaba 404 porque no es un
archivo. El sintoma era "no se ha podido abrir el video" al darle a una
pelicula que habia bajado otro (es decir, antes).
"""
import os
import sys
import tempfile

from app.services.layout import video_en

raiz = tempfile.mkdtemp()


def crear(rel: str, tamaño: int = 10):
    ruta = os.path.join(raiz, rel)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "wb") as f:
        f.write(b"\0" * tamaño)
    return ruta


# Una pelicula con su carpeta (lo que adopta adopt_orphans) y subtitulos al lado
peli = crear("Dune (2021)/Dune (2021).mp4", 900)
crear("Dune (2021)/Dune (2021).es.vtt", 5)
# Una pelicula con dos calidades en la misma carpeta (lo de antes)
crear("Blade Runner (1982)/Blade Runner (1982) - 2160p BluRay.mkv", 2000)
crear("Blade Runner (1982)/Blade Runner (1982) - 1080p.mkv", 800)
# Una serie con sus temporadas: la carpeta de arriba y la de la temporada
crear("Suits/Temporada 1/1x02.mkv", 500)
crear("Suits/Temporada 1/1x01.mkv", 400)
crear("Suits/Temporada 2/2x01.mkv", 400)
# Una carpeta sin video
os.makedirs(os.path.join(raiz, "Vacia"), exist_ok=True)
crear("Vacia/leeme.txt")

fallos = []


def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok    " if ok else "  FALLA ") + que)
    if not ok:
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")
        fallos.append(que)


comprueba("un archivo se devuelve tal cual", peli, video_en(peli))
comprueba("la carpeta de una pelicula da su video", peli,
          video_en(os.path.join(raiz, "Dune (2021)")))
comprueba("los subtitulos de al lado no cuentan como video", ".mp4",
          os.path.splitext(video_en(os.path.join(raiz, "Dune (2021)")) or "")[1])
# Con dos calidades vale cualquiera: es la misma pelicula. Por orden
# alfabetico sale la de 1080p.
comprueba("con dos calidades da una de las dos",
          os.path.join(raiz, "Blade Runner (1982)/Blade Runner (1982) - 1080p.mkv"),
          video_en(os.path.join(raiz, "Blade Runner (1982)")))
# Lo importante de ordenar por nombre y no por tamaño: empezar por el primero.
comprueba("la carpeta de una temporada empieza por el 1x01",
          os.path.join(raiz, "Suits/Temporada 1/1x01.mkv"),
          video_en(os.path.join(raiz, "Suits/Temporada 1")))
comprueba("la carpeta de la serie baja hasta la primera temporada",
          os.path.join(raiz, "Suits/Temporada 1/1x01.mkv"),
          video_en(os.path.join(raiz, "Suits")))
comprueba("una carpeta sin video no da nada", None,
          video_en(os.path.join(raiz, "Vacia")))
comprueba("una ruta que no existe no da nada", None,
          video_en(os.path.join(raiz, "No existe")))
comprueba("una ruta vacia no da nada", None, video_en(""))

print()
print(f"{9 - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
