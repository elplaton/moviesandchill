"""HLS al vuelo: un MKV de Telegram servido en el formato que el iPhone abre.

Safari no abre MKV ni decodifica AC-3/DTS, que es como viene media biblioteca.
Al descargar se arregla convirtiendo (`make_compatible()`); para verlo sin
descargar, el servidor lo reempaqueta mientras se ve: la imagen se copia tal
cual (H.264 o HEVC, sin gastar CPU) y el audio se pasa a AAC estereo. Se sirve
como HLS, que es el streaming nativo de Apple y deja saltar a cualquier punto.

Lo delicado es saltar. Copiando la imagen, un trozo solo puede empezar en un
fotograma clave, asi que la lista de trozos se arma con los del propio MKV
(su indice, `mkv.fotogramas_clave`): un trozo por fotograma clave. ffmpeg
corta igual (`-hls_time` minimo: corta en cada uno), de modo que el trozo N
de la lista es el trozo N que fabrica. Tres cosas medidas que sostienen eso:

- `-ss` con la imagen copiada arranca un fotograma clave **antes** del pedido.
  No se pelea: se mira el tiempo del primer trozo fabricado (`tfdt`) y se
  numera a partir de ahi (`desfase`).
- Sin `-noaccurate_seek` el audio (que si se decodifica) empieza en el punto
  exacto y la imagen en el fotograma clave anterior: segundos de desfase.
- El muxer fMP4 lleva cada pista a cero e ignora `-copyts`; con
  `movflags=+frag_discont` escribe el tiempo real de la pelicula, que es lo
  que el reproductor necesita para encajar un trozo pedido tras un salto.

Una sesion por archivo: un ffmpeg que va fabricando hacia delante desde donde
se pidio. Pedir un trozo lejos de lo fabricado lo reinicia ahi. Si se adelanta
mucho a lo que se ve se pausa (SIGSTOP), para no bajarse la pelicula entera
de Telegram; lo ya visto se borra.
"""
import asyncio
import logging
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
SESIONES_MAX = 3
INACTIVA_S = 5 * 60


@dataclass
class Sesion:
    path: str
    url: str
    claves: list[float]
    duracion: float
    audio: int | None
    hevc: bool
    dir: str
    proc: asyncio.subprocess.Process | None = None
    run_dir: str = ""
    run_desde: int = 0
    desfase: int | None = None
    listos: dict[int, str] = field(default_factory=dict)
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


def se_puede(pistas: dict | None) -> bool:
    """Si este archivo se puede servir por HLS: MKV con imagen H.264 o HEVC
    (que se copia; lo demas habria que recodificarlo, y eso el servidor no lo
    aguanta en tiempo real)."""
    if not pistas:
        return False
    contenedor = (pistas.get("container") or "").lower()
    codec = ((pistas.get("video") or {}).get("codec") or "").lower()
    return "matroska" in contenedor and codec in ("h264", "hevc")


async def claves_de(v) -> tuple[list[float], float] | None:
    """Los fotogramas clave de un archivo virtual (ver reproduccion.py)."""
    from app.services import mkv, reproduccion

    async def leer(desde: int, cuanto: int) -> bytes:
        trozos = [t async for t in reproduccion.leer(v, desde, desde + cuanto - 1)]
        return b"".join(trozos)

    return await mkv.fotogramas_clave(leer, v.tamano)


def _url_interna(path: str) -> str:
    from app.auth.service import create_stream_token
    from app.config import get_jwt_secret
    from app.routers.download import config

    token = create_stream_token("sistema", path, get_jwt_secret())
    return (f"http://127.0.0.1:{config.get('server_port', 8000)}/api/stream"
            f"?path={quote(path)}&token={quote(token)}")


async def sesion(path: str) -> Sesion:
    s = _sesiones.get(path)
    if s:
        s.usado = time.monotonic()
        return s
    lock = _creando.setdefault(path, asyncio.Lock())
    async with lock:
        s = _sesiones.get(path)
        if s:
            return s
        s = await _crear(path)
        _sesiones[path] = s
        _arrancar_limpiador()
        await _hacer_sitio(path)
        return s


class SinHls(Exception):
    pass


async def _crear(path: str) -> Sesion:
    from app.services import reproduccion

    ids = reproduccion.leer_ruta(path)
    if not ids:
        raise SinHls("ruta no valida")
    r = await reproduccion.comprobar(*ids)
    pistas = r.get("pistas")
    if r.get("modo") != "ver" or not se_puede(pistas):
        raise SinHls("este archivo no se puede adaptar al vuelo")
    v = await reproduccion.virtual(*ids)
    claves = await claves_de(v)
    if not claves:
        raise SinHls("el MKV no trae indice de fotogramas clave")
    tiempos, duracion = claves
    if tiempos[0] > 0.5:
        tiempos = [0.0] + tiempos
    audio = pistas.get("default_audio") if pistas.get("audio") else None
    hevc = ((pistas.get("video") or {}).get("codec") or "").lower() == "hevc"
    duracion = duracion or float(pistas.get("duration") or 0) or tiempos[-1] + 1
    d = os.path.join(DIRECTORIO, path.replace(":", "_").replace("/", "_"))
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    logger.info("HLS al vuelo %s: %d trozos, %.0f min, %s, audio %s",
                v.nombre, len(tiempos), duracion / 60, "HEVC" if hevc else "H.264", audio)
    return Sesion(path=path, url=_url_interna(path), claves=tiempos, duracion=duracion,
                  audio=audio, hevc=hevc, dir=d)


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
    s.desfase = None
    s.run_dir = os.path.join(s.dir, f"r{n}-{int(time.monotonic() * 1000)}")
    os.makedirs(s.run_dir, exist_ok=True)
    numero = max(0, n - 1)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
    if n > 0:
        cmd += ["-noaccurate_seek", "-ss", f"{s.claves[n] + 0.05:.3f}"]
    cmd += ["-i", s.url, "-map", "0:v:0"]
    if s.audio is not None:
        cmd += ["-map", f"0:a:{s.audio}"]
    cmd += ["-c:v", "copy"]
    if s.hevc:
        cmd += ["-tag:v", "hvc1"]
    if s.audio is not None:
        cmd += ["-c:a", "aac", "-ac", "2", "-b:a", "192k"]
    cmd += ["-copyts", "-f", "hls", "-hls_time", "0.1", "-hls_segment_type", "fmp4",
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


def _indice_de(s: Sesion, segundos: float) -> int:
    """El fotograma clave mas cercano a `segundos`."""
    import bisect
    i = bisect.bisect_left(s.claves, segundos)
    candidatos = [c for c in (i - 1, i) if 0 <= c < s.total]
    return min(candidatos, key=lambda c: abs(s.claves[c] - segundos))


def _refrescar(s: Sesion) -> None:
    """Apunta los trozos que ffmpeg ha terminado, con su numero de verdad, y
    pausa o reanuda ffmpeg segun lo lejos que vaya de lo que se ve."""
    if not s.run_dir or not os.path.isdir(s.run_dir):
        return
    hechos = sorted(int(f[1:-4]) for f in os.listdir(s.run_dir)
                    if f.startswith("s") and f.endswith(".m4s"))
    if not hechos:
        return
    if s.desfase is None:
        t = _tfdt_video(os.path.join(s.run_dir, f"s{hechos[0]}.m4s"))
        if t is None:
            return
        s.desfase = _indice_de(s, t) - hechos[0]
        if s.desfase:
            logger.info("HLS al vuelo %s: ffmpeg cayo %d trozos antes de lo previsto", s.path, -s.desfase)
    for j in hechos:
        n = j + s.desfase
        if 0 <= n < s.total:
            s.listos[n] = os.path.join(s.run_dir, f"s{j}.m4s")

    p = s.proc
    if p and p.returncode is None:
        adelanto = max(s.listos) - s.pedido if s.listos else 0
        if not s.pausado and adelanto > ADELANTE_MAX:
            p.send_signal(signal.SIGSTOP)
            s.pausado = True
        elif s.pausado and adelanto < ADELANTE_REANUDA:
            p.send_signal(signal.SIGCONT)
            s.pausado = False

    # Lo que ya quedo atras no vuelve a pedirse casi nunca; si se pide, se fabrica.
    for n in [n for n in s.listos if n < s.pedido - ATRAS]:
        try:
            os.remove(s.listos.pop(n))
        except OSError:
            pass


def _fabricando(s: Sesion, n: int) -> bool:
    """Si el ffmpeg en marcha llegara a `n` pronto sin reiniciarlo."""
    if not s.proc or s.proc.returncode is not None:
        return False
    hasta = max((k for k in s.listos if k >= s.run_desde - 1), default=s.run_desde)
    return s.run_desde - 1 <= n <= hasta + SALTO


async def trozo(s: Sesion, n: int) -> str:
    """La ruta del trozo `n`, fabricandolo si hace falta."""
    if not 0 <= n < s.total:
        raise SinHls("trozo fuera de la pelicula")
    s.usado = time.monotonic()
    s.pedido = n
    limite = time.monotonic() + ESPERA_TROZO
    while True:
        async with s.lock:
            _refrescar(s)
            if n in s.listos and os.path.isfile(s.listos[n]):
                return s.listos[n]
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
            for d in ([s.run_dir] if s.run_dir else []) + [os.path.dirname(r) for r in s.listos.values()]:
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


async def _hacer_sitio(nueva: str) -> None:
    """Como mucho SESIONES_MAX ffmpeg a la vez: se cierra la que lleva mas
    tiempo sin usarse."""
    while len(_sesiones) > SESIONES_MAX:
        vieja = min((p for p in _sesiones if p != nueva), key=lambda p: _sesiones[p].usado)
        await _cerrar(vieja)


def _arrancar_limpiador() -> None:
    global _limpiador
    if _limpiador and not _limpiador.done():
        return
    from app.tasks import spawn

    async def bucle():
        while _sesiones:
            await asyncio.sleep(60)
            ahora = time.monotonic()
            for path in [p for p, s in _sesiones.items() if ahora - s.usado > INACTIVA_S]:
                await _cerrar(path)

    _limpiador = spawn(bucle(), name="hls-limpieza")
