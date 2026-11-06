"""HLS al vuelo: un MKV o MP4 de Telegram servido en un formato que se oye.

Safari no abre MKV, y ni Safari en el iPhone ni Chrome decodifican AC-3/DTS,
que es como viene media biblioteca.
Al descargar se arregla convirtiendo (`make_compatible()`); para verlo sin
descargar, el servidor lo reempaqueta mientras se ve: la imagen se copia tal
cual (H.264 o HEVC, sin gastar CPU) y el audio se pasa a AAC estereo. Se sirve
como HLS, que es el streaming nativo de Apple y deja saltar a cualquier punto.

Lo delicado es saltar. Copiando la imagen, un trozo solo puede empezar en un
fotograma clave, asi que la lista de trozos se arma con los del propio
archivo (el indice del MKV, `mkv.fotogramas_clave`, o las tablas de la
cabecera del MP4, `mp4.fotogramas_clave`): un trozo por fotograma clave. ffmpeg
corta en **todos** los fotogramas clave del video (`-hls_time` minimo), y eso
no es lo mismo: el indice de un MKV puede apuntar solo a algunos. Pasaba con
«2x03 Tulsa King [HDTV 1080p].mkv»: un fotograma clave cada 2 s y una entrada
en el indice cada 6 s, asi que ffmpeg hacia tres piezas por trozo de la lista,
y numerandolas por orden el «trozo 426» (el ultimo, 2554 s) llevaba dentro el
segundo 2259. El reproductor lo cargaba, daba la pelicula por terminada ahi
(en Chrome, hls.js baja la duracion a lo que tiene) y el capitulo «acababa» a
los 35 minutos de 42. Por eso **cada pieza se coloca por su tiempo** (`tfdt`)
y no por su numero, y un trozo de la lista se sirve con todas las piezas que
caen en el (`_refrescar`). Tres cosas medidas que sostienen esto:

- `-ss` con la imagen copiada arranca un fotograma clave **antes** del pedido.
  No se pelea: cada pieza va a donde dice su `tfdt`.
- Sin `-noaccurate_seek` el audio (que si se decodifica) empieza en el punto
  exacto y la imagen en el fotograma clave anterior: segundos de desfase.
- El muxer fMP4 lleva cada pista a cero e ignora `-copyts`; con
  `movflags=+frag_discont` escribe el tiempo real de la pelicula, que es lo
  que el reproductor necesita para encajar un trozo pedido tras un salto.

Lo que no se puede copiar (un AVI, que casi siempre es XviD/DivX: ningun
navegador ni el iPhone lo decodifican) se **recodifica**: la imagen pasa a
H.264. Ahi no hace falta indice, porque los fotogramas clave los pone el
propio ffmpeg donde se le dice: uno cada `TROZO_S`, y el trozo N empieza en
el segundo N*TROZO_S. Solo hasta 720p (`ALTO_MAX`): medido en el servidor, un
XviD de definicion estandar se recodifica a 9 veces el tiempo real con un
solo nucleo; un 1080p cuesta unas cuatro veces mas.

Una sesion por archivo: un ffmpeg que va fabricando hacia delante desde donde
se pidio. Pedir un trozo lejos de lo fabricado lo reinicia ahi. Si se adelanta
mucho a lo que se ve se pausa (SIGSTOP), para no bajarse la pelicula entera
de Telegram; lo ya visto se borra.
"""
import asyncio
import logging
import math
import os
import shutil
import signal
import struct
import time
from dataclasses import dataclass, field
from urllib.parse import quote

logger = logging.getLogger("tmd")

DIRECTORIO = os.path.join(os.environ.get("TMPDIR", "/tmp"), "mc-hls")

# Cuanto se deja fabricar por delante de lo pedido antes de pausar ffmpeg, y
# cuando se le deja seguir (en trozos, que son de un fotograma clave cada uno).
ADELANTE_MAX = 40
ADELANTE_REANUDA = 20
# Pedir un trozo mas alla de esto respecto a lo fabricado reinicia ffmpeg ahi:
# esperar a que llegue costaria mas que empezar de nuevo.
SALTO = 12
# Lo que queda detras de lo pedido y se conserva (volver unos segundos atras).
ATRAS = 30
ESPERA_TROZO = 45
# Cuantas sesiones pueden estar **recodificando** a la vez (AVI, XviD...: x264
# con dos hilos, ~11 % de un nucleo cada una). Las que copian la imagen no
# cuentan: casi no gastan (solo el audio pasa a AAC) y lo que las limita es el
# ancho de banda de Telegram, no el servidor.
RECODIFICANDO_MAX = 6
# Una sesion que recodifica y lleva esto sin que se le pida nada esta cerrada
# o en pausa (un reproductor en marcha pide un trozo cada 4 s): se le puede
# quitar la plaza. Si vuelve, se le arma otra al pedir.
SIN_USO_S = 90
# Recodificando: cada cuanto se pone un fotograma clave (y por tanto un trozo)
# y hasta que alto de imagen se acepta.
TROZO_S = 4
ALTO_MAX = 720
INACTIVA_S = 5 * 60
VIGILA_S = 2


@dataclass
class Sesion:
    path: str
    url: str
    claves: list[float]
    duracion: float
    audio: int | None
    hevc: bool
    dir: str
    recodificar: bool = False
    proc: asyncio.subprocess.Process | None = None
    run_dir: str = ""
    run_desde: int = 0
    # El ultimo trozo que ha hecho **esta** tanda de ffmpeg. No vale mirar
    # `listos`: ahi siguen los trozos de tandas anteriores, y uno lejano hacia
    # creer que la tanda nueva iba muy adelantada (ver `_refrescar`).
    hecho: int = -1
    # Cada trozo de la lista, con las piezas de ffmpeg que lo forman (una si
    # el indice apunta a todos los fotogramas clave; varias si no).
    listos: dict[int, list[str]] = field(default_factory=dict)
    # Pieza de ffmpeg -> (trozo de la lista en el que cae, su tfdt).
    piezas: dict[str, tuple[int, float]] = field(default_factory=dict)
    pedido: int = 0
    pausado: bool = False
    fallos: int = 0
    usado: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def total(self) -> int:
        return len(self.claves)

    def duracion_de(self, i: int) -> float:
        fin = self.claves[i + 1] if i + 1 < self.total else max(self.duracion, self.claves[-1] + 0.5)
        return max(0.001, fin - self.claves[i])


_sesiones: dict[str, Sesion] = {}
_creando: dict[str, asyncio.Lock] = {}
_limpiador: asyncio.Task | None = None


def modo(pistas: dict | None) -> str | None:
    """Como se sirve este archivo por HLS: `copiar` la imagen (MKV o MP4 con
    H.264 o HEVC), `recodificarla` (lo demas, hasta 720p: AVI, XviD...) o
    None si no se puede."""
    if not pistas:
        return None
    contenedor = (pistas.get("container") or "").lower()
    video = pistas.get("video") or {}
    codec = (video.get("codec") or "").lower()
    if not codec:
        return None
    if ("matroska" in contenedor or "mp4" in contenedor) and codec in ("h264", "hevc"):
        return "copiar"
    if 0 < (video.get("height") or 0) <= ALTO_MAX and float(pistas.get("duration") or 0) > 0:
        return "recodificar"
    return None


def se_puede(pistas: dict | None) -> bool:
    return modo(pistas) is not None


async def claves_de(v, pistas: dict | None, leer_local=None) -> tuple[list[float], float] | None:
    """Donde empieza cada trozo de un archivo virtual (ver reproduccion.py).

    Copiando, en sus fotogramas clave: si es MKV o MP4 lo dicen sus primeros
    bytes, no el nombre. Recodificando, cada `TROZO_S` segundos; pero un AVI
    sin indice no vale, porque para saltar ffmpeg tendria que leerlo desde el
    principio (de Telegram)."""
    from app.services import mkv, mp4, reproduccion

    async def leer(desde: int, cuanto: int) -> bytes:
        if leer_local:
            return await leer_local(desde, cuanto)
        trozos = [t async for t in reproduccion.leer(v, desde, desde + cuanto - 1)]
        return b"".join(trozos)

    if modo(pistas) == "recodificar":
        if not avi_con_indice(await leer(0, min(64 * 1024, v.tamano))):
            return None
        duracion = float(pistas.get("duration") or 0)
        return [i * TROZO_S for i in range(math.ceil(duracion / TROZO_S))], duracion
    if (await leer(0, min(4, v.tamano))) == EBML:
        return await mkv.fotogramas_clave(leer, v.tamano)
    return await mp4.fotogramas_clave(leer, v.tamano)


def avi_con_indice(cabeza: bytes) -> bool:
    """Si un archivo que no es AVI, o un AVI que trae indice: `idx1` al final
    (lo dice la bandera AVIF_HASINDEX de su cabecera) o `indx`, el de los AVI
    de mas de 1 GB (OpenDML), que va en la cabecera."""
    if cabeza[:4] != b"RIFF" or cabeza[8:12] != b"AVI ":
        return True
    i = cabeza.find(b"avih")
    if i >= 0 and len(cabeza) >= i + 24:
        if struct.unpack("<I", cabeza[i + 20:i + 24])[0] & 0x10:
            return True
    return b"indx" in cabeza


def _url_interna(path: str) -> str:
    from app.auth.service import create_stream_token
    from app.config import get_jwt_secret
    from app.routers.download import config

    token = create_stream_token("sistema", path, get_jwt_secret())
    return (f"http://127.0.0.1:{config.get('server_port', 8000)}/api/stream"
            f"?path={quote(path)}&token={quote(token)}")


def clave_sesion(path: str, audio: int | None) -> str:
    """Una sesion por archivo **e idioma**: cambiar de idioma es otro ffmpeg
    con otra pista, y el de antes se cierra solo al quedarse sin uso."""
    return path if audio is None else f"{path}#a{audio}"


async def sesion(path: str, audio: int | None = None) -> Sesion:
    """La sesion de un archivo, con la pista de audio `audio` (la posicion
    0:a:N; None = la que toque por idioma)."""
    clave = clave_sesion(path, audio)
    s = _sesiones.get(clave)
    if s:
        s.usado = time.monotonic()
        return s
    lock = _creando.setdefault(clave, asyncio.Lock())
    async with lock:
        s = _sesiones.get(clave)
        if s:
            return s
        s = await _crear(path, audio)
        # Lo que se mira y lo que se cambia va sin ningun await en medio: dos
        # sesiones creandose a la vez no pueden coger la misma plaza.
        sobra = _plaza(s) if s.recodificar else None
        _sesiones[clave] = s
        _arrancar_limpiador()
        if sobra:
            logger.info("HLS al vuelo %s: se cierra %s, sin uso, para dejar sitio", path, sobra)
            await _cerrar(sobra)
        return s


class Lleno(Exception):
    """Ya hay RECODIFICANDO_MAX sesiones recodificando y todas en uso."""


def _plaza(nueva: Sesion) -> str | None:
    """Sitio para una sesion que recodifica. Si estan todas cogidas, la que
    lleve mas tiempo sin usarse deja la suya, pero solo si lleva SIN_USO_S
    parada: a quien esta viendo no se le corta la pelicula para darsela a otro,
    se le dice al que llega que espere (`Lleno`). Devuelve la sesion a cerrar."""
    recodificando = [(c, s) for c, s in _sesiones.items() if s.recodificar]
    if len(recodificando) < RECODIFICANDO_MAX:
        return None
    # El mismo archivo en otro idioma es la misma persona cambiando de pista:
    # la sesion de antes ya no la va a usar.
    for c, s in recodificando:
        if s.path == nueva.path:
            return c
    clave, vieja = min(recodificando, key=lambda cs: cs[1].usado)
    if time.monotonic() - vieja.usado >= SIN_USO_S:
        return clave
    shutil.rmtree(nueva.dir, ignore_errors=True)
    logger.warning("HLS al vuelo %s: rechazado, ya hay %d videos recodificandose a la vez",
                   nueva.path, len(recodificando))
    raise Lleno(f"ya hay {len(recodificando)} videos adaptandose a la vez; prueba en unos minutos")


# Los cuatro primeros bytes de un MKV (la cabecera EBML).
EBML = b"\x1a\x45\xdf\xa3"


class SinHls(Exception):
    pass


@dataclass
class _Local:
    """Un archivo de la biblioteca con la forma que espera `claves_de` (la de
    un virtual de Telegram): nombre, tamaño y como leer un trozo."""
    nombre: str
    tamano: int
    ruta: str

    async def leer(self, desde: int, cuanto: int) -> bytes:
        def _leer():
            with open(self.ruta, "rb") as f:
                f.seek(desde)
                return f.read(cuanto)
        return await asyncio.to_thread(_leer)


def _ruta_local(path: str) -> str:
    """La ruta en disco de un archivo de la biblioteca, con la misma guarda que
    /api/stream: nada fuera de la carpeta de la biblioteca."""
    from app.routers.download import config

    base = os.path.realpath(config["extract_path"])
    target = os.path.realpath(os.path.join(base, path))
    if not target.startswith(base + os.sep) or not os.path.isfile(target):
        raise SinHls("archivo no encontrado en la biblioteca")
    return target


async def _crear(path: str, audio_pedido: int | None = None) -> Sesion:
    """Lo descargado tambien pasa por aqui, aunque se vea tal cual: es la unica
    forma de cambiar de idioma en Chrome y en el Fire TV, que no implementan
    `audioTracks` y siempre hacen sonar la primera pista del archivo."""
    from app.services import reproduccion

    if reproduccion.es_ruta(path):
        ids = reproduccion.leer_ruta(path)
        if not ids:
            raise SinHls("ruta no valida")
        r = await reproduccion.comprobar(*ids)
        pistas = r.get("pistas")
        if r.get("modo") != "ver" or not se_puede(pistas):
            raise SinHls("este archivo no se puede adaptar al vuelo")
        v = await reproduccion.virtual(*ids)
        leer = None
    else:
        from app.services.tracks import leer_pistas, mejor_audio

        ruta = _ruta_local(path)
        pistas = await asyncio.to_thread(leer_pistas, ruta)
        if pistas.get("audio"):
            pistas["default_audio"] = mejor_audio(pistas["audio"])
        if not se_puede(pistas):
            raise SinHls("este archivo no se puede adaptar al vuelo")
        v = _Local(nombre=os.path.basename(ruta), tamano=os.path.getsize(ruta), ruta=ruta)
        leer = v.leer
    recodificar = modo(pistas) == "recodificar"
    claves = await claves_de(v, pistas, leer)
    if not claves:
        raise SinHls("el archivo no trae indice de fotogramas clave")
    tiempos, duracion = claves
    if tiempos[0] > 0.5:
        tiempos = [0.0] + tiempos
    # La pista pedida (al cambiar de idioma) si existe; si no, la de siempre.
    n_audio = len(pistas.get("audio") or [])
    if audio_pedido is not None and 0 <= audio_pedido < n_audio:
        audio = audio_pedido
    else:
        audio = pistas.get("default_audio") if n_audio else None
    hevc = ((pistas.get("video") or {}).get("codec") or "").lower() == "hevc"
    duracion = duracion or float(pistas.get("duration") or 0) or tiempos[-1] + 1
    d = os.path.join(DIRECTORIO, clave_sesion(path, audio_pedido).replace(":", "_").replace("/", "_"))
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    logger.info("HLS al vuelo %s: %d trozos, %.0f min, %s, audio %s",
                v.nombre, len(tiempos), duracion / 60,
                "recodificando " + str((pistas.get("video") or {}).get("codec")) if recodificar
                else "HEVC" if hevc else "H.264", audio)
    return Sesion(path=path, url=_url_interna(path), claves=tiempos, duracion=duracion,
                  audio=audio, hevc=hevc, dir=d, recodificar=recodificar)


# --- La lista ------------------------------------------------------------------

def lista(s: Sesion, consulta: str) -> str:
    """La lista VOD entera, con un trozo por fotograma clave. `consulta` es lo
    que va detras de cada URI (`path` y `token`): el reproductor no lo añade
    solo y sin ello cada trozo seria un 401."""
    objetivo = max(1, int(max(s.duracion_de(i) for i in range(s.total)) + 0.999))
    lineas = ["#EXTM3U", "#EXT-X-VERSION:7", f"#EXT-X-TARGETDURATION:{objetivo}",
              "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-INDEPENDENT-SEGMENTS",
              f'#EXT-X-MAP:URI="init.mp4?{consulta}"']
    for i in range(s.total):
        lineas.append(f"#EXTINF:{s.duracion_de(i):.3f},")
        lineas.append(f"{i}.m4s?{consulta}")
    lineas.append("#EXT-X-ENDLIST")
    return "\n".join(lineas) + "\n"


# --- ffmpeg --------------------------------------------------------------------

async def _parar(s: Sesion) -> None:
    p = s.proc
    s.proc = None
    if p and p.returncode is None:
        try:
            if s.pausado:
                p.send_signal(signal.SIGCONT)
            p.kill()
            await asyncio.wait_for(p.wait(), 5)
        except (ProcessLookupError, asyncio.TimeoutError):
            pass
    s.pausado = False


async def _arrancar(s: Sesion, n: int) -> None:
    """ffmpeg fabricando desde el trozo `n`. Se le pide un pelin despues del
    fotograma clave y con la numeracion uno antes, que es donde cae (ver el
    docstring del modulo); `_refrescar` comprueba donde cayo de verdad."""
    await _parar(s)
    s.run_desde = n
    s.hecho = -1
    s.run_dir = os.path.join(s.dir, f"r{n}-{int(time.monotonic() * 1000)}")
    os.makedirs(s.run_dir, exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
    if s.recodificar:
        # Aqui ffmpeg empieza justo donde se le pide (decodifica desde el
        # fotograma clave de antes y tira lo que sobra), y los fotogramas
        # clave los pone el: uno cada TROZO_S contando desde ahi, que como
        # el punto de partida es multiplo de TROZO_S cae en los de la lista.
        # Sin `-copyts` el tiempo empezaria en 0: `-output_ts_offset` lo
        # devuelve al de la pelicula, que es lo que lleva cada trozo.
        numero = n
        if n > 0:
            cmd += ["-ss", f"{s.claves[n]:.3f}"]
        cmd += ["-i", s.url, "-map", "0:v:0"]
        if s.audio is not None:
            cmd += ["-map", f"0:a:{s.audio}"]
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-force_key_frames", f"expr:gte(t,n_forced*{TROZO_S})", "-threads", "2"]
        tiempo = ["-output_ts_offset", f"{s.claves[n]:.3f}"]
        corte = str(TROZO_S)
    else:
        numero = max(0, n - 1)
        if n > 0:
            cmd += ["-noaccurate_seek", "-ss", f"{s.claves[n] + 0.05:.3f}"]
        cmd += ["-i", s.url, "-map", "0:v:0"]
        if s.audio is not None:
            cmd += ["-map", f"0:a:{s.audio}"]
        cmd += ["-c:v", "copy"]
        if s.hevc:
            cmd += ["-tag:v", "hvc1"]
        tiempo = ["-copyts"]
        corte = "0.1"
    if s.audio is not None:
        cmd += ["-c:a", "aac", "-ac", "2", "-b:a", "192k"]
    cmd += [*tiempo, "-f", "hls", "-hls_time", corte, "-hls_segment_type", "fmp4",
            "-hls_fmp4_init_filename", "init.mp4",
            "-hls_segment_options", "movflags=+frag_discont",
            "-start_number", str(numero),
            "-hls_segment_filename", os.path.join(s.run_dir, "s%d.m4s"),
            "-hls_flags", "temp_file", "-hls_list_size", "0", "-hls_playlist_type", "event",
            os.path.join(s.run_dir, "ffmpeg.m3u8")]
    s.proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    logger.info("HLS al vuelo %s: ffmpeg desde el trozo %d (%.1f s)", s.path, n, s.claves[n])


def _tfdt_video(ruta: str) -> float | None:
    """El tiempo de la primera muestra de imagen de un trozo fMP4 (su `tfdt`),
    en segundos; la escala sale del init de la misma tanda."""
    try:
        with open(os.path.join(os.path.dirname(ruta), "init.mp4"), "rb") as f:
            init = f.read()
        with open(ruta, "rb") as f:
            trozo = f.read(64 * 1024)
    except OSError:
        return None
    escala = _escala_video(init)
    if not escala:
        return None
    for tipo, a, z in _cajas(trozo):
        if tipo != b"moof":
            continue
        for t2, a2, z2 in _cajas(trozo, a, z):
            if t2 != b"traf":
                continue
            pista, dt = None, None
            for t3, a3, z3 in _cajas(trozo, a2, z2):
                if t3 == b"tfhd":
                    pista = struct.unpack(">I", trozo[a3 + 4:a3 + 8])[0]
                elif t3 == b"tfdt":
                    v = trozo[a3]
                    dt = (struct.unpack(">Q", trozo[a3 + 4:a3 + 12])[0] if v == 1
                          else struct.unpack(">I", trozo[a3 + 4:a3 + 8])[0])
            if pista == escala[0] and dt is not None:
                return dt / escala[1]
    return None


def juntar(piezas: list[str]) -> bytes:
    """Un trozo hecho de varias piezas de ffmpeg: sus fragmentos (moof + mdat)
    uno detras de otro, que es un segmento fMP4 valido. La cabecera `styp` de
    cada pieza solo se deja en la primera."""
    salida = bytearray()
    for i, ruta in enumerate(piezas):
        with open(ruta, "rb") as f:
            b = f.read()
        if i and b[4:8] == b"styp":
            b = b[struct.unpack(">I", b[:4])[0]:]
        salida += b
    return bytes(salida)


def _cajas(b: bytes, i: int = 0, j: int | None = None):
    j = len(b) if j is None else j
    while i + 8 <= j:
        tam, tipo = struct.unpack(">I4s", b[i:i + 8])
        cab = 8
        if tam == 1:
            tam = struct.unpack(">Q", b[i + 8:i + 16])[0]
            cab = 16
        elif tam == 0:
            tam = j - i
        if tam < cab:
            return
        yield tipo, i + cab, i + tam
        i += tam


def _escala_video(init: bytes) -> tuple[int, int] | None:
    """(id de pista, escala de tiempo) de la pista de imagen del init."""
    for tipo, a, z in _cajas(init):
        if tipo != b"moov":
            continue
        for t2, a2, z2 in _cajas(init, a, z):
            if t2 != b"trak":
                continue
            pista, escala, es_video = None, None, False
            for t3, a3, z3 in _cajas(init, a2, z2):
                if t3 == b"tkhd":
                    v = init[a3]
                    pista = struct.unpack(">I", init[a3 + 12:a3 + 16] if v == 0 else init[a3 + 20:a3 + 24])[0]
                elif t3 == b"mdia":
                    for t4, a4, z4 in _cajas(init, a3, z3):
                        if t4 == b"mdhd":
                            v = init[a4]
                            escala = struct.unpack(">I", init[a4 + 12:a4 + 16] if v == 0 else init[a4 + 20:a4 + 24])[0]
                        elif t4 == b"hdlr":
                            es_video = init[a4 + 8:a4 + 12] == b"vide"
            if es_video and pista and escala:
                return pista, escala
    return None


# Cuanto puede ir el `tfdt` de una pieza por delante del fotograma clave de la
# lista: es el tiempo de decodificacion, y con fotogramas B va unas centesimas
# antes que el de presentacion. Muy por debajo de la distancia entre dos
# fotogramas clave, que es de segundos.
HOLGURA_S = 0.3


def _tramo_de(s: Sesion, segundos: float) -> int:
    """El trozo de la lista en el que cae una pieza que empieza en `segundos`:
    el ultimo cuyo fotograma clave no es posterior."""
    import bisect
    return max(0, bisect.bisect_right(s.claves, segundos + HOLGURA_S) - 1)


def _refrescar(s: Sesion) -> None:
    """Apunta los trozos de la lista que ya estan enteros y pausa o reanuda
    ffmpeg segun lo lejos que vaya de lo que se ve.

    Cada pieza que fabrica ffmpeg se coloca por su `tfdt`, no por su numero:
    ffmpeg corta en todos los fotogramas clave y la lista solo tiene los del
    indice (ver el docstring del modulo). Un trozo esta entero cuando tiene la
    pieza de su principio y ya hay una pieza de un trozo posterior (o ffmpeg
    ha terminado): hasta entonces le puede faltar el final."""
    if not s.run_dir or not os.path.isdir(s.run_dir):
        return
    hechos = sorted(int(f[1:-4]) for f in os.listdir(s.run_dir)
                    if f.startswith("s") and f.endswith(".m4s"))
    tramos: dict[int, list[tuple[str, float]]] = {}
    ultimo = -1
    for j in hechos:
        ruta = os.path.join(s.run_dir, f"s{j}.m4s")
        if ruta not in s.piezas:
            t = _tfdt_video(ruta)
            if t is None:
                break   # aun no se puede leer: las de despues, tampoco
            s.piezas[ruta] = (_tramo_de(s, t), t)
        n, t = s.piezas[ruta]
        tramos.setdefault(n, []).append((ruta, t))
        ultimo = max(ultimo, n)
    terminado = s.proc is not None and s.proc.returncode == 0
    for n, lista in tramos.items():
        if not 0 <= n < s.total or (n == ultimo and not terminado):
            continue
        # La tanda empezo a mitad de este trozo: le falta el principio.
        if abs(lista[0][1] - s.claves[n]) > HOLGURA_S and not (n == 0 and lista[0][1] < 1):
            continue
        s.listos[n] = [r for r, _ in lista]
        s.hecho = max(s.hecho, n)

    # Lo adelantada que va se mide con lo que ha hecho esta tanda. Con todo
    # `listos` (como estaba) una tanda anterior que hubiera llegado lejos
    # dejaba a la nueva pausada nada mas arrancar: volver al principio tras
    # un salto se quedaba esperando un trozo que no iba a llegar nunca.
    p = s.proc
    if p and p.returncode is None:
        adelanto = s.hecho - s.pedido if s.hecho >= 0 else 0
        if not s.pausado and adelanto > ADELANTE_MAX:
            p.send_signal(signal.SIGSTOP)
            s.pausado = True
        elif s.pausado and adelanto < ADELANTE_REANUDA:
            p.send_signal(signal.SIGCONT)
            s.pausado = False

    # Lo que ya quedo atras no vuelve a pedirse casi nunca; si se pide, se fabrica.
    for n in [n for n in s.listos if n < s.pedido - ATRAS]:
        for ruta in s.listos.pop(n):
            s.piezas.pop(ruta, None)
            try:
                os.remove(ruta)
            except OSError:
                pass


def _fabricando(s: Sesion, n: int) -> bool:
    """Si el ffmpeg en marcha llegara a `n` pronto sin reiniciarlo."""
    if not s.proc or s.proc.returncode is not None:
        return False
    hasta = max(s.hecho, s.run_desde)
    return s.run_desde - 1 <= n <= hasta + SALTO


async def trozo(s: Sesion, n: int) -> list[str]:
    """Las piezas del trozo `n` (en orden: se sirven una detras de otra),
    fabricandolo si hace falta."""
    if not 0 <= n < s.total:
        raise SinHls("trozo fuera de la pelicula")
    s.usado = time.monotonic()
    s.pedido = n
    limite = time.monotonic() + ESPERA_TROZO
    while True:
        async with s.lock:
            _refrescar(s)
            if n in s.listos and all(os.path.isfile(r) for r in s.listos[n]):
                return list(s.listos[n])
            if not _fabricando(s, n):
                if s.proc and s.proc.returncode not in (None, 0):
                    error = (await s.proc.stderr.read()).decode(errors="replace")[-300:] if s.proc.stderr else ""
                    logger.warning("HLS al vuelo %s: ffmpeg fallo (%s): %s", s.path, s.proc.returncode, error.strip())
                    s.fallos += 1
                    if s.fallos > 3:
                        raise SinHls("ffmpeg falla una y otra vez")
                await _arrancar(s, n)
        if time.monotonic() > limite:
            raise SinHls(f"el trozo {n} no ha llegado a tiempo")
        await asyncio.sleep(0.2)


async def init(s: Sesion) -> str:
    """El init de la tanda en marcha (todas las tandas dan el mismo: es la
    descripcion de las pistas). Si no hay ninguna, se arranca por el principio
    o por donde se pidio lo ultimo."""
    limite = time.monotonic() + ESPERA_TROZO
    while True:
        async with s.lock:
            _refrescar(s)
            for d in ([s.run_dir] if s.run_dir else []) + [os.path.dirname(r[0]) for r in s.listos.values() if r]:
                ruta = os.path.join(d, "init.mp4")
                if os.path.isfile(ruta) and s.listos:
                    return ruta
            if not s.proc or s.proc.returncode is not None:
                await _arrancar(s, s.pedido)
        if time.monotonic() > limite:
            raise SinHls("el init no ha llegado a tiempo")
        await asyncio.sleep(0.2)


# --- Limpieza --------------------------------------------------------------------

async def _cerrar(path: str) -> None:
    s = _sesiones.pop(path, None)
    if not s:
        return
    await _parar(s)
    shutil.rmtree(s.dir, ignore_errors=True)
    logger.info("HLS al vuelo %s: sesion cerrada", path)


def _arrancar_limpiador() -> None:
    global _limpiador
    if _limpiador and not _limpiador.done():
        return
    from app.tasks import spawn

    async def bucle():
        # Tambien vigila lo adelantado que va cada ffmpeg. Antes solo se miraba
        # al pedir un trozo, y cuando el reproductor tiene el buffer lleno deja
        # de pedir: ffmpeg seguia sin freno y se bajaba de Telegram la pelicula
        # entera (se vio llegar al trozo 558 de 600 con nadie mirando).
        while _sesiones:
            await asyncio.sleep(VIGILA_S)
            for s in list(_sesiones.values()):
                async with s.lock:
                    _refrescar(s)
            ahora = time.monotonic()
            for path in [p for p, s in _sesiones.items() if ahora - s.usado > INACTIVA_S]:
                await _cerrar(path)

    _limpiador = spawn(bucle(), name="hls-limpieza")
