"""Los fotogramas clave de un MKV, leidos de su indice (Cues) y no del video.

Para servir un MKV al iPhone por HLS (ver services/hls.py) los trozos tienen
que empezar justo en un fotograma clave: la imagen se copia sin recodificar y
un trozo no puede empezar en cualquier sitio. Saber donde estan recorriendo el
video entero seria bajar la pelicula; pero el MKV ya los trae apuntados en su
indice, que mkvmerge escribe con una entrada por fotograma clave del video.

Solo se lee lo necesario, con `leer(desde, cuanto)` (unos KB al principio y el
indice, que suele estar al final): el archivo puede estar en Telegram.
"""
import struct

SEGMENT = 0x18538067
SEEKHEAD = 0x114D9B74
SEEK = 0x4DBB
SEEK_ID = 0x53AB
SEEK_POS = 0x53AC
INFO = 0x1549A966
TIMESTAMP_SCALE = 0x2AD7B1
DURATION = 0x4489
TRACKS = 0x1654AE6B
TRACK_ENTRY = 0xAE
TRACK_NUMBER = 0xD7
TRACK_TYPE = 0x83
CUES = 0x1C53BB6B
CUE_POINT = 0xBB
CUE_TIME = 0xB3
CUE_TRACK_POSITIONS = 0xB7
CUE_TRACK = 0xF7
CLUSTER = 0x1F43B675

DESCONOCIDO = -1


def _vint(buf: bytes, i: int, es_id: bool) -> tuple[int, int]:
    """Un entero de longitud variable de EBML: (valor, bytes que ocupa)."""
    primero = buf[i]
    largo = 1
    mascara = 0x80
    while largo <= 8 and not primero & mascara:
        mascara >>= 1
        largo += 1
    if largo > 8:
        raise ValueError("EBML no valido")
    valor = primero if es_id else primero & (mascara - 1)
    for b in buf[i + 1:i + largo]:
        valor = (valor << 8) | b
    if not es_id and valor == (1 << (7 * largo)) - 1:
        valor = DESCONOCIDO
    return valor, largo


def _elementos(buf: bytes, desde: int = 0, hasta: int | None = None):
    """(id, inicio de los datos, tamaño) de los elementos seguidos en `buf`."""
    i, fin = desde, len(buf) if hasta is None else hasta
    while i < fin:
        try:
            eid, a = _vint(buf, i, True)
            tam, b = _vint(buf, i + a, False)
        except (IndexError, ValueError):
            return
        datos = i + a + b
        yield eid, datos, tam
        if tam == DESCONOCIDO:
            return
        i = datos + tam


def _uint(buf: bytes) -> int:
    return int.from_bytes(buf, "big") if buf else 0


def _float(buf: bytes) -> float:
    if len(buf) == 4:
        return struct.unpack(">f", buf)[0]
    if len(buf) == 8:
        return struct.unpack(">d", buf)[0]
    return 0.0


async def fotogramas_clave(leer, tamano_total: int) -> tuple[list[float], float] | None:
    """(segundos de cada fotograma clave del video, duracion) o None si el
    archivo no es un MKV con indice utilizable.

    `leer(desde, cuanto)` devuelve bytes del archivo.
    """
    cabeza = await leer(0, min(64 * 1024, tamano_total))
    seg = next(((d, t) for eid, d, t in _elementos(cabeza) if eid == SEGMENT), None)
    if not seg:
        return None
    seg_inicio = seg[0]

    # Donde esta cada cosa lo dice el SeekHead, que va al principio.
    posiciones: dict[int, int] = {}
    en_cabeza: dict[int, bytes] = {}
    for eid, d, t in _elementos(cabeza, seg_inicio):
        if eid == SEEKHEAD:
            for sid, sd, st in _elementos(cabeza, d, min(d + t, len(cabeza))):
                if sid != SEEK:
                    continue
                cual, donde = None, None
                for xid, xd, xt in _elementos(cabeza, sd, sd + st):
                    if xid == SEEK_ID:
                        cual = _uint(cabeza[xd:xd + xt])
                    elif xid == SEEK_POS:
                        donde = _uint(cabeza[xd:xd + xt])
                if cual is not None and donde is not None:
                    posiciones.setdefault(cual, seg_inicio + donde)
        elif eid in (INFO, TRACKS) and t != DESCONOCIDO and d + t <= len(cabeza):
            en_cabeza[eid] = cabeza[d:d + t]
        elif eid == CLUSTER:
            break

    async def elemento(eid: int) -> bytes | None:
        if eid in en_cabeza:
            return en_cabeza[eid]
        pos = posiciones.get(eid)
        if pos is None or pos >= tamano_total:
            return None
        cab = await leer(pos, min(16, tamano_total - pos))
        cid, a = _vint(cab, 0, True)
        tam, b = _vint(cab, a, False)
        if cid != eid or tam == DESCONOCIDO:
            return None
        return await leer(pos + a + b, tam)

    info = await elemento(INFO)
    escala, duracion = 1_000_000, 0.0
    if info:
        for eid, d, t in _elementos(info):
            if eid == TIMESTAMP_SCALE:
                escala = _uint(info[d:d + t]) or escala
            elif eid == DURATION:
                duracion = _float(info[d:d + t])
    duracion = duracion * escala / 1e9

    pistas = await elemento(TRACKS)
    video = None
    if pistas:
        for eid, d, t in _elementos(pistas):
            if eid != TRACK_ENTRY:
                continue
            numero, tipo = None, None
            for xid, xd, xt in _elementos(pistas, d, d + t):
                if xid == TRACK_NUMBER:
                    numero = _uint(pistas[xd:xd + xt])
                elif xid == TRACK_TYPE:
                    tipo = _uint(pistas[xd:xd + xt])
            if tipo == 1:
                video = numero
                break

    indice = await elemento(CUES)
    if not indice:
        return None
    tiempos = []
    for eid, d, t in _elementos(indice):
        if eid != CUE_POINT:
            continue
        cuando, pistas_cue = None, []
        for xid, xd, xt in _elementos(indice, d, d + t):
            if xid == CUE_TIME:
                cuando = _uint(indice[xd:xd + xt])
            elif xid == CUE_TRACK_POSITIONS:
                for yid, yd, yt in _elementos(indice, xd, xd + xt):
                    if yid == CUE_TRACK:
                        pistas_cue.append(_uint(indice[yd:yd + yt]))
        if cuando is not None and (video is None or not pistas_cue or video in pistas_cue):
            tiempos.append(cuando * escala / 1e9)
    tiempos = sorted(set(tiempos))
    if not tiempos:
        return None
    return tiempos, duracion

