"""Comprueba el HLS al vuelo (services/hls.py) con un ffmpeg de verdad.

Lo que se vigila es lo que hace que saltar funcione: que el trozo N que se
sirve empiece justo en el fotograma clave N de la lista, tanto al empezar
como tras un salto adelante o atras (que reinicia ffmpeg y lo hace caer un
fotograma clave antes), y que el audio vaya con la imagen.

Genera un MKV de prueba con fotogramas clave irregulares y audio AC-3, como
los de verdad. Necesita ffmpeg; sin el, no prueba nada y lo dice.

    PYTHONPATH=backend <venv>/bin/python backend/tests/prueba_hls.py
"""
import asyncio
import os
import shutil
import subprocess
import sys
import tempfile

from app.services import hls, mkv

fallos = []


def comprueba(nombre, esperado, obtenido):
    if esperado == obtenido:
        print(f"  ok  {nombre}")
    else:
        fallos.append(nombre)
        print(f"  MAL {nombre}: esperado {esperado!r}, obtenido {obtenido!r}")


def tfdts(ruta):
    """{pista: segundos} de un trozo, con las escalas de su init."""
    with open(os.path.join(os.path.dirname(ruta), "init.mp4"), "rb") as f:
        init = f.read()
    escalas = {}
    for t, a, z in hls._cajas(init):
        if t == b"moov":
            for t2, a2, z2 in hls._cajas(init, a, z):
                if t2 == b"trak":
                    pista = escala = None
                    for t3, a3, z3 in hls._cajas(init, a2, z2):
                        if t3 == b"tkhd":
                            pista = int.from_bytes(init[a3 + 12:a3 + 16], "big")
                        if t3 == b"mdia":
                            for t4, a4, z4 in hls._cajas(init, a3, z3):
                                if t4 == b"mdhd":
                                    escala = int.from_bytes(init[a4 + 12:a4 + 16], "big")
                    escalas[pista] = escala
    with open(ruta, "rb") as f:
        b = f.read()
    r = {}
    for t, a, z in hls._cajas(b):
        if t == b"moof":
            for t2, a2, z2 in hls._cajas(b, a, z):
                if t2 == b"traf":
                    pista = dt = None
                    for t3, a3, z3 in hls._cajas(b, a2, z2):
                        if t3 == b"tfhd":
                            pista = int.from_bytes(b[a3 + 4:a3 + 8], "big")
                        if t3 == b"tfdt":
                            dt = int.from_bytes(b[a3 + 4:a3 + 12] if b[a3] == 1 else b[a3 + 4:a3 + 8], "big")
                    r.setdefault(pista, dt / escalas[pista])
    return r


async def main(carpeta):
    peli = os.path.join(carpeta, "peli.mkv")
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
         "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "90",
         "-c:v", "libx264", "-preset", "ultrafast", "-g", "120", "-keyint_min", "24",
         "-force_key_frames", "3.7,11.2,19.9,33.1,51.4", "-c:a", "ac3", peli], check=True)
    datos = open(peli, "rb").read()

    async def leer(d, c):
        return datos[d:d + c]

    print("Indice del MKV")
    claves, duracion = await mkv.fotogramas_clave(leer, len(datos))
    reales = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time", "-of", "csv=p=0", peli],
        capture_output=True, text=True).stdout.split()
    reales = [round(float(x.strip(",")), 2) for x in reales if x.strip(",")]
    comprueba("los fotogramas clave son los del video", reales, [round(c, 2) for c in claves])
    comprueba("la duracion", 90, round(duracion))

    print("Trozos")
    d = os.path.join(carpeta, "hls")
    os.makedirs(d)
    s = hls.Sesion(path="tg:1:2", url=peli, claves=claves, duracion=duracion,
                   audio=0, hevc=False, dir=d)
    for n in (0, 1, 7, 8, 15, 3):
        ruta = await hls.trozo(s, n)
        t = tfdts(ruta)
        comprueba(f"el trozo {n} empieza en su fotograma clave ({claves[n]:.2f} s)",
                  round(claves[n], 1), round(t.get(1, -1), 1))
        comprueba(f"y el audio va con la imagen", True, abs(t.get(2, -99) - t.get(1, 0)) < 0.2)
    comprueba("el init existe", True, os.path.isfile(await hls.init(s)))

    print("La lista")
    texto = hls.lista(s, "path=tg%3A1%3A2&token=x")
    comprueba("un trozo por fotograma clave", len(claves), texto.count("#EXTINF"))
    comprueba("cada URI lleva la entrada", len(claves), texto.count(".m4s?path=tg%3A1%3A2&token=x"))
    comprueba("la suma es la pelicula", round(duracion),
              round(sum(s.duracion_de(i) for i in range(s.total))))
    await hls._parar(s)


if not shutil.which("ffmpeg"):
    print("Sin ffmpeg: no se puede probar el HLS al vuelo")
    sys.exit(0)
with tempfile.TemporaryDirectory() as carpeta:
    asyncio.run(main(carpeta))
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
