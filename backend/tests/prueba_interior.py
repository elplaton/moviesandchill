"""Comprueba `services/interior.py`: ver sin descargar un rar, 7z o zip que
guarda el video tal cual.

Lo que se vigila es que de cada comprimido salgan exactamente los bytes del
video, de punta a punta, aunque esten repartidos entre volumenes con su
cabecera delante (rar) o partidos a bytes (zip, 7z); que lo comprimido, lo
cifrado y los packs de varios episodios **no** se ofrezcan; y que los
volumenes se agrupen y ordenen bien (`.part1.rar`, `.rar` + `.r00`...).

Los comprimidos se fabrican aqui (en local no suele haber `rar`). Con
`ARCHIVOS_REALES=<carpeta>` se miran ademas los de esa carpeta, hechos con
el `rar` oficial (`r5_vol.part1.rar`, `r4_vol.rar`/`.r00`...) y con 7-Zip o
py7zr (`s_copy.7z`, `s_copy_mp4.7z`...), con `peli.mkv` y `peli.mp4` al lado
para comparar.

    PYTHONPATH=backend <venv con telethon>/bin/python backend/tests/prueba_interior.py
"""
import asyncio
import io
import os
import random
import struct
import sys
import zipfile
from pathlib import Path

from app.routers import download
from app.services import interior
from app.services import reproduccion as rp

fallos = []


def comprueba(nombre, esperado, obtenido):
    if esperado == obtenido:
        print(f"  ok  {nombre}")
    else:
        fallos.append(nombre)
        print(f"  MAL {nombre}: esperado {esperado!r:.120}, obtenido {obtenido!r:.120}")


# --- Un Telegram de mentira --------------------------------------------------

class Doc:
    def __init__(self, datos):
        self.datos = datos
        self.size = len(datos)


class Iter:
    def __init__(self, doc, offset, request_size):
        assert offset % request_size == 0, "Telegram exige offsets alineados"
        self.doc, self.pos, self.rs = doc, offset, request_size

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.pos >= self.doc.size:
            raise StopAsyncIteration
        trozo = self.doc.datos[self.pos:self.pos + self.rs]
        self.pos += self.rs
        return trozo

    async def close(self):
        pass


class Cliente:
    def iter_download(self, doc, offset=0, request_size=rp.TROZO, file_size=None):
        return Iter(doc, offset, request_size)

    def is_connected(self):
        return True


class Downloader:
    client = Cliente()


download.downloader = Downloader()
canal: dict[int, Doc] = {}
nombres: dict[int, str] = {}
guardados: dict[int, dict] = {}


async def _documentos(_dl, _channel_id, ids):
    return {i: canal[i] for i in ids if i in canal}


async def _nombre_en_catalogo(_channel_id, message_id):
    return nombres.get(message_id)


async def _guardado(_channel_id, message_id):
    return next((r for vols, r in guardados.values() if message_id in vols), None)


async def _guardar(_channel_id, volumenes, r):
    guardados[volumenes[0]] = (volumenes, r)


async def _volumenes_de(channel_id, nombre):
    filas = [{"channel_id": channel_id, "message_id": m, "file_name": n} for m, n in nombres.items()]
    g = interior.grupo(nombre)
    for clave, vols in interior.agrupar(filas).items():
        if clave == (channel_id, g[0], g[1]):
            return vols
    raise rp.NoReproducible("faltan partes", definitivo=False)


rp._documentos = _documentos
rp._nombre_en_catalogo = _nombre_en_catalogo
interior._guardado = _guardado
interior.guardar = _guardar
interior._volumenes_de = _volumenes_de
interior.PAUSA = 0

_siguiente = [1000]


def publicar(archivos: list[tuple[str, bytes]]) -> list[int]:
    """Sube esos archivos al canal de mentira; devuelve sus mensajes."""
    mids = []
    for nombre, datos in archivos:
        _siguiente[0] += 1
        canal[_siguiente[0]] = Doc(datos)
        nombres[_siguiente[0]] = nombre
        mids.append(_siguiente[0])
    return mids


async def video_de(mid: int) -> bytes:
    """Lo que le llegaria al `<video>` pidiendo ese mensaje."""
    v = await rp.virtual(1, mid, refrescar=True)
    return b"".join([t async for t in rp.leer(v, 0, v.tamano - 1)])


async def resultado_de(mid: int) -> dict:
    vols = await _volumenes_de(1, nombres[mid])
    return await interior.mirar(1, vols)


# --- Fabricar comprimidos ----------------------------------------------------

def mkv_falso(n: int) -> bytes:
    """Un MKV con su cabecera EBML y un Segment que dice lo que mide."""
    ebml = b"\x1a\x45\xdf\xa3" + bytes([0x80 | 10]) + os.urandom(10)
    cuerpo = os.urandom(n)
    segment = b"\x18\x53\x80\x67" + b"\x01" + len(cuerpo).to_bytes(7, "big") + cuerpo
    return ebml + segment


def mp4_falso(n: int) -> bytes:
    ftyp = struct.pack(">I4s", 24, b"ftyp") + b"isom" + b"\0" * 12
    mdat = struct.pack(">I4s", 8 + n, b"mdat") + os.urandom(n)
    moov = struct.pack(">I4s", 8 + 300, b"moov") + os.urandom(300)
    return ftyp + mdat + moov


def _v(n: int) -> bytes:
    out = bytearray()
    while True:
        b, n = n & 0x7F, n >> 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _bloque5(tipo: int, banderas: int, cuerpo: bytes, datos: bytes = b"", extra: bytes = b"") -> bytes:
    """Un bloque de rar5: CRC (a cero: no se comprueba), tamaño de la
    cabecera, tipo, banderas, [tamaño del area extra], [tamaño de los datos],
    lo propio del tipo, el area extra al final, y los datos."""
    if extra:
        banderas |= 0x0001
    if datos:
        banderas |= 0x0002
    h = (_v(tipo) + _v(banderas) + (_v(len(extra)) if extra else b"")
         + (_v(len(datos)) if datos else b"") + cuerpo + extra)
    return b"\0\0\0\0" + _v(len(h)) + h + datos


def rar5(archivos: list[tuple[str, bytes]], volumen: int = 0, metodo: int = 0,
         cifrado: bool = False) -> list[bytes]:
    """Un rar5 (almacenado si `metodo` es 0). Con `volumen`, en volumenes de
    ese tamaño de datos; el archivo que no cabe sigue en el siguiente."""
    trozos = []                       # por volumen: [(nombre, tamaño, datos, antes, despues)]
    actual, libre = [], volumen or 1 << 62
    for nombre, datos in archivos:
        pos = 0
        while True:
            cabe = datos[pos:pos + libre]
            despues = pos + len(cabe) < len(datos)
            actual.append((nombre, len(datos), cabe, pos > 0, despues))
            pos += len(cabe)
            libre -= len(cabe)
            if not despues:
                break
            trozos.append(actual)
            actual, libre = [], volumen
    trozos.append(actual)
    salida = []
    for i, vol in enumerate(trozos):
        b = b"Rar!\x1a\x07\x01\x00" + _bloque5(1, 0, _v(0x0001 if len(trozos) > 1 else 0))
        for nombre, tam, datos, antes, despues in vol:
            n = nombre.encode()
            cuerpo = _v(0) + _v(tam) + _v(0) + _v(metodo << 7) + _v(0) + _v(len(n)) + n
            banderas = (0x0008 if antes else 0) | (0x0010 if despues else 0)
            # Registro de cifrado: tamaño 1, tipo 0x01 (sin datos de verdad).
            extra = _v(1) + _v(0x01) if cifrado else b""
            b += _bloque5(2, banderas, cuerpo, datos, extra)
        b += _bloque5(5, 0, _v(0x0001 if i < len(trozos) - 1 else 0))
        salida.append(b)
    return salida


def rar4(archivos: list[tuple[str, bytes]], volumen: int = 0) -> list[bytes]:
    """Un rar4 almacenado, en volumenes como `rar5`."""
    salida = []
    pendientes = [(n, d, 0) for n, d in archivos]
    while pendientes:
        b = b"Rar!\x1a\x07\x00" + struct.pack("<HBHH", 0, 0x73, 0x0001 if volumen else 0, 13) + b"\0" * 6
        libre = volumen or 1 << 62
        while pendientes and libre:
            nombre, datos, pos = pendientes[0]
            cabe = datos[pos:pos + libre]
            despues = pos + len(cabe) < len(datos)
            n = nombre.encode()
            banderas = 0x8000 | (0x0001 if pos else 0) | (0x0002 if despues else 0)
            b += struct.pack("<HBHH", 0, 0x74, banderas, 32 + len(n))
            b += struct.pack("<IIBIIBBHI", len(cabe), len(datos), 0, 0, 0, 29, 0x30, len(n), 0) + n + cabe
            libre -= len(cabe)
            if despues:
                pendientes[0] = (nombre, datos, pos + len(cabe))
                break
            pendientes.pop(0)
        b += struct.pack("<HBHH", 0, 0x7B, 0x4000, 7)
        salida.append(b)
    return salida


def zip_(archivos: list[tuple[str, bytes, int]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nombre, datos, metodo in archivos:
            z.writestr(nombre, datos, compress_type=metodo)
    return buf.getvalue()


def siete(datos: bytes) -> bytes:
    """Un 7z «almacenado»: firma, la cabecera de inicio con donde esta la del
    final, los datos tal cual y una cabecera final de relleno."""
    fin = os.urandom(40)
    return (b"7z\xbc\xaf\x27\x1c\x00\x04" + b"\0" * 4 + struct.pack("<QQI", len(datos), len(fin), 0)
            + datos + fin)


def partir(datos: bytes, n: int) -> list[bytes]:
    corte = len(datos) // n + 1
    return [datos[i:i + corte] for i in range(0, len(datos), corte)]


async def main():
    print("Que volumenes van juntos")
    for nombre, esperado in [
        ("Peli.part1.rar", ("volumenes", "peli", 1)), ("Peli.part02.rar", ("volumenes", "peli", 2)),
        ("Peli.rar", ("volumenes", "peli", 0)), ("Peli.r00", ("volumenes", "peli", 1)),
        ("Peli.r11", ("volumenes", "peli", 12)), ("Peli.zip.001", ("trozos", "peli.zip", 1)),
        ("Peli.7z.003", ("trozos", "peli.7z", 3)), ("Peli.rar.001", ("trozos", "peli.rar", 1)),
        ("Peli.zip", ("trozos", "peli.zip", 0)), ("Peli.mkv.001", None), ("Peli.mkv", None),
    ]:
        comprueba(f"{nombre} -> {esperado}", esperado, interior.grupo(nombre))
    filas = [{"channel_id": 1, "message_id": i, "file_name": n} for i, n in enumerate(
        ["A.r00", "A.rar", "A.r01", "B.part2.rar", "B.part1.rar", "C.part1.rar", "C.part3.rar"])]
    grupos = {k[2]: [f["file_name"] for f in v] for k, v in interior.agrupar(filas).items()}
    comprueba("el .rar va antes que el .r00", ["A.rar", "A.r00", "A.r01"], grupos.get("a"))
    comprueba(".part1 antes que .part2", ["B.part1.rar", "B.part2.rar"], grupos.get("b"))
    comprueba("con un hueco no se ofrece", None, grupos.get("c"))

    random.seed(3)
    video = mkv_falso(rp.TROZO * 3 + 4321)
    nfo = b"subido por alguien\n" * 20

    print("rar5 almacenado en volumenes (con un .nfo delante)")
    vols = rar5([("leeme.nfo", nfo), ("Peli (2024).mkv", video)], volumen=rp.TROZO + 777)
    mids = publicar([(f"Peli.part{i + 1}.rar", v) for i, v in enumerate(vols)])
    comprueba(f"son {len(vols)} volumenes", True, len(vols) >= 3)
    r = await resultado_de(mids[0])
    comprueba("se puede ver", "ver", r["clase"])
    comprueba("un tramo por volumen", len(vols), len(r.get("tramos", [])))
    comprueba("los bytes son los del video, pidiendo el primero", video, await video_de(mids[0]))
    comprueba("y pidiendo el ultimo volumen", video, await video_de(mids[-1]))

    print("rar4 almacenado, esquema viejo (.rar, .r00, .r01...)")
    vols = rar4([("Peli.avi.nfo", nfo), ("Peli.mkv", video)], volumen=rp.TROZO // 2 + 99)
    mids = publicar([("Vieja.rar", vols[0])] + [(f"Vieja.r{i:02d}", v) for i, v in enumerate(vols[1:])])
    comprueba("se puede ver", "ver", (await resultado_de(mids[1]))["clase"])
    comprueba("los bytes son los del video", video, await video_de(mids[2]))

    print("rar suelto y rar partido a bytes (.rar.001)")
    entero = rar5([("Peli.mkv", video)])[0]
    mid = publicar([("Suelto.rar", entero)])[0]
    comprueba("suelto: los bytes del video", video, await video_de(mid))
    mids = publicar([(f"Partido.rar.{i + 1:03d}", t) for i, t in enumerate(partir(entero, 3))])
    comprueba("partido: los bytes del video", video, await video_de(mids[1]))

    print("Lo que no se ofrece")
    mid = publicar([("Comprimido.rar", rar5([("Peli.mkv", video)], metodo=3)[0])])[0]
    comprueba("rar comprimido", "comprimido", (await resultado_de(mid))["clase"])
    try:
        await rp.virtual(1, mid, refrescar=True)
        comprueba("y «Ver» lo manda a descargar", True, False)
    except rp.NoReproducible as e:
        comprueba("y «Ver» lo manda a descargar", True, "comprimido" in str(e))
    mid = publicar([("Cifrado.rar", rar5([("Peli.mkv", video)], cifrado=True)[0])])[0]
    comprueba("rar con contraseña", "cifrado", (await resultado_de(mid))["clase"])
    eps = [(f"Serie 1x0{i}.mkv", mkv_falso(50000)) for i in range(1, 6)]
    mid = publicar([("Temporada.rar", rar5(eps)[0])])[0]
    comprueba("pack de cinco episodios", "varios", (await resultado_de(mid))["clase"])
    mid = publicar([("Fotos.rar", rar5([("foto.jpg", b"x" * 100)])[0])])[0]
    comprueba("sin video", "sin_video", (await resultado_de(mid))["clase"])

    print("zip")
    z = zip_([("leeme.nfo", nfo, zipfile.ZIP_DEFLATED), ("Peli/Peli.mkv", video, zipfile.ZIP_STORED)])
    mids = publicar([(f"Peli.zip.{i + 1:03d}", t) for i, t in enumerate(partir(z, 3))])
    comprueba("almacenado en partes: los bytes del video", video, await video_de(mids[0]))
    mid = publicar([("Comp.zip", zip_([("Peli.mkv", video, zipfile.ZIP_DEFLATED)]))])[0]
    comprueba("comprimido", "comprimido", (await resultado_de(mid))["clase"])

    print("7z almacenado")
    mids = publicar([(f"Siete.7z.{i + 1:03d}", t) for i, t in enumerate(partir(siete(nfo + video), 3))])
    comprueba("mkv detras de un .nfo: los bytes del video", video, await video_de(mids[2]))
    mp4 = mp4_falso(rp.TROZO * 2 + 55)
    mid = publicar([("Mp4.7z", siete(mp4))])[0]
    comprueba("mp4: los bytes del video", mp4, await video_de(mid))
    mid = publicar([("Pack.7z", siete(b"".join(mp4_falso(40000) for _ in range(4))))])[0]
    comprueba("pack de cuatro mp4", "varios", (await resultado_de(mid))["clase"])
    mid = publicar([("Lzma.7z", b"7z\xbc\xaf\x27\x1c\x00\x04" + b"\0" * 24 + os.urandom(90000))])[0]
    comprueba("7z comprimido", "comprimido", (await resultado_de(mid))["clase"])

    reales = os.environ.get("ARCHIVOS_REALES")
    if reales:
        print(f"Hechos con el rar oficial ({reales})")
        d = Path(reales)
        original = (d / "peli.mkv").read_bytes()
        for patron in ("r5_vol.part*.rar", "r4_vol.r*", "r5_store.rar", "r4_store.rar"):
            archivos = sorted(d.glob(patron))
            if not archivos:
                continue
            mids = publicar([(f"Real{patron.split('.')[0]}.{a.name.split('.', 1)[1]}", a.read_bytes())
                             for a in archivos])
            comprueba(f"{patron}: los bytes de peli.mkv", original, await video_de(mids[0]))
        for nombre, original_de in (("s_copy.7z", "peli.mkv"), ("s_copy_nfo.7z", "peli.mkv"),
                                    ("s_copy_mp4.7z", "peli.mp4")):
            if (d / nombre).exists() and (d / original_de).exists():
                mid = publicar([(f"Real_{nombre}", (d / nombre).read_bytes())])[0]
                comprueba(f"{nombre}: los bytes de {original_de}", (d / original_de).read_bytes(),
                          await video_de(mid))
        for nombre, clase in (("s_lzma2.7z", "comprimido"), ("s_lzma2_mp4.7z", "comprimido"),
                              ("r5_comp.rar", "comprimido"), ("r4_comp.rar", "comprimido"),
                              ("r5_pass.rar", "cifrado"), ("r5_hpass.rar", "cifrado"),
                              ("r4_pass.rar", "cifrado"), ("r4_hpass.rar", "cifrado")):
            if (d / nombre).exists():
                mid = publicar([(f"Real_{nombre}", (d / nombre).read_bytes())])[0]
                comprueba(f"{nombre} -> {clase}", clase, (await resultado_de(mid))["clase"])


asyncio.run(main())
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
