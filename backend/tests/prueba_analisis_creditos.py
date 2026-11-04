"""Comprueba el analisis de creditos por imagen (services/analisis_creditos.py)
con videos de verdad generados con ffmpeg: 100 s de imagen, 3 s de negro y 40 s
de «creditos» (fondo negro con lineas blancas finas), en MP4 (con el indice al
principio y al final) y MKV, con H.264 y HEVC.

Lo que se prueba es la cadena entera: leer el indice, pedir solo los
fotogramas clave, decodificarlos sueltos y decir donde empiezan los creditos.
Necesita ffmpeg con libx264 y libx265.

    PYTHONPATH=backend python3 backend/tests/prueba_analisis_creditos.py
"""
import asyncio
import os
import shutil
import subprocess
import sys
import tempfile

from app.services import analisis_creditos as ac

fallos = 0


def ver(cond: bool, que: str):
    global fallos
    print(("  ok   " if cond else "  MAL  ") + que)
    if not cond:
        fallos += 1


if not shutil.which("ffmpeg"):
    print("Sin ffmpeg: no se puede probar")
    sys.exit(0)

dir_ = tempfile.mkdtemp()
IMAGEN, NEGRO, CREDITOS = 100, 3, 40
# Lineas de «letras»: trazos cortos (3 px encendidos de cada 7) en franjas de
# 8 px, centradas. Una barra lisa no vale: lo que distingue el texto son sus
# bordes finos.
LETRAS = ("geq=lum='if(between(mod(Y,28),10,17)*between(X,200,440)*between(Y,40,320)*lt(mod(X,7),3),235,16)'"
          ":cb=128:cr=128")
FILTRO = (f"testsrc2=s=640x360:r=24:d={IMAGEN}[a];"
          f"color=c=black:s=640x360:r=24:d={NEGRO}[b];"
          f"color=c=black:s=640x360:r=24:d={CREDITOS},format=yuv420p,{LETRAS}[c];"
          f"[a][b][c]concat=n=3:v=1:a=0,format=yuv420p[v]")


def generar(nombre: str, codec: str, extra: list[str]) -> str:
    ruta = os.path.join(dir_, nombre)
    cod = ["-c:v", "libx264", "-g", "48", "-preset", "veryfast"] if codec == "h264" else \
          ["-c:v", "libx265", "-x265-params", "keyint=48:min-keyint=48:log-level=error", "-preset", "veryfast"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-filter_complex", FILTRO, "-map", "[v]", *cod, *extra, ruta],
                   check=True)
    return ruta


def contador(leer):
    """Envuelve un lector contando bytes y peticiones."""
    cuenta = {"bytes": 0, "peticiones": 0}

    async def leer2(desde, cuanto):
        b = await leer(desde, cuanto)
        cuenta["bytes"] += len(b)
        cuenta["peticiones"] += 1
        return b
    return leer2, cuenta


async def probar(nombre: str, ruta: str):
    print(f"{nombre}")
    leer, tam = ac.lector_archivo(ruta)
    leer, cuenta = contador(leer)
    idx = await ac.indice(leer, tam)
    ver(idx.codec in ("h264", "hevc") and len(idx.claves) >= 50,
        f"indice: {idx.contenedor} {idx.codec}, {len(idx.claves)} fotogramas clave, dura {idx.duracion:.1f}s")
    ver(abs(idx.duracion - (IMAGEN + NEGRO + CREDITOS)) < 1, "la duracion del indice es la del video")
    r = await ac.medir(leer, tam, idx)
    ini = r["inicio"]
    ver(ini is not None and abs(ini - IMAGEN) <= 2.5,
        f"medir: creditos desde {ini} (real {IMAGEN}) · {r['serie']}")
    ok = await ac.comprobar(leer, tam, IMAGEN + 4, idx=idx)
    ver(ok["estado"] == "ok" and abs(ok["inicio"] - IMAGEN) <= 2.5,
        f"comprobar con la prevision 4 s tarde: {ok['estado']} en {ok['inicio']}")
    tarde = await ac.comprobar(leer, tam, IMAGEN + 35, idx=idx)
    ver(tarde["estado"] == "antes", f"prevision 35 s tarde: {tarde['estado']}")
    pronto = await ac.comprobar(leer, tam, IMAGEN - 60, idx=idx)
    ver(pronto["estado"] == "despues", f"prevision 60 s pronto: {pronto['estado']}")
    print(f"       leidos {cuenta['bytes'] / 1e6:.1f} MB de {tam / 1e6:.1f} MB en {cuenta['peticiones']} peticiones")


async def main():
    videos = [
        ("MP4 H.264, indice al principio", generar("a.mp4", "h264", ["-movflags", "+faststart"])),
        ("MP4 H.264, indice al final", generar("b.mp4", "h264", [])),
        ("MKV H.264", generar("c.mkv", "h264", [])),
        ("MKV HEVC", generar("d.mkv", "hevc", [])),
    ]
    for nombre, ruta in videos:
        await probar(nombre, ruta)


print("Reglas")
ver(ac.inicio_creditos([(0, "N"), (10, "N"), (20, "K"), (30, "C"), (40, "C"), (50, "C"), (60, "N")], 15) == 20,
    "el logo del final no impide encontrar el inicio")
ver(ac.inicio_creditos([(0, "N"), (10, "C"), (20, "N"), (30, "N"), (40, "K"), (50, "C"), (60, "C")], 15) == 40,
    "un fotograma oscuro suelto antes no cuenta")
# Animales: creditos con trozos de imagen en medio. Cuenta el principio de la
# zona, no el ultimo tramo.
animales = [(t, "N") for t in range(5900, 5964, 4)] + [(5964, "K"), (5968, "C"), (5972, "C")] + \
           [(t, "C") for t in range(5976, 6100, 4)] + [(t, "N") for t in range(6100, 6140, 4)] + \
           [(t, "C") for t in range(6140, 6300, 4)] + [(t, "N") for t in range(6300, 6320, 4)] + \
           [(t, "C") for t in range(6320, 6491, 4)]
ver(ac.inicio_creditos(animales, 40) == 5964, "creditos con huecos de imagen: cuenta el principio")
ver(ac.inicio_creditos([(t, "N") for t in range(0, 300, 5)] + [(300, "C"), (305, "C")] +
                       [(t, "N") for t in range(310, 600, 5)], 15) is None,
    "una escena oscura en medio de la pelicula no son los creditos")
ver(ac.transicion([(0, "N"), (5, "N"), (10, "K"), (15, "C"), (20, "C"), (25, "N")]) == ("ok", 10),
    "comprobar: el primer paso a creditos")
ver(ac.transicion([(0, "C"), (5, "C"), (10, "C")])[0] == "antes", "comprobar: ya eran creditos")
ver(ac.transicion([(0, "N"), (5, "N"), (10, "C")])[0] == "despues", "comprobar: aun no han empezado")
ver(ac.es_episodio(47 * 60) and not ac.es_episodio(110 * 60), "episodio o pelicula por la duracion")
# Animales en MKV: fotogramas clave cada ~10 s en los creditos y una tarjeta
# con poco texto en medio (antes salia «N» y rompia la comprobacion).
ver(ac.transicion([(5941, "N"), (5958, "N"), (5963, "K"), (5973, "C"), (5983, "N"), (5993, "C")]) == ("ok", 5963),
    "comprobar: con fotogramas cada 10 s basta con dos que abarquen 8 s")
ver(ac.transicion([(0, "N"), (2, "C"), (4, "N"), (6, "N")])[0] == "despues",
    "comprobar: un fotograma suelto no son creditos")
ancho = ac.ANCHO * ac.ALTO
tarjeta = bytearray(b"\x10" * ancho)
for i in range(150):   # dos nombres pequeños: ~0,3 % de pixeles claros, casi sin bordes
    tarjeta[ac.ANCHO * 80 + 120 + i % 75 + (i // 75) * ac.ANCHO * 6] = 220
ver(ac.etiqueta(bytes(tarjeta)) == "C", "una tarjeta casi negra con poco texto son creditos")
noche = bytearray(b"\x18" * ancho)
for i in range(ancho // 10):   # una escena oscura: 10 % de la imagen con algo de luz
    noche[i * 10] = 90
ver(ac.etiqueta(bytes(noche)) == "N", "una escena oscura con luz repartida no son creditos")
# El listado de una pelicula: tres columnas de nombres en lineas de 2 px cada
# 5, que a 320x180 dejan ~85 % oscuro (X-Men 2, Matrix Revolutions).
listado = bytearray(b"\x08" * ancho)
for y in range(10, 170, 5):
    for col in (40, 130, 220):
        for x in range(col, col + 60):
            if (x // 2) % 2 == 0:
                for dy in (0, 1):
                    listado[(y + dy) * ac.ANCHO + x] = 200
o, c, b, n = ac.medidas(bytes(listado))
ver(o < 0.92 and ac.etiqueta(bytes(listado)) == "C", "el listado de nombres que llena la pantalla son creditos")
# Una escena oscura con mucho detalle (hojas, una calle de noche): bordes, pero
# sin fondo negro de verdad.
calle = bytearray(ancho)
for i in range(ancho):
    calle[i] = 30 + (i * 7919) % 60 if (i // 3) % 2 else 28
ver(ac.etiqueta(bytes(calle)) == "N", "una escena oscura con detalle no es un listado")

asyncio.run(main())
shutil.rmtree(dir_, ignore_errors=True)
print()
print(f"{fallos} fallidas" if fallos else "todo bien")
sys.exit(1 if fallos else 0)
