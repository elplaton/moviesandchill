"""Comprueba el HLS al vuelo (services/hls.py) con un ffmpeg de verdad.

Lo que se vigila es lo que hace que saltar funcione: que el trozo N que se
sirve empiece justo en el fotograma clave N de la lista, tanto al empezar
como tras un salto adelante o atras (que reinicia ffmpeg y lo hace caer un
fotograma clave antes), y que el audio vaya con la imagen.

Genera un MKV de prueba con fotogramas clave irregulares y audio AC-3, como
los de verdad, y lo mismo en MP4: con fotogramas B (que es lo que obliga a
leer `ctts` y la lista de edicion) y con la cabecera al principio y al final.
Y un AVI XviD con MP3, como los del catalogo, que no se copia: se recodifica.
Necesita ffmpeg; sin el, no prueba nada y lo dice.

    PYTHONPATH=backend <venv>/bin/python backend/tests/prueba_hls.py
"""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile

from app.services import hls, mkv, mp4

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


CLAVES_FORZADAS = "3.7,11.2,19.9,33.1,51.4"


def generar(carpeta, nombre, video, contenedor=()):
    peli = os.path.join(carpeta, nombre)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
         "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "90",
         "-c:v", "libx264", *video, "-g", "120", "-keyint_min", "24",
         "-force_key_frames", CLAVES_FORZADAS, "-c:a", "ac3", *contenedor, peli], check=True)
    return peli


def claves_ffprobe(peli):
    reales = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time", "-of", "csv=p=0", peli],
        capture_output=True, text=True).stdout.split()
    return [round(float(x.strip(",")), 2) for x in reales if x.strip(",")]


async def probar(carpeta, titulo, peli, lector):
    datos = open(peli, "rb").read()

    async def leer(d, c):
        return datos[d:d + c]

    print(f"Indice ({titulo})")
    claves, duracion = await lector(leer, len(datos))
    comprueba("los fotogramas clave son los del video", claves_ffprobe(peli), [round(c, 2) for c in claves])
    comprueba("la duracion", 90, round(duracion))

    print(f"Trozos ({titulo})")
    d = os.path.join(carpeta, "hls-" + os.path.basename(peli))
    os.makedirs(d)
    s = hls.Sesion(path="tg:1:2", url=peli, claves=claves, duracion=duracion,
                   audio=0, hevc=False, dir=d)
    for n in (0, 1, 7, 8, 15, 3):
        ruta = await hls.trozo(s, n)
        t = tfdts(ruta)
        # El `tfdt` es el tiempo de decodificacion: con fotogramas B va unas
        # centesimas por delante del de presentacion, que es el de la lista.
        comprueba(f"el trozo {n} empieza en su fotograma clave ({claves[n]:.2f} s)",
                  True, abs(claves[n] - t.get(1, -99)) < 0.15)
        comprueba(f"y el audio va con la imagen", True, abs(t.get(2, -99) - t.get(1, 0)) < 0.2)
    comprueba("el init existe", True, os.path.isfile(await hls.init(s)))
    await hls._parar(s)
    return s, claves, duracion, d


async def main(carpeta):
    peli = generar(carpeta, "peli.mkv", ["-preset", "ultrafast"])
    s, claves, duracion, d = await probar(carpeta, "MKV", peli, mkv.fotogramas_clave)

    # Con fotogramas B el primero se muestra despues de decodificarse, y el
    # MP4 lo apunta con `ctts` y una lista de edicion que corre la pista.
    for titulo, nombre, contenedor in (
            ("MP4, cabecera al final", "peli.mp4", ()),
            ("MP4, cabecera al principio", "peli-fs.mp4", ("-movflags", "+faststart"))):
        mp = generar(carpeta, nombre, ["-preset", "veryfast", "-bf", "3"], contenedor)
        await probar(carpeta, titulo, mp, mp4.fotogramas_clave)

    print("MP4 que no se sirven por aqui")
    frag = generar(carpeta, "frag.mp4", ["-preset", "ultrafast"],
                   ("-movflags", "+frag_keyframe+empty_moov+delay_moov"))
    datos = open(frag, "rb").read()

    async def leer(d_, c):
        return datos[d_:d_ + c]
    comprueba("un MP4 fragmentado no da indice", None, await mp4.fotogramas_clave(leer, len(datos)))
    comprueba("un MKV no se toma por MP4", None,
              await mp4.fotogramas_clave(lambda d_, c: _leer_de(peli, d_, c), os.path.getsize(peli)))

    await probar_avi(carpeta)

    print("La lista")
    texto = hls.lista(s, "path=tg%3A1%3A2&token=x")
    comprueba("un trozo por fotograma clave", len(claves), texto.count("#EXTINF"))
    comprueba("cada URI lleva la entrada", len(claves), texto.count(".m4s?path=tg%3A1%3A2&token=x"))
    comprueba("la suma es la pelicula", round(duracion),
              round(sum(s.duracion_de(i) for i in range(s.total))))

    print("Lo adelantado que va ffmpeg")
    # Una tanda anterior llego lejos (sus trozos siguen en `listos`) y se ha
    # vuelto atras: la tanda nueva va justo por donde se mira y no debe
    # pausarse. Antes se median los trozos de todas las tandas, la nueva se
    # pausaba nada mas arrancar y el trozo pedido no llegaba nunca.
    class Proc:
        returncode = None
        def __init__(self):
            self.senales = []
        def send_signal(self, sig):
            self.senales.append(sig)
    s = hls.Sesion(path="tg:1:3", url=peli, claves=claves, duracion=duracion,
                   audio=0, hevc=False, dir=d)
    s.run_dir = os.path.join(d, "r2")
    os.makedirs(s.run_dir)
    for j in (2, 3):
        open(os.path.join(s.run_dir, f"s{j}.m4s"), "wb").close()
    s.listos = {n: os.path.join(d, "viejo", f"s{n}.m4s") for n in range(15, 22)}
    s.proc, s.desfase, s.run_desde, s.pedido = Proc(), 0, 2, 2
    viejo = hls.ADELANTE_MAX
    hls.ADELANTE_MAX = 5
    hls._refrescar(s)
    comprueba("la tanda nueva no se pausa por los trozos de la vieja", [], s.proc.senales)
    comprueba("y sabe hasta donde ha llegado ella", 3, s.hecho)
    for j in range(4, 10):
        open(os.path.join(s.run_dir, f"s{j}.m4s"), "wb").close()
    hls._refrescar(s)
    comprueba("pero si se adelanta de verdad, si", 1, len(s.proc.senales))
    hls.ADELANTE_MAX = viejo


async def probar_avi(carpeta):
    print("AVI (se recodifica)")
    avi = os.path.join(carpeta, "peli.avi")
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc2=size=640x352:rate=25",
         "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "90",
         "-c:v", "mpeg4", "-vtag", "XVID", "-q:v", "4", "-bf", "2",
         "-c:a", "libmp3lame", "-b:a", "128k", avi], check=True)
    info = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,height:format=format_name,duration",
         "-of", "json", avi], capture_output=True, text=True).stdout)
    video = next(x for x in info["streams"] if x["codec_type"] == "video")
    pistas = {"container": info["format"]["format_name"], "duration": info["format"]["duration"],
              "video": {"codec": video["codec_name"], "height": video["height"]}, "audio": [{"codec": "mp3"}]}
    comprueba("un XviD se recodifica", "recodificar", hls.modo(pistas))
    comprueba("un 1080p no", None, hls.modo({**pistas, "video": {"codec": "mpeg4", "height": 1080}}))
    comprueba("un MKV H.264 se copia", "copiar",
              hls.modo({**pistas, "container": "matroska,webm", "video": {"codec": "h264", "height": 1080}}))

    cabeza = open(avi, "rb").read(64 * 1024)
    comprueba("el AVI trae indice", True, hls.avi_con_indice(cabeza))
    i = cabeza.find(b"avih")
    sin = bytearray(cabeza)
    sin[i + 20:i + 24] = b"\0\0\0\0"
    sin = bytes(sin).replace(b"indx", b"JUNK")
    comprueba("y uno sin indice se nota", False, hls.avi_con_indice(sin))
    comprueba("lo que no es AVI no se mira", True, hls.avi_con_indice(b"\x1a\x45\xdf\xa3" + b"\0" * 60))

    duracion = float(pistas["duration"])
    claves = [n * hls.TROZO_S for n in range(int(-(-duracion // hls.TROZO_S)))]
    d = os.path.join(carpeta, "hls-avi")
    os.makedirs(d)
    s = hls.Sesion(path="tg:1:4", url=avi, claves=claves, duracion=duracion,
                   audio=0, hevc=False, dir=d, recodificar=True)
    for n in (0, 1, 7, 8, 15, 3, 22):
        ruta = await hls.trozo(s, n)
        t = tfdts(ruta)
        comprueba(f"el trozo {n} empieza en el segundo {claves[n]}", True, abs(claves[n] - t.get(1, -99)) < 0.15)
        comprueba(f"y el audio va con la imagen", True, abs(t.get(2, -99) - t.get(1, 0)) < 0.2)
    init = open(await hls.init(s), "rb").read()
    comprueba("la imagen sale en H.264", True, b"avc1" in init)
    comprueba("y el audio en AAC", True, b"mp4a" in init)
    await hls._parar(s)


def volumen_medio(init, trozo):
    """El volumen medio (dB) del audio de un trozo fMP4, pegado a su init."""
    junto = trozo + ".junto.mp4"
    with open(junto, "wb") as f:
        f.write(open(init, "rb").read() + open(trozo, "rb").read())
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", junto, "-map", "0:a:0", "-af", "volumedetect",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    for linea in out.splitlines():
        if "mean_volume" in linea:
            return float(linea.split("mean_volume:")[1].split("dB")[0])
    return None


async def probar_idiomas(carpeta):
    """Cambiar de idioma: la sesion con `audio=N` tiene que sonar con la
    pista N. Dos pistas que se distinguen sin oirlas: una casi en silencio y
    otra fuerte."""
    print("Cambiar de idioma (audio=N)")
    peli = os.path.join(carpeta, "dos-audios.mkv")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=20",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=20,volume=0.01",
                    "-f", "lavfi", "-i", "sine=frequency=880:duration=20,volume=0.9",
                    "-map", "0:v", "-map", "1:a", "-map", "2:a",
                    "-c:v", "libx264", "-preset", "ultrafast", "-g", "50", "-c:a", "ac3",
                    "-metadata:s:a:0", "language=spa", "-metadata:s:a:1", "language=eng", peli],
                   check=True)
    datos = open(peli, "rb").read()

    async def leer(d, c):
        return datos[d:d + c]

    claves, duracion = await mkv.fotogramas_clave(leer, len(datos))
    volumenes = {}
    for audio in (0, 1):
        d = os.path.join(carpeta, f"hls-idioma-{audio}")
        os.makedirs(d)
        s = hls.Sesion(path="tg:1:9", url=peli, claves=claves, duracion=duracion,
                       audio=audio, hevc=False, dir=d)
        volumenes[audio] = volumen_medio(await hls.init(s), await hls.trozo(s, 1))
        await hls._parar(s)
    # La "fuerte" no sale a 0 dB (el generador de tonos de ffmpeg no da toda
    # la amplitud, y pasa por AC-3 y AAC); lo que importa es la diferencia.
    print(f"     volumen medio: pista 0 {volumenes[0]} dB, pista 1 {volumenes[1]} dB")
    comprueba("con audio=0 suena la pista 0 y con audio=1 la pista 1", True,
              volumenes[0] is not None and volumenes[1] is not None
              and volumenes[1] - volumenes[0] > 25)
    comprueba("cada idioma es su propia sesion", True,
              hls.clave_sesion("tg:1:9", 1) != hls.clave_sesion("tg:1:9", None))


async def _leer_de(ruta, d, c):
    with open(ruta, "rb") as f:
        f.seek(d)
        return f.read(c)


if not shutil.which("ffmpeg"):
    print("Sin ffmpeg: no se puede probar el HLS al vuelo")
    sys.exit(0)
with tempfile.TemporaryDirectory() as carpeta:
    asyncio.run(main(carpeta))
    asyncio.run(probar_idiomas(carpeta))
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
