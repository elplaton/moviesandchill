"""Donde empiezan los creditos de un video, mirando su imagen.

Es la fuente `imagen` de services/creditos.py: lo que se usa cuando ningun
enlace del titulo trae un capitulo de creditos. Se mide **un** enlace (el mas
ligero) y el resultado vale para todos los del titulo, guardado como segundos
antes del final.

**Como, sin bajarse el final del video.** Un video guarda una imagen completa
(fotograma clave) cada pocos segundos y, entre una y otra, solo los cambios.
Para saber si en un momento hay creditos basta con ver esas imagenes
completas, asi que:

1. Se lee el indice del archivo (`indice()`): en un MP4 las tablas del `moov`,
   en un MKV las Cues. Dice en que byte esta cada fotograma clave, cuanto ocupa
   y en que segundo sale, y trae la configuracion del codec (SPS/PPS).
2. Se piden **solo esos trozos** (~70 KB cada uno) y se decodifica cada uno
   suelto con ffmpeg, a 320x180 en gris.
3. Cada fotograma se clasifica (`etiqueta()`): **creditos** (casi todo negro,
   con un poco de claro y bordes finos: letras), **negro** o **imagen**.
4. Se busca donde empieza el tramo de negro/creditos del final.

Medido en *Mass* (MP4, 1,9 Mb/s): 25 MB de Telegram con bloques de 128 KB
frente a 111 MB leyendo los 12 minutos seguidos, y el inicio a 16 s del
capitulo «End Credits». En *Breaking Bad* (MKV HEVC), ~15-20 MB por episodio de
referencia y ~7 MB por comprobacion, con ~3 s de error.

Solo MP4/MOV y MKV con video H.264 o HEVC. Los AVI no: su indice dice donde
esta cada fotograma, pero un XviD suelto necesita la cabecera del video
delante y a veces viene empaquetado (*packed bitstream*); queda para otra vez.

Lo que vale saber al tocar esto:

* **Solo importa donde empiezan.** Lo que venga despues (el logo de la
  productora, una escena tras los creditos) da igual. Exigir que el tramo
  llegue hasta el final hizo fallar media temporada de *Breaking Bad* por el
  logo de 5 s que va detras.
* **Una escena oscura no son creditos.** Un fotograma de creditos es casi
  entero negro (>= 92 %: las letras ocupan poco); las escenas nocturnas que se
  confundian rondaban el 75-90 %.
* **Un IDR suelto por proceso.** Pegados en un solo flujo, ffmpeg toma varios
  fotogramas clave seguidos por la misma imagen (llevan el mismo identificador)
  y de 97 salian 3.
"""
import asyncio
import logging
import struct
import subprocess
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from app.services import mkv as _mkv
from app.services import mp4 as _mp4

logger = logging.getLogger("tmd")

# Version del detector. Al cambiar como se clasifica o se decide, se sube: lo
# medido por imagen con una version anterior deja de valer como «medido» y se
# vuelve a comprobar la proxima vez que alguien abra ese enlace (ver
# services/creditos.consultar). La 2 reconoce tarjetas casi negras con poco
# texto y comprobaciones con fotogramas clave escasos (Animales en MKV, que la
# 1 dio por empezados siete minutos tarde). La 3 mide el principio de la zona
# de creditos y no el ultimo tramo (los de Animales tienen huecos de imagen).
VERSION = 3

Lector = Callable[[int, int], Awaitable[bytes]]   # leer(desde, cuanto) -> bytes

# Lo que se pide a Telegram por peticion al analizar. Un fotograma clave son
# ~70 KB: con los 512 KB del streaming se tiraban dos tercios de cada bloque.
BLOQUE_TG = 128 * 1024

ANCHO, ALTO = 320, 180

# Ventanas: lo que se mira del final, en segundos.
VENTANA_PELICULA = 12 * 60
VENTANA_PELICULA_MAX = 30 * 60        # unos creditos muy largos (Marvel, extendidas)
VENTANA_EPISODIO = 150
VENTANA_EPISODIO_MAX = 5 * 60
MARGEN_COMPROBAR = 30                  # +- alrededor de la prevision
EPISODIO_MAX = 75 * 60                 # mas largo que esto se mira como pelicula

# Tramo de creditos: huecos de imagen que se toleran dentro y largo minimo.
HUECO = 14
MINIMO_EPISODIO = 15
MINIMO_PELICULA = 40
# Comprobacion: fotogramas seguidos de negro/creditos para darla por buena.
SEGUIDOS = 3
# Como mucho un fotograma cada tanto al medir una pelicula: hay MP4 con un
# fotograma clave cada 2 s, y mirarlos todos en 12 minutos costaba el doble
# (Animales, 73 MB) sin ganar nada: los creditos duran minutos.
CADA_PELICULA = 4.0

# A la vez: peticiones a Telegram y ffmpeg decodificando.
PETICIONES = 3
DECODIFICANDO = 2

CODECS_MP4 = {b"avc1": "h264", b"avc3": "h264", b"hvc1": "hevc", b"hev1": "hevc"}
CODECS_MKV = {"V_MPEG4/ISO/AVC": "h264", "V_MPEGH/ISO/HEVC": "hevc"}


class NoAnalizable(Exception):
    """El archivo no se puede analizar por imagen (formato, codec, sin indice)."""


@dataclass
class Clave:
    t: float               # segundo en que se ve
    pos: int               # byte donde empieza (MP4: la muestra; MKV: el cluster)
    tam: int | None = None # MP4: lo que ocupa la muestra
    rel: int | None = None # MKV: donde esta el bloque dentro del cluster, si se sabe


@dataclass
class Indice:
    contenedor: str        # mp4 | mkv
    codec: str             # h264 | hevc
    duracion: float
    params: bytes          # SPS/PPS (y VPS) en Annex B, para poner delante
    largo_nal: int         # bytes del tamaño de cada NAL en las muestras
    claves: list[Clave] = field(default_factory=list)
    pista: int | None = None   # MKV: numero de la pista de video


# --------------------------------------------------------------- codec

def params_de(codec: str, cfg: bytes) -> tuple[bytes, int]:
    """SPS/PPS(/VPS) de un avcC o hvcC, en Annex B, y el largo de los NAL."""
    sc = b"\0\0\0\1"
    out = b""
    if codec == "h264":
        largo = (cfg[4] & 3) + 1
        i = 5
        n_sps = cfg[i] & 31
        i += 1
        for _ in range(n_sps):
            n = struct.unpack(">H", cfg[i:i + 2])[0]
            out += sc + cfg[i + 2:i + 2 + n]
            i += 2 + n
        n_pps = cfg[i]
        i += 1
        for _ in range(n_pps):
            n = struct.unpack(">H", cfg[i:i + 2])[0]
            out += sc + cfg[i + 2:i + 2 + n]
            i += 2 + n
        return out, largo
    largo = (cfg[21] & 3) + 1
    i = 23
    for _ in range(cfg[22]):
        i += 1
        cuantos = struct.unpack(">H", cfg[i:i + 2])[0]
        i += 2
        for _ in range(cuantos):
            n = struct.unpack(">H", cfg[i:i + 2])[0]
            out += sc + cfg[i + 2:i + 2 + n]
            i += 2 + n
    return out, largo


def a_annexb(muestra: bytes, largo: int) -> bytes:
    """De NAL con su tamaño delante (como van en MP4/MKV) a Annex B."""
    out, i = bytearray(), 0
    while i + largo <= len(muestra):
        n = int.from_bytes(muestra[i:i + largo], "big")
        out += b"\0\0\0\1" + muestra[i + largo:i + largo + n]
        i += largo + n
    return bytes(out)


# --------------------------------------------------------------- MP4

def _u32(b: bytes, i: int) -> int:
    return struct.unpack(">I", b[i:i + 4])[0]


def _indice_mp4_de(moov: bytes) -> Indice:
    """Fotogramas clave de la pista de video con su byte, tamaño y segundo.

    El tiempo se calcula como en mp4.py (decodificacion + `ctts` + lista de
    edicion); la posicion cruzando `stsz` (tamaños), `stsc` (cuantas muestras
    por bloque) y `stco`/`co64` (donde empieza cada bloque)."""
    mvhd = _mp4._hija(moov, 0, len(moov), b"mvhd")
    if not mvhd:
        raise NoAnalizable("MP4 sin mvhd")
    escala_peli, dur_peli = _mp4._escala_y_duracion(moov, mvhd[0])
    for tipo, a, z in _mp4._cajas(moov):
        if tipo != b"trak":
            continue
        hdlr = _mp4._ruta(moov, a, z, b"mdia", b"hdlr")
        if not hdlr or moov[hdlr[0] + 8:hdlr[0] + 12] != b"vide":
            continue
        mdia = _mp4._hija(moov, a, z, b"mdia")
        stbl = _mp4._ruta(moov, *mdia, b"minf", b"stbl")
        mdhd = _mp4._hija(moov, *mdia, b"mdhd")
        if not stbl or not mdhd:
            raise NoAnalizable("MP4 sin tablas de muestras")
        escala, _ = _mp4._escala_y_duracion(moov, mdhd[0])

        # Codec y su configuracion.
        stsd = _mp4._hija(moov, *stbl, b"stsd")
        entrada = next(iter(_mp4._cajas(moov, stsd[0] + 8, stsd[1])), None) if stsd else None
        if not entrada or entrada[0] not in CODECS_MP4:
            raise NoAnalizable(f"codec de video no soportado: {entrada[0] if entrada else '?'}")
        codec = CODECS_MP4[entrada[0]]
        cfg = next((moov[x:y] for t, x, y in _mp4._cajas(moov, entrada[1] + 78, entrada[2])
                    if t in (b"avcC", b"hvcC")), None)
        if not cfg:
            raise NoAnalizable("MP4 sin configuracion del codec")
        params, largo = params_de(codec, cfg)

        stss = _mp4._hija(moov, *stbl, b"stss")
        if not stss:
            raise NoAnalizable("MP4 sin lista de fotogramas clave")
        n = _u32(moov, stss[0] + 4)
        claves = list(struct.unpack(f">{n}I", moov[stss[0] + 8:stss[0] + 8 + 4 * n]))
        es_clave = set(claves)

        # Tiempo de decodificacion de cada clave (`stts` por tramos).
        stts = _mp4._hija(moov, *stbl, b"stts")
        n = _u32(moov, stts[0] + 4)
        tramos = struct.unpack(f">{2 * n}I", moov[stts[0] + 8:stts[0] + 8 + 8 * n])
        dts, k, muestra, t = {}, 0, 1, 0
        for cuantas, delta in zip(tramos[0::2], tramos[1::2]):
            fin = muestra + cuantas
            while k < len(claves) and claves[k] < fin:
                dts[claves[k]] = t + (claves[k] - muestra) * delta
                k += 1
            t += cuantas * delta
            muestra = fin

        retraso: dict[int, int] = {}
        ctts = _mp4._hija(moov, *stbl, b"ctts")
        if ctts:
            version = moov[ctts[0]]
            n = _u32(moov, ctts[0] + 4)
            formato = f">{2 * n}I" if version == 0 else ">" + "Ii" * n
            tramos = struct.unpack(formato, moov[ctts[0] + 8:ctts[0] + 8 + 8 * n])
            k, muestra = 0, 1
            for cuantas, desfase in zip(tramos[0::2], tramos[1::2]):
                fin = muestra + cuantas
                while k < len(claves) and claves[k] < fin:
                    retraso[claves[k]] = desfase
                    k += 1
                muestra = fin
                if k == len(claves):
                    break
        corre = _mp4._desplazamiento(moov, (a, z), escala_peli, escala)

        # Byte y tamaño de cada clave.
        stsz = _mp4._hija(moov, *stbl, b"stsz")
        fijo, n_muestras = _u32(moov, stsz[0] + 4), _u32(moov, stsz[0] + 8)
        tams = ([fijo] * n_muestras if fijo else
                struct.unpack(f">{n_muestras}I", moov[stsz[0] + 12:stsz[0] + 12 + 4 * n_muestras]))
        co = _mp4._hija(moov, *stbl, b"stco")
        if co:
            n = _u32(moov, co[0] + 4)
            bloques = struct.unpack(f">{n}I", moov[co[0] + 8:co[0] + 8 + 4 * n])
        else:
            co = _mp4._hija(moov, *stbl, b"co64")
            if not co:
                raise NoAnalizable("MP4 sin posiciones de bloques")
            n = _u32(moov, co[0] + 4)
            bloques = struct.unpack(f">{n}Q", moov[co[0] + 8:co[0] + 8 + 8 * n])
        stsc = _mp4._hija(moov, *stbl, b"stsc")
        n = _u32(moov, stsc[0] + 4)
        sc = struct.unpack(f">{3 * n}I", moov[stsc[0] + 8:stsc[0] + 8 + 12 * n])
        reglas = [(sc[3 * i], sc[3 * i + 1]) for i in range(n)]
        posicion: dict[int, tuple[int, int]] = {}
        muestra = 1
        for i, (primero, por_bloque) in enumerate(reglas):
            ultimo = reglas[i + 1][0] - 1 if i + 1 < len(reglas) else len(bloques)
            for b in range(primero, ultimo + 1):
                o = bloques[b - 1]
                for _ in range(por_bloque):
                    if muestra > n_muestras:
                        break
                    if muestra in es_clave:
                        posicion[muestra] = (o, tams[muestra - 1])
                    o += tams[muestra - 1]
                    muestra += 1

        lista = []
        for c in claves:
            if c in dts and c in posicion:
                s = (dts[c] + retraso.get(c, 0)) / escala + corre
                lista.append(Clave(t=max(0.0, s), pos=posicion[c][0], tam=posicion[c][1]))
        lista.sort(key=lambda x: x.t)
        return Indice("mp4", codec, dur_peli / escala_peli if escala_peli else 0.0,
                      params, largo, lista)
    raise NoAnalizable("MP4 sin pista de video")


async def _indice_mp4(leer: Lector, tamano: int) -> Indice:
    moov = await _mp4._buscar_moov(leer, tamano)
    if not moov:
        raise NoAnalizable("MP4 sin moov (o fragmentado)")
    if _mp4._hija(moov, 0, len(moov), b"mvex"):
        raise NoAnalizable("MP4 fragmentado")
    return _indice_mp4_de(moov)


# --------------------------------------------------------------- MKV

CODEC_ID = 0x86
CODEC_PRIVATE = 0x63A2
CONTENT_ENCODINGS = 0x6D80
CUE_CLUSTER_POS = 0xF1
CUE_RELATIVE_POS = 0xF0
SIMPLEBLOCK = 0xA3
BLOCKGROUP = 0xA0
BLOCK = 0xA1


async def _indice_mkv(leer: Lector, tamano: int) -> Indice:
    """Como `mkv.fotogramas_clave`, pero guardando donde esta cada uno (el
    cluster, y el bloque dentro si las Cues lo dicen) y el CodecPrivate."""
    m = _mkv
    cabeza = await leer(0, min(64 * 1024, tamano))
    seg = next(((d, t) for eid, d, t in m._elementos(cabeza) if eid == m.SEGMENT), None)
    if not seg:
        raise NoAnalizable("MKV sin Segment")
    s0 = seg[0]
    posiciones: dict[int, int] = {}
    en_cabeza: dict[int, bytes] = {}
    for eid, d, t in m._elementos(cabeza, s0):
        if eid == m.SEEKHEAD:
            for sid, sd, st in m._elementos(cabeza, d, min(d + t, len(cabeza))):
                if sid != m.SEEK:
                    continue
                cual = donde = None
                for xid, xd, xt in m._elementos(cabeza, sd, sd + st):
                    if xid == m.SEEK_ID:
                        cual = m._uint(cabeza[xd:xd + xt])
                    elif xid == m.SEEK_POS:
                        donde = m._uint(cabeza[xd:xd + xt])
                if cual is not None and donde is not None:
                    posiciones.setdefault(cual, s0 + donde)
        elif eid in (m.INFO, m.TRACKS) and t != m.DESCONOCIDO and d + t <= len(cabeza):
            en_cabeza[eid] = cabeza[d:d + t]
        elif eid == m.CLUSTER:
            break

    async def elemento(eid: int) -> bytes | None:
        if eid in en_cabeza:
            return en_cabeza[eid]
        pos = posiciones.get(eid)
        if pos is None or pos >= tamano:
            return None
        cab = await leer(pos, min(16, tamano - pos))
        cid, a = m._vint(cab, 0, True)
        tam, b = m._vint(cab, a, False)
        if cid != eid or tam == m.DESCONOCIDO:
            return None
        return await leer(pos + a + b, tam)

    info = await elemento(m.INFO)
    escala, duracion = 1_000_000, 0.0
    if info:
        for eid, d, t in m._elementos(info):
            if eid == m.TIMESTAMP_SCALE:
                escala = m._uint(info[d:d + t]) or escala
            elif eid == m.DURATION:
                duracion = m._float(info[d:d + t])
    duracion = duracion * escala / 1e9

    pistas = await elemento(m.TRACKS)
    if not pistas:
        raise NoAnalizable("MKV sin pistas")
    video = codec = cfg = None
    for eid, d, t in m._elementos(pistas):
        if eid != m.TRACK_ENTRY:
            continue
        num = tipo = cid = cp = None
        codificado = False
        for xid, xd, xt in m._elementos(pistas, d, d + t):
            if xid == m.TRACK_NUMBER:
                num = m._uint(pistas[xd:xd + xt])
            elif xid == m.TRACK_TYPE:
                tipo = m._uint(pistas[xd:xd + xt])
            elif xid == CODEC_ID:
                cid = pistas[xd:xd + xt].decode(errors="ignore")
            elif xid == CODEC_PRIVATE:
                cp = pistas[xd:xd + xt]
            elif xid == CONTENT_ENCODINGS:
                codificado = True
        if tipo == 1:
            if cid not in CODECS_MKV:
                raise NoAnalizable(f"codec de video no soportado: {cid}")
            if codificado:
                # Compresion de cabecera: a cada bloque le faltan bytes.
                raise NoAnalizable("MKV con la pista de video comprimida")
            if not cp:
                raise NoAnalizable("MKV sin CodecPrivate")
            video, codec, cfg = num, CODECS_MKV[cid], cp
            break
    if video is None:
        raise NoAnalizable("MKV sin pista de video")
    params, largo = params_de(codec, cfg)

    cues = await elemento(m.CUES)
    if not cues:
        raise NoAnalizable("MKV sin indice (Cues)")
    claves = []
    for eid, d, t in m._elementos(cues):
        if eid != m.CUE_POINT:
            continue
        cuando = None
        posiciones_cue = []
        for xid, xd, xt in m._elementos(cues, d, d + t):
            if xid == m.CUE_TIME:
                cuando = m._uint(cues[xd:xd + xt])
            elif xid == m.CUE_TRACK_POSITIONS:
                pista = cpos = rpos = None
                for yid, yd, yt in m._elementos(cues, xd, xd + xt):
                    if yid == m.CUE_TRACK:
                        pista = m._uint(cues[yd:yd + yt])
                    elif yid == CUE_CLUSTER_POS:
                        cpos = m._uint(cues[yd:yd + yt])
                    elif yid == CUE_RELATIVE_POS:
                        rpos = m._uint(cues[yd:yd + yt])
                posiciones_cue.append((pista, cpos, rpos))
        for pista, cpos, rpos in posiciones_cue:
            if pista == video and cpos is not None and cuando is not None:
                claves.append(Clave(t=cuando * escala / 1e9, pos=s0 + cpos, rel=rpos))
    claves.sort(key=lambda x: x.t)
    return Indice("mkv", codec, duracion, params, largo, claves, pista=video)


async def _bloque_mkv(leer: Lector, idx: Indice, c: Clave) -> bytes | None:
    """El fotograma del video en el cluster de `c`: el bloque que dicen las
    Cues o, si no lo dicen, el primero de la pista de video (mkvmerge empieza
    cada cluster en un fotograma clave)."""
    m = _mkv
    # Lo justo para ver la cabecera del cluster y del primer bloque; si el
    # fotograma es mas grande se pide el resto mas abajo.
    buf = await leer(c.pos, 32 * 1024)
    try:
        _, a = m._vint(buf, 0, True)
        _, b = m._vint(buf, a, False)
    except (IndexError, ValueError):
        return None
    i = a + b + (c.rel or 0)
    while i < len(buf) - 8:
        try:
            eid, x = m._vint(buf, i, True)
            tam, y = m._vint(buf, i + x, False)
        except (IndexError, ValueError):
            return None
        ini = i + x + y
        if tam == m.DESCONOCIDO:
            return None
        if eid in (SIMPLEBLOCK, BLOCKGROUP):
            fin = ini + tam
            if fin > len(buf):
                buf += await leer(c.pos + len(buf), fin - len(buf))
            if eid == BLOCKGROUP:
                sub = next(((d, t) for e, d, t in m._elementos(buf, ini, fin) if e == BLOCK), None)
                if not sub:
                    i = fin
                    continue
                ini, fin = sub[0], sub[0] + sub[1]
            pista, z = m._vint(buf, ini, False)
            if pista == idx.pista:
                banderas = buf[ini + z + 2]
                if banderas & 0x06:
                    return None   # con «lacing»: no pasa en video, y no se sabe partir
                return buf[ini + z + 3:fin]
        i = ini + tam
    return None


# --------------------------------------------------------------- comun

async def indice(leer: Lector, tamano: int) -> Indice:
    """El indice del video. Que es lo dicen los primeros bytes, no el nombre."""
    cabeza = await leer(0, 4)
    if cabeza == b"\x1a\x45\xdf\xa3":
        return await _indice_mkv(leer, tamano)
    return await _indice_mp4(leer, tamano)


async def _fotograma(leer: Lector, idx: Indice, c: Clave) -> bytes | None:
    if idx.contenedor == "mp4":
        muestra = await leer(c.pos, c.tam)
    else:
        muestra = await _bloque_mkv(leer, idx, c)
    if not muestra:
        return None
    return idx.params + a_annexb(muestra, idx.largo_nal)


def decodificar(codec: str, annexb: bytes) -> bytes | None:
    """Un fotograma clave suelto -> ANCHO x ALTO bytes en gris."""
    try:
        r = subprocess.run(
            ["ffmpeg", "-v", "error", "-f", codec, "-i", "-", "-frames:v", "1",
             "-vf", f"scale={ANCHO}:{ALTO},format=gray", "-f", "rawvideo", "-"],
            input=annexb, capture_output=True, timeout=60)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    tam = ANCHO * ALTO
    return r.stdout[:tam] if len(r.stdout) >= tam else None


def medidas(px: bytes) -> tuple[float, float, float]:
    """(fraccion oscura, fraccion clara, bordes) de un fotograma en gris."""
    n = len(px)
    oscuro = sum(1 for p in px if p < 50) / n
    claro = sum(1 for p in px if p > 120) / n
    bordes = 0
    for y in range(0, ALTO, 2):
        f = px[y * ANCHO:(y + 1) * ANCHO]
        bordes += sum(1 for i in range(ANCHO - 1) if abs(f[i] - f[i + 1]) > 40)
    return oscuro, claro, bordes / (n / 2)


def etiqueta(px: bytes) -> str:
    """'C' creditos, 'K' negro o 'N' imagen.

    Dos formas de ser creditos: casi todo negro (>= 92 %) con letras (bordes
    finos), o **casi entero negro** (>= 97 %) con un poco de claro aunque
    apenas tenga bordes: una tarjeta con dos nombres pequeños. Sin la segunda,
    en *Animales* una tarjeta asi salia como imagen y, con un fotograma clave
    cada 10 s, rompia la comprobacion. Las escenas oscuras que se confundian
    rondaban el 75-90 %, asi que no llegan."""
    oscuro, claro, bordes = medidas(px)
    if oscuro >= 0.985 and claro < 0.001:
        return "K"
    if oscuro >= 0.97 and 0.001 <= claro <= 0.05:
        return "C"
    if oscuro >= 0.92 and 0.001 <= claro <= 0.08 and bordes >= 0.004:
        return "C"
    return "N"


async def mirar(leer: Lector, idx: Indice, desde: float, hasta: float,
                cada: float = 0.0) -> list[tuple[float, str]]:
    """Etiqueta de los fotogramas clave entre `desde` y `hasta` (uno cada
    `cada` segundos como mucho)."""
    elegidas, ultimo = [], -1e9
    for c in idx.claves:
        if desde <= c.t <= hasta and c.t - ultimo >= cada:
            elegidas.append(c)
            ultimo = c.t
    sem_red = asyncio.Semaphore(PETICIONES)
    sem_cpu = asyncio.Semaphore(DECODIFICANDO)

    async def uno(c: Clave):
        async with sem_red:
            datos = await _fotograma(leer, idx, c)
        if not datos:
            return None
        async with sem_cpu:
            px = await asyncio.to_thread(decodificar, idx.codec, datos)
        return (c.t, etiqueta(px)) if px else None

    hechos = await asyncio.gather(*(uno(c) for c in elegidas))
    return [h for h in hechos if h]


# Desde el inicio de los creditos hasta el final, al menos esta parte tiene
# que ser negro o creditos.
FRACCION_CREDITOS = 0.7


def inicio_creditos(serie: list[tuple[float, str]], minimo: float) -> float | None:
    """Donde empiezan los creditos finales: el primer punto desde el que al
    menos FRACCION_CREDITOS de lo que queda hasta el final es negro o
    creditos, empezando con dos fotogramas seguidos de negro/creditos y con
    al menos `minimo` segundos por delante. Lo de despues da igual.

    Antes era «el ultimo tramo largo», y unos creditos con trozos de imagen
    en medio (tarjetas de colores, logos: Animales) se partian y se tomaba el
    ultimo trozo, minutos despues del principio."""
    n = len(serie)
    cuantos = [0] * (n + 1)   # cuantos negro/creditos hay desde i hasta el final
    for i in range(n - 1, -1, -1):
        cuantos[i] = cuantos[i + 1] + (serie[i][1] in "CK")
    for i in range(n - 1):
        if serie[i][1] not in "CK" or serie[i + 1][1] not in "CK":
            continue
        if i > 0 and serie[i - 1][1] in "CK":
            continue   # no es el principio de un tramo
        if serie[-1][0] - serie[i][0] < minimo:
            break
        if cuantos[i] / (n - i) >= FRACCION_CREDITOS:
            return serie[i][0]
    return None


# Con fotogramas clave escasos (en unos creditos casi fijos hay uno cada 10 s)
# tres seguidos pueden ser medio minuto: dos que abarquen esto tambien valen.
TRAMO_MINIMO_S = 8.0


def transicion(serie: list[tuple[float, str]], seguidos: int = SEGUIDOS) -> tuple[str, float | None]:
    """El primer paso de imagen a negro/creditos con `seguidos` fotogramas de
    negro/creditos detras (o dos que abarquen TRAMO_MINIMO_S): ('ok',
    segundo). 'antes' si la ventana ya empieza en creditos y 'despues' si no
    se llega a ver."""
    for i in range(len(serie)):
        j = i
        while j < len(serie) and serie[j][1] in "CK":
            j += 1
        n = j - i
        if n >= seguidos or (n >= 2 and serie[j - 1][0] - serie[i][0] >= TRAMO_MINIMO_S):
            return ("antes", serie[0][0]) if i == 0 else ("ok", serie[i][0])
    return "despues", None


def es_episodio(duracion: float) -> bool:
    return 0 < duracion <= EPISODIO_MAX


async def medir(leer: Lector, tamano: int, idx: Indice | None = None) -> dict:
    """Donde empiezan los creditos de un video, mirando su final.

    Devuelve {inicio, duracion, fotogramas, serie}. Si la ventana entera son
    creditos (unos muy largos) se amplia hacia atras hasta el maximo."""
    idx = idx or await indice(leer, tamano)
    if not idx.claves or not idx.duracion:
        raise NoAnalizable("sin fotogramas clave en el indice")
    episodio = es_episodio(idx.duracion)
    ventana = VENTANA_EPISODIO if episodio else VENTANA_PELICULA
    maximo = VENTANA_EPISODIO_MAX if episodio else VENTANA_PELICULA_MAX
    minimo = MINIMO_EPISODIO if episodio else MINIMO_PELICULA
    cada = 0.0 if episodio else CADA_PELICULA
    hasta, desde = idx.duracion, max(0.0, idx.duracion - ventana)
    serie = await mirar(leer, idx, desde, hasta, cada)
    while True:
        inicio = inicio_creditos(serie, minimo)
        empieza_en_creditos = bool(serie) and serie[0][1] in "CK" and inicio == serie[0][0]
        if not empieza_en_creditos or idx.duracion - desde >= maximo or desde <= 0:
            break
        nuevo = max(0.0, idx.duracion - min(maximo, (idx.duracion - desde) * 2))
        serie = await mirar(leer, idx, nuevo, desde - 0.001, cada) + serie
        desde = nuevo
    return {"inicio": inicio, "duracion": idx.duracion, "fotogramas": len(serie),
            "serie": "".join(e for _, e in serie)}


async def comprobar(leer: Lector, tamano: int, previsto: float,
                    margen: float = MARGEN_COMPROBAR, idx: Indice | None = None) -> dict:
    """Si los creditos empiezan donde se preveia: mira solo +-`margen` y
    devuelve {estado: ok|antes|despues, inicio, duracion}. Con `ok`, `inicio`
    es el medido (no la prevision)."""
    idx = idx or await indice(leer, tamano)
    serie = await mirar(leer, idx, previsto - margen, previsto + margen + 15)
    estado, inicio = transicion(serie)
    return {"estado": estado, "inicio": inicio, "duracion": idx.duracion,
            "serie": "".join(e for _, e in serie)}


# --------------------------------------------------------------- lectores

def lector_archivo(ruta: str) -> tuple[Lector, int]:
    """Para un archivo en disco (las pruebas, y lo descargado)."""
    import os

    tamano = os.path.getsize(ruta)

    async def leer(desde: int, cuanto: int) -> bytes:
        def _leer():
            with open(ruta, "rb") as f:
                f.seek(desde)
                return f.read(cuanto)
        return await asyncio.to_thread(_leer)
    return leer, tamano


# Bloques de Telegram que se guardan mientras se analiza un archivo. Leer el
# indice son muchas lecturas pequeñas seguidas (cabeceras de 16 bytes) y un
# bloque MKV se pide en dos veces: sin esto cada una volvia a pedir a Telegram
# el mismo bloque de 128 KB.
BLOQUES_EN_MEMORIA = 64


async def lector_tg(path: str) -> tuple[Lector, int]:
    """Para un enlace `tg:<canal>:<msg>`: lee de Telegram con bloques
    alineados de BLOQUE_TG, sin pasar por /api/stream, y recuerda los ultimos
    BLOQUES_EN_MEMORIA. `leer.bytes_telegram` dice cuanto se ha pedido."""
    from collections import OrderedDict
    from app.services import reproduccion

    ids = reproduccion.leer_ruta(path)
    if not ids:
        raise NoAnalizable("ruta de Telegram no valida")
    v = await reproduccion.virtual(*ids)
    cache: OrderedDict[int, bytes] = OrderedDict()
    gastado = {"bytes": 0}

    async def bloque(n: int) -> bytes:
        if n in cache:
            cache.move_to_end(n)
            return cache[n]
        desde = n * BLOQUE_TG
        hasta = min(desde + BLOQUE_TG, v.tamano) - 1
        trozos = [t async for t in reproduccion.leer(v, desde, hasta, bloque=BLOQUE_TG)]
        datos = b"".join(trozos)
        gastado["bytes"] += len(datos)
        cache[n] = datos
        while len(cache) > BLOQUES_EN_MEMORIA:
            cache.popitem(last=False)
        return datos

    async def leer(desde: int, cuanto: int) -> bytes:
        cuanto = min(cuanto, v.tamano - desde)
        if cuanto <= 0:
            return b""
        primero, ultimo = desde // BLOQUE_TG, (desde + cuanto - 1) // BLOQUE_TG
        datos = b"".join([await bloque(n) for n in range(primero, ultimo + 1)])
        ini = desde - primero * BLOQUE_TG
        return datos[ini:ini + cuanto]

    leer.gastado = gastado
    return leer, v.tamano
