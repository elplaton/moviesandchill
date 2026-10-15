"""Ver una pelicula sin descargarla: el archivo se lee de Telegram mientras se ve.

Es lo que hace Telegram Desktop al reproducir sin bajar: pide los trozos del
archivo (`upload.getFile`, lo mismo que una descarga) en el orden en que el
reproductor los necesita. Aqui el reproductor es el `<video>` de cada cliente,
que pide tramos de bytes a `/api/stream`; cuando la ruta es `tg:<canal>:<msg>`
esos tramos salen de Telegram en vez del disco, y no se guarda nada.

Que se puede ver asi lo dice primero el nombre (`clasificar`) y despues una
comprobacion que lee unos KB del archivo (`comprobar`), guardada en la tabla
`reproduccion` para no repetirla:

- un video suelto (`.mp4`, `.mkv`...) se sirve tal cual;
- unas partes sin comprimir (`Peli.mkv.001`, `.002`...) se sirven como si
  fueran un solo archivo, pidiendo a cada parte su tramo;
- un zip (`Peli.zip`, `Peli.zip.001`...) solo si guarda el video **sin
  comprimir**, que es lo normal con video (no gana nada comprimiendolo): el
  video esta entero en algun punto de las partes y la cabecera dice donde;
- lo comprimido de verdad (rar, 7z, zip con deflate) hay que descargarlo.

Que el aparato entienda el video (MP4 en el iPhone, AAC y no AC-3...) se mira
con ffprobe sobre el propio stream y se le dice al cliente, que decide.
"""
import asyncio
import json
import logging
import re
import struct
import time
from dataclasses import dataclass, field

from app.services.storage import _detect_multipart

logger = logging.getLogger("tmd")

PREFIJO = "tg:"

# Lo que se pide a Telegram por peticion. 512 KB porque es lo que acepta
# `iter_download` (recorta cualquier tamaño mayor), y alineado a eso para que
# ningun trozo cruce un limite de 1 MB.
TROZO = 512 * 1024

EXT_VIDEO = (".mp4", ".mkv", ".avi", ".mov", ".m4v", ".webm", ".ts", ".wmv", ".flv")

MIME = {"mkv": "video/x-matroska", "mp4": "video/mp4", "m4v": "video/mp4", "mov": "video/quicktime",
        "avi": "video/x-msvideo", "webm": "video/webm", "ts": "video/mp2t", "wmv": "video/x-ms-wmv",
        "flv": "video/x-flv"}

# Sube cuando cambia lo que se guarda en `reproduccion`: lo guardado con otra
# version se vuelve a comprobar (la 2 añadio `hls` a las pistas).
VERSION = 2

# Cuanto vale lo leido de Telegram (mensajes con su referencia de archivo, que
# caduca a las horas) y el archivo virtual armado a partir de ellos.
VIRTUAL_TTL = 20 * 60


# --- Rutas tg:<canal>:<mensaje> ---------------------------------------------

def ruta(channel_id: int, message_id: int) -> str:
    return f"{PREFIJO}{int(channel_id)}:{int(message_id)}"


def es_ruta(path: str | None) -> bool:
    return bool(path) and path.startswith(PREFIJO)


def leer_ruta(path: str) -> tuple[int, int] | None:
    m = re.fullmatch(r"tg:(-?\d+):(\d+)", path or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


# --- Lo que dice el nombre ---------------------------------------------------

def clasificar(file_name: str | None) -> str | None:
    """`video`, `partes`, `zip`, `comprimido` o None (no es video).

    Solo el nombre: es lo que se puede decir de las 250.000 entradas del
    catalogo sin preguntar nada a Telegram. `zip` queda pendiente de mirar por
    dentro (`comprobar`).
    """
    if not file_name:
        return None
    nombre = file_name.lower()
    base, _parte, tipo = _detect_multipart(file_name)
    if base is not None:
        b = base.lower()
        if tipo in ("rar", "7z"):
            return "comprimido"
        if b.endswith(".zip"):
            return "zip"
        if b.endswith(EXT_VIDEO):
            return "partes"
        if b.endswith((".rar", ".7z")):
            return "comprimido"
        return None
    if nombre.endswith(EXT_VIDEO):
        return "video"
    if nombre.endswith(".zip"):
        return "zip"
    if nombre.endswith((".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2")):
        return "comprimido"
    return None


def se_puede_intentar(file_name: str | None) -> bool:
    """Si se ofrece "Ver" en vez de "Descargar", solo por la extension.

    Un zip queda fuera aunque `_video_en_zip` sepa servir uno sin comprimir:
    lo que se pidio es que la extension decida antes de pulsar, y que "Ver"
    no acabe en "pues estaba comprimido". Todo zip, rar o 7z se descarga.
    """
    return clasificar(file_name) in ("video", "partes")


# --- El archivo virtual ------------------------------------------------------

@dataclass
class Tramo:
    channel_id: int
    message_id: int
    documento: object
    tamano: int
    desde: int          # donde empieza dentro de las partes concatenadas


@dataclass
class Virtual:
    nombre: str
    tramos: list[Tramo]
    inicio: int         # donde empieza el video dentro de lo concatenado
    tamano: int         # cuanto mide el video
    ext: str
    clave: tuple[int, int] = (0, 0)   # el (canal, mensaje) con el que se pidio
    creado: float = field(default_factory=time.monotonic)

    @property
    def mime(self) -> str:
        return MIME.get(self.ext, "application/octet-stream")


class NoReproducible(Exception):
    """El archivo no se puede ver sin descargarlo; el mensaje dice por que.

    `definitivo` dice si vale la pena guardarlo: "esta comprimido" lo es,
    "Telegram no esta conectado" o "falta una parte" (que puede indexarse
    despues) no.
    """

    def __init__(self, motivo: str, definitivo: bool = True):
        super().__init__(motivo)
        self.definitivo = definitivo


_virtuales: dict[tuple[int, int], Virtual] = {}
_armando: dict[tuple[int, int], asyncio.Lock] = {}


def _downloader():
    from app.routers.download import downloader
    if downloader is None or downloader.client is None:
        raise NoReproducible("Telegram no esta conectado", definitivo=False)
    return downloader


async def _entidad(dl, channel_id: int):
    ch = dl.channels.get(channel_id)
    if ch:
        return ch["entity"]
    return await dl.client.get_entity(dl._resolve_channel_id(channel_id))


async def _documentos(dl, channel_id: int, ids: list[int]) -> dict[int, object]:
    mensajes = await dl.client.get_messages(await _entidad(dl, channel_id), ids=ids)
    docs = {}
    for m in mensajes or []:
        d = getattr(getattr(m, "media", None), "document", None)
        if m is not None and d is not None:
            docs[m.id] = d
    return docs


async def _partes(channel_id: int, message_id: int, file_name: str) -> list[tuple[int, int, str]]:
    """(parte, message_id, nombre) de todas las partes, en orden, o error si
    falta alguna: con un hueco el video se cortaria a mitad."""
    from app.services.telegram_client import _partes_en_catalogo

    base, parte, _tipo = _detect_multipart(file_name)
    if base is None:
        return [(0, message_id, file_name)]
    encontradas = {parte: (message_id, file_name)}
    for r in await _partes_en_catalogo(channel_id, base):
        b, p, _ = _detect_multipart(r["file_name"])
        if b and b.lower() == base.lower() and p not in encontradas:
            encontradas[p] = (r["message_id"], r["file_name"])
    numeros = sorted(encontradas)
    primera = numeros[0]
    if numeros != list(range(primera, primera + len(numeros))):
        faltan = sorted(set(range(primera, numeros[-1] + 1)) - set(numeros))
        raise NoReproducible(f"faltan partes en el canal ({', '.join(map(str, faltan))})", definitivo=False)
    return [(p, *encontradas[p]) for p in numeros]


async def _nombre_en_catalogo(channel_id: int, message_id: int) -> str | None:
    from app.database.connection import get_pool
    pool = get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT file_name FROM media_items WHERE channel_id = $1 AND message_id = $2",
            channel_id, message_id)


async def virtual(channel_id: int, message_id: int, refrescar: bool = False) -> Virtual:
    """El video de ese mensaje como un archivo continuo, armado una vez y
    recordado unos minutos (cada tramo que pide el `<video>` lo necesita)."""
    clave = (channel_id, message_id)
    v = _virtuales.get(clave)
    if v and not refrescar and time.monotonic() - v.creado < VIRTUAL_TTL:
        return v
    lock = _armando.setdefault(clave, asyncio.Lock())
    async with lock:
        v = _virtuales.get(clave)
        if v and not refrescar and time.monotonic() - v.creado < VIRTUAL_TTL:
            return v
        v = await _armar(channel_id, message_id)
        v.clave = clave
        _virtuales[clave] = v
        return v


async def _armar(channel_id: int, message_id: int) -> Virtual:
    dl = _downloader()
    nombre = await _nombre_en_catalogo(channel_id, message_id)
    if not nombre:
        docs = await _documentos(dl, channel_id, [message_id])
        d = docs.get(message_id)
        if d is None:
            raise NoReproducible("el mensaje ya no tiene archivo")
        nombre = next((a.file_name for a in d.attributes if getattr(a, "file_name", None)), "")
    tipo = clasificar(nombre)
    if tipo in (None, "comprimido"):
        raise NoReproducible("esta comprimido: hay que descargarlo" if tipo else "no es un video")

    partes = await _partes(channel_id, message_id, nombre)
    docs = await _documentos(dl, channel_id, [m for _p, m, _n in partes])
    tramos, desde = [], 0
    for _p, mid, _n in partes:
        d = docs.get(mid)
        if d is None:
            raise NoReproducible("una de las partes ya no esta en el canal")
        tramos.append(Tramo(channel_id, mid, d, d.size, desde))
        desde += d.size

    if tipo == "zip":
        borrador = Virtual(nombre, tramos, 0, desde, "zip")
        interno, inicio, tamano = await _video_en_zip(borrador)
        ext = interno.rsplit(".", 1)[-1].lower()
        return Virtual(interno.rsplit("/", 1)[-1], tramos, inicio, tamano, ext)

    base = _detect_multipart(nombre)[0] or nombre
    return Virtual(base, tramos, 0, desde, base.rsplit(".", 1)[-1].lower())


# --- Dentro de un zip --------------------------------------------------------

_CABECERA_LOCAL = 0x04034B50


async def _leer_todo(v: Virtual, desde: int, cuanto: int) -> bytes:
    trozos = []
    async for t in leer(v, desde, desde + cuanto - 1):
        trozos.append(t)
    return b"".join(trozos)


async def _video_en_zip(v: Virtual) -> tuple[str, int, int]:
    """Nombre, posicion y tamaño del video dentro del zip, si esta guardado
    sin comprimir. Se recorren las cabeceras locales desde el principio: un
    zip de pelicula suele traer el video y como mucho un .nfo o un .txt."""
    pos = 0
    for _ in range(20):
        if pos + 30 > v.tamano:
            break
        cab = await _leer_todo(v, pos, min(30 + 1024, v.tamano - pos))
        if len(cab) < 30 or struct.unpack_from("<I", cab, 0)[0] != _CABECERA_LOCAL:
            break
        banderas, metodo = struct.unpack_from("<HH", cab, 6)
        comprimido, original = struct.unpack_from("<II", cab, 18)
        largo_nombre, largo_extra = struct.unpack_from("<HH", cab, 26)
        if len(cab) < 30 + largo_nombre + largo_extra:
            cab = await _leer_todo(v, pos, 30 + largo_nombre + largo_extra)
        nombre = cab[30:30 + largo_nombre].decode("utf-8", "replace")
        extra = cab[30 + largo_nombre:30 + largo_nombre + largo_extra]
        if comprimido == 0xFFFFFFFF or original == 0xFFFFFFFF:
            original, comprimido = _zip64(extra, original, comprimido)
        datos = pos + 30 + largo_nombre + largo_extra
        if banderas & 0x08 and comprimido == 0:
            raise NoReproducible("el zip no dice el tamaño de lo que guarda: hay que descargarlo")
        if nombre.lower().endswith(EXT_VIDEO):
            if banderas & 0x01:
                raise NoReproducible("el zip esta cifrado: hay que descargarlo")
            if metodo != 0:
                raise NoReproducible("el zip comprime el video: hay que descargarlo")
            return nombre, datos, original
        pos = datos + comprimido
    raise NoReproducible("no se ha encontrado ningun video dentro del zip")


def _zip64(extra: bytes, original: int, comprimido: int) -> tuple[int, int]:
    i = 0
    while i + 4 <= len(extra):
        cid, largo = struct.unpack_from("<HH", extra, i)
        if cid == 0x0001:
            campos = extra[i + 4:i + 4 + largo]
            j = 0
            if original == 0xFFFFFFFF and j + 8 <= len(campos):
                original = struct.unpack_from("<Q", campos, j)[0]
                j += 8
            if comprimido == 0xFFFFFFFF and j + 8 <= len(campos):
                comprimido = struct.unpack_from("<Q", campos, j)[0]
            break
        i += 4 + largo
    return original, comprimido


# --- Leer de Telegram ----------------------------------------------------------

async def leer(v: Virtual, desde: int, hasta: int):
    """Los bytes `desde`..`hasta` (incluidos) del video, de Telegram, a medida
    que llegan. Si la referencia del archivo caduca a mitad se rearma el
    virtual una vez y se sigue por donde iba."""
    dl = _downloader()
    pos = desde
    refrescado = False
    while pos <= hasta:
        crudo = v.inicio + pos
        tramo = next((t for t in v.tramos if t.desde <= crudo < t.desde + t.tamano), None)
        if tramo is None:
            return
        local = crudo - tramo.desde
        alineado = local - local % TROZO
        saltar = local - alineado
        cuanto = min(hasta - pos + 1, tramo.tamano - local)
        # El iterador se cierra siempre: salir del bucle a medias (el tramo
        # pedido acaba antes que el archivo, o el `<video>` corta la conexion)
        # sin cerrarlo deja prestada la conexion con el DC del archivo.
        it = dl.client.iter_download(tramo.documento, offset=alineado,
                                     request_size=TROZO, file_size=tramo.tamano)
        try:
            async for trozo in it:
                if saltar:
                    trozo = trozo[saltar:]
                    saltar = 0
                if len(trozo) > cuanto:
                    trozo = trozo[:cuanto]
                if not trozo:
                    break
                pos += len(trozo)
                cuanto -= len(trozo)
                yield bytes(trozo)
                if cuanto <= 0:
                    break
            else:
                if cuanto > 0:
                    return  # Telegram dio menos de lo que dice el tamaño
        except Exception as e:
            from telethon import errors
            if refrescado or not isinstance(e, (errors.FileReferenceExpiredError,
                                                errors.FilerefUpgradeNeededError)):
                raise
            refrescado = True
            v = await virtual(*v.clave, refrescar=True)
        finally:
            await it.close()


# --- La comprobacion completa, guardada --------------------------------------

async def comprobar(channel_id: int, message_id: int, forzar: bool = False) -> dict:
    """Si se puede ver sin descargar y como: `{"modo": "ver"|"descargar",
    "motivo", "path", "pistas"}`. Se guarda en `reproduccion`: cada archivo se
    mira una vez (un nombre no cambia de contenido)."""
    from app.database.reproduccion import guardar, leer as leer_guardado

    if not forzar:
        guardado = await leer_guardado(channel_id, message_id)
        if guardado and guardado.get("v") == VERSION:
            return guardado

    path = ruta(channel_id, message_id)
    try:
        v = await virtual(channel_id, message_id)
    except NoReproducible as e:
        r = {"v": VERSION, "modo": "descargar", "motivo": str(e), "path": None, "pistas": None}
        if e.definitivo:
            await guardar(channel_id, message_id, r)
        return r

    pistas = await _pistas(path)
    if pistas is not None:
        # Si se puede adaptar al vuelo para el iPhone (services/hls.py): MKV
        # con imagen que se copia y con indice de fotogramas clave legible.
        from app.services import hls
        pistas["hls"] = False
        if hls.se_puede(pistas):
            try:
                pistas["hls"] = bool(await hls.claves_de(v))
            except Exception as e:
                logger.warning("No se pudo leer el indice de %s: %s", v.nombre, e)
    r = {"v": VERSION, "modo": "ver", "motivo": "", "path": path, "nombre": v.nombre,
         "tamano": v.tamano, "partes": len(v.tramos), "pistas": pistas}
    if pistas is None:
        r["motivo"] = "no se han podido leer las pistas"
    # Un fallo al leer las pistas no se guarda: puede ser de red y la
    # siguiente vez salir bien.
    if pistas is not None:
        await guardar(channel_id, message_id, r)
    return r


async def _pistas(path: str) -> dict | None:
    """ffprobe sobre el propio stream (lo que el `<video>` va a pedir), con una
    entrada de reproduccion del sistema para esa ruta."""
    from app.auth.service import create_stream_token
    from app.config import get_jwt_secret
    from app.routers.download import config
    from app.services.tracks import leer_pistas, mejor_audio
    from urllib.parse import quote

    token = create_stream_token("sistema", path, get_jwt_secret())
    url = (f"http://127.0.0.1:{config.get('server_port', 8000)}/api/stream"
           f"?path={quote(path)}&token={quote(token)}")
    datos = await asyncio.to_thread(leer_pistas, url)
    if not datos.get("ok"):
        return None
    datos["path"] = path
    datos["default_audio"] = mejor_audio(datos["audio"]) if datos["audio"] else None
    datos["external_subtitles"] = []
    return datos


def resumen_para_log(r: dict) -> str:
    return json.dumps({k: r.get(k) for k in ("modo", "motivo", "partes")}, ensure_ascii=False)
