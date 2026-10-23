"""Los fotogramas clave de un MP4, leidos de su cabecera (`moov`) y no del video.

Es el gemelo de `mkv.py` para servir un MP4 por HLS (ver services/hls.py): los
trozos tienen que empezar justo en un fotograma clave, porque la imagen se
copia sin recodificar. Un MP4 no trae una lista de tiempos como el indice de
un MKV, sino tablas por muestra que hay que cruzar, todas de la pista de video:

- `stss`: que muestras son fotograma clave (numeradas desde 1).
- `stts`: cuanto dura cada muestra; sumandolas sale su tiempo de decodificacion.
- `ctts`: lo que se retrasa cada una al **mostrarse** respecto a ese tiempo
  (con fotogramas B el orden de decodificar no es el de mostrar).
- `elst`: la lista de edicion, que corre toda la pista. Lo normal es que
  descuente el retraso del primer fotograma para que la imagen empiece en 0.

El tiempo que sale es el de presentacion con la lista de edicion aplicada,
que es el que ve ffmpeg (y ffprobe) al leer el archivo, y por tanto el que
llevan los trozos que fabrica. Lo comprueba `tests/prueba_hls.py` contra
ffprobe con un MP4 con fotogramas B y lista de edicion.

La cabecera puede ir al principio (`-movflags +faststart`) o al final del
archivo: se recorren las cajas de primer nivel leyendo solo sus cabeceras,
asi que da igual. Un MP4 **fragmentado** (`moof`) no tiene estas tablas y
no se sirve por aqui.
"""
import struct

# Una cabecera de dos horas ocupa unos pocos MB; mas que esto no es normal.
MOOV_MAX = 64 * 1024 * 1024


def _cajas(b: bytes, i: int = 0, j: int | None = None):
    """(tipo, inicio de los datos, fin) de las cajas seguidas en `b`."""
    j = len(b) if j is None else j
    while i + 8 <= j:
        tam, tipo = struct.unpack(">I4s", b[i:i + 8])
        cab = 8
        if tam == 1:
            if i + 16 > j:
                return
            tam = struct.unpack(">Q", b[i + 8:i + 16])[0]
            cab = 16
        elif tam == 0:
            tam = j - i
        if tam < cab or i + tam > j:
            return
        yield tipo, i + cab, i + tam
        i += tam


def _hija(b: bytes, a: int, z: int, tipo: bytes) -> tuple[int, int] | None:
    return next(((x, y) for t, x, y in _cajas(b, a, z) if t == tipo), None)


def _ruta(b: bytes, a: int, z: int, *tipos: bytes) -> tuple[int, int] | None:
    for tipo in tipos:
        r = _hija(b, a, z, tipo)
        if not r:
            return None
        a, z = r
    return a, z


def _escala_y_duracion(b: bytes, a: int) -> tuple[int, int]:
    """(timescale, duration) de un `mvhd` o un `mdhd` (misma forma)."""
    if b[a] == 1:
        return struct.unpack(">IQ", b[a + 20:a + 32])
    return struct.unpack(">II", b[a + 12:a + 20])


async def _buscar_moov(leer, tamano_total: int) -> bytes | None:
    pos = 0
    while pos + 8 <= tamano_total:
        cab = await leer(pos, min(16, tamano_total - pos))
        if len(cab) < 8:
            return None
        tam, tipo = struct.unpack(">I4s", cab[:8])
        largo = 8
        if tam == 1:
            if len(cab) < 16:
                return None
            tam = struct.unpack(">Q", cab[8:16])[0]
            largo = 16
        elif tam == 0:
            tam = tamano_total - pos
        if tam < largo:
            return None
        if tipo == b"moof":
            return None   # fragmentado: sin tablas por muestra
        if tipo == b"moov":
            if tam > MOOV_MAX:
                return None
            return await leer(pos + largo, tam - largo)
        pos += tam
    return None


def _desplazamiento(b: bytes, trak: tuple[int, int], escala_peli: int, escala: int) -> float:
    """Segundos que la lista de edicion suma a cada tiempo de presentacion:
    las ediciones vacias del principio retrasan la pista; la primera que no lo
    es dice desde que punto del medio empieza (lo de antes no se ve)."""
    elst = _ruta(b, *trak, b"edts", b"elst")
    if not elst:
        return 0.0
    a, _ = elst
    version = b[a]
    n = struct.unpack(">I", b[a + 4:a + 8])[0]
    i = a + 8
    vacio = 0.0
    for _ in range(n):
        if version == 1:
            dur, media = struct.unpack(">Qq", b[i:i + 16])
            i += 20
        else:
            dur, media = struct.unpack(">Ii", b[i:i + 8])
            i += 12
        if media == -1:
            vacio += dur / escala_peli
            continue
        return vacio - media / escala
    return vacio


def _tiempos(b: bytes, trak: tuple[int, int], escala_peli: int) -> list[float] | None:
    mdia = _hija(b, *trak, b"mdia")
    if not mdia:
        return None
    mdhd = _hija(b, *mdia, b"mdhd")
    stbl = _ruta(b, *mdia, b"minf", b"stbl")
    if not mdhd or not stbl:
        return None
    escala, _ = _escala_y_duracion(b, mdhd[0])
    if not escala:
        return None

    stss = _hija(b, *stbl, b"stss")
    stts = _hija(b, *stbl, b"stts")
    if not stss or not stts:
        # Sin `stss` todas las muestras son clave: un trozo por fotograma, que
        # no tiene sentido servir. Con H.264 o HEVC no pasa.
        return None
    a = stss[0]
    n = struct.unpack(">I", b[a + 4:a + 8])[0]
    claves = list(struct.unpack(f">{n}I", b[a + 8:a + 8 + 4 * n]))
    if not claves:
        return None

    # Tiempo de decodificacion de cada muestra clave, recorriendo `stts` por
    # tramos (muestras seguidas con la misma duracion) en vez de muestra a
    # muestra: una pelicula son cientos de miles.
    a = stts[0]
    n = struct.unpack(">I", b[a + 4:a + 8])[0]
    tramos = struct.unpack(f">{2 * n}I", b[a + 8:a + 8 + 8 * n])
    dts = {}
    k, muestra, t = 0, 1, 0
    for cuantas, delta in zip(tramos[0::2], tramos[1::2]):
        fin = muestra + cuantas
        while k < len(claves) and claves[k] < fin:
            dts[claves[k]] = t + (claves[k] - muestra) * delta
            k += 1
        t += cuantas * delta
        muestra = fin
        if k == len(claves):
            break

    # El retraso de presentacion de cada una (`ctts`), si lo hay.
    retraso: dict[int, int] = {}
    ctts = _hija(b, *stbl, b"ctts")
    if ctts:
        a = ctts[0]
        version = b[a]
        n = struct.unpack(">I", b[a + 4:a + 8])[0]
        # En la version 1 el retraso lleva signo (puede ser negativo).
        formato = f">{2 * n}I" if version == 0 else ">" + "Ii" * n
        tramos = struct.unpack(formato, b[a + 8:a + 8 + 8 * n])
        k, muestra = 0, 1
        for cuantas, desfase in zip(tramos[0::2], tramos[1::2]):
            fin = muestra + cuantas
            while k < len(claves) and claves[k] < fin:
                retraso[claves[k]] = desfase
                k += 1
            muestra = fin
            if k == len(claves):
                break

    corre = _desplazamiento(b, trak, escala_peli, escala)
    tiempos = []
    for c in claves:
        if c not in dts:
            continue
        s = (dts[c] + retraso.get(c, 0)) / escala + corre
        if s > -0.001:
            tiempos.append(max(0.0, s))
    return sorted(set(round(x, 6) for x in tiempos)) or None


async def fotogramas_clave(leer, tamano_total: int) -> tuple[list[float], float] | None:
    """(segundos de cada fotograma clave del video, duracion) o None si el
    archivo no es un MP4 con tablas utilizables.

    `leer(desde, cuanto)` devuelve bytes del archivo.
    """
    moov = await _buscar_moov(leer, tamano_total)
    if not moov:
        return None
    if _hija(moov, 0, len(moov), b"mvex"):
        return None   # fragmentado: las muestras van en los `moof`
    mvhd = _hija(moov, 0, len(moov), b"mvhd")
    if not mvhd:
        return None
    escala_peli, duracion = _escala_y_duracion(moov, mvhd[0])
    if not escala_peli:
        return None

    for tipo, a, z in _cajas(moov):
        if tipo != b"trak":
            continue
        hdlr = _ruta(moov, a, z, b"mdia", b"hdlr")
        if not hdlr or moov[hdlr[0] + 8:hdlr[0] + 12] != b"vide":
            continue
        tiempos = _tiempos(moov, (a, z), escala_peli)
        if not tiempos:
            return None
        return tiempos, duracion / escala_peli
    return None
