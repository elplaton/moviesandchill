"""Lo que hay dentro de cada comprimido, y ver sin descargar el que guarda el
video tal cual.

Un rar, un 7z o un zip no siempre comprimen: en modo «almacenar» el video va
dentro byte a byte y el archivador solo lo trocea. Entonces no hace falta
bajarlo: basta con saber en que tramos de que mensajes esta el video y
servirlos en orden, igual que unas partes `.mkv.001`. Medido en noviembre de
2026 sobre dos muestras de 300: lo es un 14 % de lo que solo se podia
descargar (un 8 % de las peliculas y casi la mitad de los episodios; K9
Peliculas lo comprime todo).

Que va almacenado no lo dice el nombre, lo dice la cabecera, asi que hay que
leerla: un vigilante recorre el catalogo despacio (primero lo que no tiene
ningun enlace que se pueda ver) y guarda lo que encuentra en la tabla
`interior`, una fila por comprimido con sus volumenes. Un archivo no cambia,
asi que se mira una vez. Con eso:

- la ficha ofrece «Ver» (`ver_de()`, en `search_router`) antes de pulsar
  nada, como pidio el usuario: «Ver» no puede acabar en «estaba comprimido»;
- `reproduccion._armar()` arma el video con `tramos_de()`.

Hay dos formas de trocear y se tratan distinto:

- **volumenes de rar** (`.part1.rar`, `.part2.rar`... o `.rar`, `.r00`,
  `.r01`...): cada volumen es un rar con sus cabeceras, y el video es el
  trozo de datos de cada uno;
- **trozos** (`.zip.001`, `.7z.001`, `.rar.001`, o un `.zip`/`.7z` entero):
  un solo archivo partido a bytes; el video es un tramo continuo de la union.

Solo se ofrece si el video es casi todo el comprimido (`MINIMO_VIDEO`): un
pack de temporada guarda diez episodios y «Ver» pondria el primero.
"""
import asyncio
import collections
import json
import logging
import re
import struct
import time

from app.services.reproduccion import EXT_VIDEO, NoReproducible, Tramo, Virtual

logger = logging.getLogger("tmd")

# Sube al cambiar como se mira: lo guardado con otra version se vuelve a mirar.
VERSION = 1

PRIMERO = 256 * 1024     # del primer volumen: cabe un .nfo delante del video
RESTO = 64 * 1024        # de los demas: la cabecera del trozo que continua
PAUSA = 0.5              # entre lectura y lectura, para no apretar a Telegram
MINIMO_VIDEO = 0.9       # el video tiene que ser al menos esto del total
ESPERA_VUELTA = 30 * 60  # entre una pasada por el catalogo y la siguiente

_ARCHIVO = r"\.(rar|r\d{2,}|zip|7z|(zip|7z|rar)\.\d{3,})$"


# --- Que volumenes van juntos ------------------------------------------------

_RE_PART = re.compile(r"^(.+)\.part(\d+)\.rar$", re.IGNORECASE)
_RE_RNN = re.compile(r"^(.+)\.r(\d{2,})$", re.IGNORECASE)
_RE_TROZO = re.compile(r"^(.+\.(?:zip|7z|rar))\.(\d{3,})$", re.IGNORECASE)
_RE_RAR = re.compile(r"^(.+)\.rar$", re.IGNORECASE)
_RE_UNO = re.compile(r"^(.+\.(?:zip|7z))$", re.IGNORECASE)


def grupo(nombre: str) -> tuple[str, str, int] | None:
    """(forma, base, orden) de un archivo comprimido, o None.

    `forma` es `volumenes` (rar con cabeceras en cada volumen) o `trozos` (un
    archivo partido a bytes, o entero). En el esquema viejo de rar el primero
    es el `.rar` y luego van `.r00`, `.r01`..., de ahi el `+ 1`."""
    if m := _RE_PART.match(nombre):
        return "volumenes", m[1].lower(), int(m[2])
    if m := _RE_RNN.match(nombre):
        return "volumenes", m[1].lower(), int(m[2]) + 1
    if m := _RE_TROZO.match(nombre):
        return "trozos", m[1].lower(), int(m[2])
    if m := _RE_RAR.match(nombre):
        return "volumenes", m[1].lower(), 0
    if m := _RE_UNO.match(nombre):
        return "trozos", m[1].lower(), 0
    return None


def agrupar(filas: list[dict]) -> dict[tuple, list[dict]]:
    """Los comprimidos completos de una lista de filas del catalogo, con sus
    volumenes en orden. Uno con huecos (falta una parte) no entra: el video
    saldria cortado."""
    grupos: dict[tuple, dict[int, dict]] = collections.defaultdict(dict)
    for f in filas:
        g = grupo(f["file_name"])
        if g:
            grupos[(f["channel_id"], g[0], g[1])].setdefault(g[2], f)
    salida = {}
    for clave, por_orden in grupos.items():
        numeros = sorted(por_orden)
        if numeros == list(range(numeros[0], numeros[0] + len(numeros))):
            salida[clave] = [por_orden[n] for n in numeros]
    return salida


# --- Cabeceras -------------------------------------------------------------

def _vint(b: bytes, i: int) -> tuple[int, int]:
    """Entero de longitud variable de RAR5 (7 bits por byte)."""
    valor, desplazamiento = 0, 0
    while True:
        c = b[i]
        valor |= (c & 0x7F) << desplazamiento
        i += 1
        if not c & 0x80:
            return valor, i
        desplazamiento += 7


def _es_video(nombre: str) -> bool:
    return nombre.lower().endswith(EXT_VIDEO)


def cabeceras_rar(b: bytes) -> dict:
    """Lo que dicen las cabeceras del principio de un volumen de rar:
    `{"formato", "cifrado", "archivos": [...]}`. De cada archivo: nombre,
    metodo (0 = almacenado), cifrado, tamano (descomprimido), `datos` (donde
    empiezan sus datos en el volumen), `largo` (cuantos hay en este volumen),
    `antes`/`despues` (viene del volumen anterior / sigue en el siguiente) y
    `dir`. Se para donde se acaba lo leido."""
    if b.startswith(b"Rar!\x1a\x07\x01\x00"):
        return _rar5(b)
    if b.startswith(b"Rar!\x1a\x07\x00"):
        return _rar4(b)
    raise ValueError("no es un rar")


def _rar5(b: bytes) -> dict:
    r = {"formato": "rar5", "cifrado": False, "archivos": []}
    i = 8
    try:
        while i < len(b):
            i += 4                                   # CRC32
            tam_cab, i = _vint(b, i)
            fin_cab = i + tam_cab
            tipo, i = _vint(b, i)
            banderas, i = _vint(b, i)
            tam_extra = tam_datos = 0
            if banderas & 0x0001:
                tam_extra, i = _vint(b, i)
            if banderas & 0x0002:
                tam_datos, i = _vint(b, i)
            if tipo == 4:                            # cabeceras cifradas
                r["cifrado"] = True
                return r
            if tipo == 5:                            # fin del volumen
                return r
            if tipo == 2:
                fbanderas, i = _vint(b, i)
                tamano, i = _vint(b, i)
                _attr, i = _vint(b, i)
                if fbanderas & 0x0002:
                    i += 4
                if fbanderas & 0x0004:
                    i += 4
                compresion, i = _vint(b, i)
                _so, i = _vint(b, i)
                largo_nombre, i = _vint(b, i)
                if fin_cab > len(b):
                    return r
                nombre = b[i:i + largo_nombre].decode("utf-8", "replace")
                cifrado = False
                j = fin_cab - tam_extra
                while j < fin_cab:
                    tam_reg, k = _vint(b, j)
                    tipo_reg, _ = _vint(b, k)
                    if tipo_reg == 0x01:
                        cifrado = True
                    j = k + tam_reg
                r["archivos"].append({
                    "nombre": nombre, "metodo": (compresion >> 7) & 7, "cifrado": cifrado,
                    "tamano": None if fbanderas & 0x0008 else tamano,
                    "datos": fin_cab, "largo": tam_datos,
                    "antes": bool(banderas & 0x0008), "despues": bool(banderas & 0x0010),
                    "dir": bool(fbanderas & 0x0001)})
            i = fin_cab + tam_datos
    except IndexError:
        pass
    return r


def _rar4(b: bytes) -> dict:
    r = {"formato": "rar4", "cifrado": False, "archivos": []}
    i = 7
    try:
        while i + 7 <= len(b):
            _crc, tipo, banderas, tam_cab = struct.unpack_from("<HBHH", b, i)
            if tam_cab < 7:
                break
            extra = 0
            if tipo == 0x73 and banderas & 0x0080:
                r["cifrado"] = True
                return r
            if tipo == 0x7B:                         # fin del volumen
                return r
            if tipo == 0x74:
                empaquetado, tamano = struct.unpack_from("<II", b, i + 7)
                metodo = b[i + 25]
                largo_nombre, = struct.unpack_from("<H", b, i + 26)
                n = i + 32
                if banderas & 0x0100:
                    alto_emp, alto_tam = struct.unpack_from("<II", b, n)
                    empaquetado |= alto_emp << 32
                    tamano |= alto_tam << 32
                    n += 8
                if i + tam_cab > len(b):
                    return r
                nombre = b[n:n + largo_nombre].split(b"\0", 1)[0].decode("utf-8", "replace")
                r["archivos"].append({
                    "nombre": nombre, "metodo": metodo - 0x30, "cifrado": bool(banderas & 0x0004),
                    "tamano": tamano, "datos": i + tam_cab, "largo": empaquetado,
                    "antes": bool(banderas & 0x0001), "despues": bool(banderas & 0x0002),
                    "dir": (banderas & 0x00E0) == 0x00E0})
                extra = empaquetado
            elif banderas & 0x8000:
                extra, = struct.unpack_from("<I", b, i + 7)
            i += tam_cab + extra
    except (IndexError, struct.error):
        pass
    return r


def cabeceras_zip(b: bytes) -> list[dict]:
    """Las cabeceras locales del principio de un zip, como `cabeceras_rar`."""
    from app.services.reproduccion import _zip64
    archivos = []
    i = 0
    while i + 30 <= len(b) and b[i:i + 4] == b"PK\x03\x04":
        banderas, metodo = struct.unpack_from("<HH", b, i + 6)
        comprimido, tamano = struct.unpack_from("<II", b, i + 18)
        largo_nombre, largo_extra = struct.unpack_from("<HH", b, i + 26)
        datos = i + 30 + largo_nombre + largo_extra
        if datos > len(b):
            break
        nombre = b[i + 30:i + 30 + largo_nombre].decode("utf-8", "replace")
        if comprimido == 0xFFFFFFFF or tamano == 0xFFFFFFFF:
            tamano, comprimido = _zip64(b[i + 30 + largo_nombre:datos], tamano, comprimido)
        sin_tamano = bool(banderas & 0x08) and comprimido == 0
        archivos.append({"nombre": nombre, "metodo": metodo, "cifrado": bool(banderas & 0x01),
                         "tamano": None if sin_tamano else tamano, "datos": datos,
                         "largo": comprimido, "dir": nombre.endswith("/")})
        if sin_tamano:
            break
        i = datos + comprimido
    return archivos


_FIRMAS = ((b"\x1a\x45\xdf\xa3", 0, "mkv"), (b"ftyp", 4, "mp4"), (b"RIFF", 0, "avi"))


def firma_video(b: bytes, i: int = 0) -> str | None:
    """`mkv`, `mp4` o `avi` si en `i` empieza uno de esos."""
    for firma, desfase, formato in _FIRMAS:
        if b[i + desfase:i + desfase + len(firma)] == firma:
            return formato
    return None


def _vint_ebml(b: bytes, i: int) -> tuple[int, int, bool]:
    """(valor, siguiente, desconocido) de un tamaño de EBML."""
    primero = b[i]
    largo = 1
    while largo <= 8 and not primero & (0x80 >> (largo - 1)):
        largo += 1
    valor = primero & (0xFF >> largo)
    for k in range(1, largo):
        valor = (valor << 8) | b[i + k]
    return valor, i + largo, valor == (1 << (7 * largo)) - 1


def largo_mkv(b: bytes, i: int) -> int | None:
    """Cuanto mide el MKV que empieza en `i`: la cabecera EBML mas el
    Segment, que lleva su tamaño. None si el Segment no lo dice."""
    try:
        if b[i:i + 4] != b"\x1a\x45\xdf\xa3":
            return None
        tam, j, _ = _vint_ebml(b, i + 4)
        j += tam
        if b[j:j + 4] != b"\x18\x53\x80\x67":
            return None
        tam, k, desconocido = _vint_ebml(b, j + 4)
        return None if desconocido else k + tam - i
    except IndexError:
        return None


# --- Leer de Telegram --------------------------------------------------------

def _virtual(channel_id: int, partes: list[tuple[int, object]]) -> Virtual:
    """La union de esos documentos como un archivo (para leer con
    `reproduccion.leer`)."""
    tramos, desde = [], 0
    for mid, doc in partes:
        tramos.append(Tramo(channel_id, mid, doc, doc.size, desde))
        desde += doc.size
    # Sin `clave`: si caducara la referencia, `leer` no debe rearmar esto
    # como si fuera un video (se lanzaria otra vez `mirar`); falla y ya.
    return Virtual("", tramos, 0, desde, "")


async def _leer(v: Virtual, desde: int, cuanto: int) -> bytes:
    from app.services.reproduccion import leer
    cuanto = min(cuanto, v.tamano - desde)
    if cuanto <= 0:
        return b""
    return b"".join([t async for t in leer(v, desde, desde + cuanto - 1)])


async def _largo_cajas(v: Virtual, inicio: int, fin: int, mp4: bool) -> int | None:
    """Cuanto mide el MP4 (cajas de primer nivel) o el AVI (bloques RIFF, que
    en OpenDML se encadenan: RIFF AVI, RIFF AVIX...) que empieza en `inicio`.
    Se acaba al llegar a algo que no es una caja o a un segundo `ftyp` (el
    siguiente archivo de un pack)."""
    pos = inicio
    for n in range(200):
        if pos >= fin:
            return fin - inicio
        cab = await _leer(v, pos, 16)
        if len(cab) < 8:
            return pos - inicio
        if mp4:
            tam, tipo = struct.unpack_from(">I4s", cab, 0)
            if not re.fullmatch(rb"[\x20-\x7e\xa9]{4}", tipo) or (n and tipo == b"ftyp"):
                return pos - inicio
            if tam == 1:
                tam, = struct.unpack_from(">Q", cab, 8)
            elif tam == 0:
                return fin - inicio
            if tam < 8:
                return None
        else:
            if cab[:4] != b"RIFF":
                return pos - inicio
            tam, = struct.unpack_from("<I", cab, 4)
            tam += 8 + (tam & 1)
        pos += tam
    return None


# --- Mirar un comprimido -------------------------------------------------------

def _resultado(clase: str, detalle: str = "", **kw) -> dict:
    return {"clase": clase, "detalle": detalle, **kw}


def _comprobar_video(archivos: list[dict], total: int) -> tuple[dict | None, dict | None]:
    """(video, None) si hay un video almacenado que es casi todo el
    comprimido, o (None, resultado) con el motivo de que no."""
    videos = [a for a in archivos if not a["dir"] and _es_video(a["nombre"])]
    if not videos:
        otros = [a["nombre"] for a in archivos][:3]
        return None, _resultado("sin_video", f"antes del video: {otros}" if otros else "sin cabeceras")
    a = videos[0]
    if a["cifrado"]:
        return None, _resultado("cifrado", video=a["nombre"])
    if a["metodo"] != 0:
        return None, _resultado("comprimido", f"metodo {a['metodo']}", video=a["nombre"])
    if not a["tamano"]:
        return None, _resultado("error", "el comprimido no dice cuanto mide el video", video=a["nombre"])
    if a["tamano"] < MINIMO_VIDEO * total:
        return None, _resultado("varios", f"el video es el {a['tamano'] * 100 // max(total, 1)} % del total",
                                video=a["nombre"])
    return a, None


async def _mirar_volumenes(channel_id: int, partes: list[tuple[int, object]]) -> dict:
    total = sum(d.size for _m, d in partes)
    mid, doc = partes[0]
    primero = await _leer(_virtual(channel_id, [(mid, doc)]), 0, PRIMERO)
    try:
        c = cabeceras_rar(primero)
    except ValueError:
        return _resultado("error", f"no empieza como un rar: {primero[:8].hex()}")
    if c["cifrado"]:
        return _resultado("cifrado", f"{c['formato']} con las cabeceras cifradas")
    a, motivo = _comprobar_video(c["archivos"], total)
    if motivo:
        return {**motivo, "formato": c["formato"]}
    formato = firma_video(primero, a["datos"]) if a["datos"] < len(primero) else None
    if a["nombre"].lower().endswith((".mkv", ".mp4", ".m4v", ".avi")) and not formato:
        return _resultado("error", "en los datos no hay un video", formato=c["formato"], video=a["nombre"])
    tramos = [[mid, a["datos"], a["largo"]]]
    sigue = a["despues"]
    for mid, doc in partes[1:]:
        if not sigue:
            break
        cab = await _leer(_virtual(channel_id, [(mid, doc)]), 0, RESTO)
        try:
            archivos = cabeceras_rar(cab)["archivos"]
        except ValueError:
            return _resultado("error", "un volumen no empieza como un rar", formato=c["formato"])
        s = next((x for x in archivos if x["nombre"] == a["nombre"]), None)
        if s is None or not s["antes"]:
            return _resultado("error", "un volumen no sigue al anterior", formato=c["formato"])
        tramos.append([mid, s["datos"], s["largo"]])
        sigue = s["despues"]
        await asyncio.sleep(PAUSA)
    if sigue or sum(t[2] for t in tramos) != a["tamano"]:
        return _resultado("error", "los volumenes no suman lo que mide el video", formato=c["formato"])
    return _resultado("ver", formato=c["formato"], video=a["nombre"], tamano=a["tamano"], tramos=tramos)


async def _mirar_trozos(channel_id: int, partes: list[tuple[int, object]]) -> dict:
    v = _virtual(channel_id, partes)
    total = v.tamano
    b = await _leer(v, 0, PRIMERO)
    inicio = largo = None
    if b.startswith(b"Rar!"):
        c = cabeceras_rar(b)
        if c["cifrado"]:
            return _resultado("cifrado", f"{c['formato']} con las cabeceras cifradas")
        a, motivo = _comprobar_video(c["archivos"], total)
        if motivo:
            return {**motivo, "formato": c["formato"]}
        if a["despues"]:
            return _resultado("error", "un rar en volumenes partido otra vez a bytes", formato=c["formato"])
        formato, nombre, inicio, largo = c["formato"], a["nombre"], a["datos"], a["tamano"]
    elif b.startswith(b"PK\x03\x04"):
        a, motivo = _comprobar_video(cabeceras_zip(b), total)
        if motivo:
            return {**motivo, "formato": "zip"}
        formato, nombre, inicio, largo = "zip", a["nombre"], a["datos"], a["tamano"]
    elif b.startswith(b"7z\xbc\xaf\x27\x1c"):
        # El 7z no tiene cabecera por archivo: los datos empiezan en el byte
        # 32 y la lista de archivos (con el metodo) va al final, comprimida
        # casi siempre. Almacenado, el video esta ahi tal cual (o tras un
        # .nfo); en un flujo LZMA la firma de un MKV o un MP4 no sale.
        formato = "7z"
        siguiente, = struct.unpack_from("<Q", b, 12)
        fin = 32 + siguiente
        sitios = [b.find(f, 32 + d) - d for f, d, _t in _FIRMAS if b.find(f, 32 + d) >= 0]
        inicio = min(sitios) if sitios else None
        if inicio is None:
            return _resultado("comprimido", "sin video tal cual al principio", formato=formato)
        tipo = firma_video(b, inicio)
        nombre = f"video.{tipo}"
        if tipo == "mkv":
            largo = largo_mkv(b, inicio)
        else:
            largo = await _largo_cajas(v, inicio, fin, mp4=tipo == "mp4")
        if not largo or inicio + largo > fin:
            return _resultado("error", "no se sabe donde acaba el video", formato=formato)
        if largo < MINIMO_VIDEO * total:
            return _resultado("varios", f"el video es el {largo * 100 // total} % del total", formato=formato)
    else:
        return _resultado("error", f"formato desconocido: {b[:8].hex()}")

    if nombre.lower().endswith((".mkv", ".mp4", ".m4v", ".avi")) and inicio < len(b) and not firma_video(b, inicio):
        return _resultado("error", "en los datos no hay un video", formato=formato, video=nombre)
    # El tramo continuo [inicio, inicio + largo) de la union, por mensaje.
    tramos, desde = [], 0
    for mid, doc in partes:
        a_, b_ = max(inicio, desde), min(inicio + largo, desde + doc.size)
        if a_ < b_:
            tramos.append([mid, a_ - desde, b_ - a_])
        desde += doc.size
    return _resultado("ver", formato=formato, video=nombre, tamano=largo, tramos=tramos)


async def mirar(channel_id: int, volumenes: list[dict]) -> dict:
    """Mira un comprimido (sus filas del catalogo, en orden) en Telegram.
    Lanza `NoReproducible` si es pasajero (Telegram, un mensaje borrado)."""
    from app.services.reproduccion import _documentos, _downloader
    dl = _downloader()
    mids = [f["message_id"] for f in volumenes]
    docs = {}
    for i in range(0, len(mids), 100):
        docs.update(await _documentos(dl, channel_id, mids[i:i + 100]))
    if any(m not in docs for m in mids):
        raise NoReproducible("una de las partes ya no esta en el canal", definitivo=False)
    partes = [(m, docs[m]) for m in mids]
    forma = grupo(volumenes[0]["file_name"])[0]
    try:
        # Un .rar suelto es un solo volumen: se mira como un archivo entero.
        if forma == "volumenes" and len(partes) > 1:
            r = await _mirar_volumenes(channel_id, partes)
        else:
            r = await _mirar_trozos(channel_id, partes)
    except (IndexError, struct.error, ValueError) as e:
        r = _resultado("error", f"cabecera ilegible: {e}")
    r["v"] = VERSION
    r["tamanos"] = [d.size for _m, d in partes]
    return r


# --- La tabla `interior` -----------------------------------------------------

async def guardar(channel_id: int, volumenes: list[int], r: dict) -> None:
    from app.database.connection import get_pool
    async with get_pool().acquire() as conn:
        await conn.execute("""
            INSERT INTO interior (channel_id, message_id, volumenes, version, clase, datos, comprobado_en)
            VALUES ($1, $2, $3::int[], $4, $5, $6::jsonb, NOW())
            ON CONFLICT (channel_id, message_id) DO UPDATE SET
                volumenes = EXCLUDED.volumenes, version = EXCLUDED.version, clase = EXCLUDED.clase,
                datos = EXCLUDED.datos, comprobado_en = NOW()
        """, channel_id, volumenes[0], volumenes, VERSION, r["clase"], json.dumps(r, ensure_ascii=False))


async def ver_de(filas: list[dict]) -> set[tuple[int, int]]:
    """De esas filas del catalogo, las que son parte de un comprimido que
    guarda el video tal cual: (canal, mensaje)."""
    from app.database.connection import get_pool
    pedidos = {(f["channel_id"], f["message_id"]) for f in filas
               if f.get("file_name") and grupo(f["file_name"])}
    pool = get_pool()
    if not pedidos or not pool:
        return set()
    try:
        async with pool.acquire() as conn:
            filas_ = await conn.fetch("""
                SELECT channel_id, volumenes FROM interior
                WHERE clase = 'ver' AND version = $1 AND volumenes && $2::int[]
            """, VERSION, list({m for _c, m in pedidos}))
    except Exception as e:
        logger.warning("Leyendo la tabla interior: %s", e)
        return set()
    return {(f["channel_id"], m) for f in filas_ for m in f["volumenes"]} & pedidos


async def _guardado(channel_id: int, message_id: int) -> dict | None:
    from app.database.connection import get_pool
    async with get_pool().acquire() as conn:
        datos = await conn.fetchval("""
            SELECT datos FROM interior
            WHERE channel_id = $1 AND $2 = ANY(volumenes) AND version = $3
        """, channel_id, message_id, VERSION)
    if datos is None:
        return None
    return json.loads(datos) if isinstance(datos, str) else datos


async def _volumenes_de(channel_id: int, nombre: str) -> list[dict]:
    from app.services.telegram_client import _partes_en_catalogo
    g = grupo(nombre)
    filas = await _partes_en_catalogo(channel_id, g[1])
    for clave, vols in agrupar([dict(f) for f in filas]).items():
        if clave == (channel_id, g[0], g[1]):
            return vols
    raise NoReproducible("faltan partes del comprimido en el canal", definitivo=False)


async def tramos_de(channel_id: int, message_id: int, nombre: str) -> tuple[str, list[list[int]]]:
    """(nombre del video, [[mensaje, desde, cuanto], ...]) de un comprimido
    que guarda el video tal cual. Si aun no se ha mirado, se mira ahora."""
    r = await _guardado(channel_id, message_id)
    if r is None:
        vols = await _volumenes_de(channel_id, nombre)
        r = await mirar(channel_id, vols)
        await guardar(channel_id, [f["message_id"] for f in vols], r)
    if r["clase"] != "ver":
        motivo = {"comprimido": "esta comprimido: hay que descargarlo",
                  "cifrado": "tiene contraseña: hay que descargarlo",
                  "varios": "guarda varios videos: hay que descargarlo",
                  "sin_video": "no se ha encontrado ningun video dentro"}.get(r["clase"], r.get("detalle") or "no se puede")
        raise NoReproducible(motivo)
    return r["video"].rsplit("/", 1)[-1], r["tramos"]


# --- El vigilante ------------------------------------------------------------

_estado: dict = {"estado": "sin_empezar"}


async def _pendientes() -> list[tuple[bool, tuple, list[dict]]]:
    """Los comprimidos sin mirar (o mirados con otra version), primero los
    de titulos que no tienen ningun enlace que se pueda ver."""
    from app.database.connection import get_pool
    async with get_pool().acquire() as conn:
        filas = await conn.fetch("""
            SELECT channel_id, message_id, file_name, tmdb_id, tmdb_type, season, episode, tmdb_valid
            FROM media_items WHERE file_name ~* $1""", _ARCHIVO)
        con_ver = await conn.fetch(r"""
            SELECT DISTINCT tmdb_id, tmdb_type, season, episode FROM media_items
            WHERE tmdb_valid AND tmdb_id IS NOT NULL
              AND file_name ~* '\.(mp4|mkv|avi|mov|m4v|webm|ts|wmv|flv)(\.\d{3,})?$'""")
        hechos = await conn.fetch("SELECT channel_id, message_id FROM interior WHERE version = $1", VERSION)
    con_ver = {(r["tmdb_id"], r["tmdb_type"], r["season"], r["episode"]) for r in con_ver}
    hechos = {(r["channel_id"], r["message_id"]) for r in hechos}
    salida = []
    for clave, vols in agrupar([dict(f) for f in filas]).items():
        p = vols[0]
        if (p["channel_id"], p["message_id"]) in hechos:
            continue
        urgente = bool(p["tmdb_valid"] and p["tmdb_id"]) and \
            (p["tmdb_id"], p["tmdb_type"], p["season"], p["episode"]) not in con_ver
        salida.append((urgente, clave, vols))
    salida.sort(key=lambda x: not x[0])
    return salida


async def una_vuelta() -> int:
    from app.services import cache
    pendientes = await _pendientes()
    _estado.update(estado="mirando", pendientes=len(pendientes), hechos=0,
                   urgentes=sum(1 for u, _c, _v in pendientes if u), empezado=time.time())
    if pendientes:
        logger.info("Interior de comprimidos: %d por mirar (%d de titulos sin «Ver»)",
                    len(pendientes), _estado["urgentes"])
    nuevos_ver = 0
    for n, (_urgente, clave, vols) in enumerate(pendientes, 1):
        channel_id = clave[0]
        try:
            r = await mirar(channel_id, vols)
        except NoReproducible as e:
            # Lo pasajero (una parte borrada, Telegram caido) se queda sin
            # guardar y se vuelve a intentar en la siguiente pasada.
            if "conectado" in str(e):
                _estado["estado"] = "esperando a Telegram"
                await asyncio.sleep(60)
                _estado["estado"] = "mirando"
            continue
        except Exception as e:
            logger.warning("Mirando %s: %s", vols[0]["file_name"], e)
            await asyncio.sleep(5)
            continue
        await guardar(channel_id, [f["message_id"] for f in vols], r)
        _estado["hechos"] = n
        if r["clase"] == "ver":
            nuevos_ver += 1
            if nuevos_ver % 25 == 0:
                cache.olvidar("ficha", "busqueda")
        if n % 200 == 0:
            logger.info("Interior de comprimidos: %d de %d mirados", n, len(pendientes))
        await asyncio.sleep(PAUSA)
    if nuevos_ver:
        cache.olvidar("ficha", "busqueda")
    _estado.update(estado="al dia", terminado=time.time())
    return len(pendientes)


async def vigilante():
    """Mira lo que haya sin mirar, y vuelve cada media hora por lo nuevo."""
    await asyncio.sleep(120)
    while True:
        try:
            await una_vuelta()
        except Exception:
            logger.exception("Interior de comprimidos")
            _estado["estado"] = "error"
        await asyncio.sleep(ESPERA_VUELTA)


async def resumen() -> dict:
    """Cuanto se ha mirado y, de los titulos que solo se podian descargar,
    cuantos tienen ahora «Ver»."""
    from app.database.connection import get_pool
    from app.services.reproduccion import se_puede_intentar
    async with get_pool().acquire() as conn:
        clases = await conn.fetch("""
            SELECT clase, count(*) n, sum((datos->>'tamano')::bigint) FILTER (WHERE clase = 'ver') bytes
            FROM interior WHERE version = $1 GROUP BY 1 ORDER BY 2 DESC""", VERSION)
        filas = await conn.fetch("""
            SELECT channel_id, message_id, file_name, tmdb_id, tmdb_type, media_type, season, episode
            FROM media_items WHERE tmdb_valid AND tmdb_id IS NOT NULL""")
    ver = await ver_de([dict(f) for f in filas])
    titulos = collections.defaultdict(lambda: [False, False, False])  # ver antes, comprimido, ver ahora
    for f in filas:
        serie = f["media_type"] == "series" or f["tmdb_type"] == "tv"
        u = ("tv", f["tmdb_id"], f["season"], f["episode"]) if serie else ("movie", f["tmdb_id"])
        t = titulos[u]
        if se_puede_intentar(f["file_name"]):
            t[0] = True
        elif grupo(f["file_name"]):
            t[1] = True
            if (f["channel_id"], f["message_id"]) in ver:
                t[2] = True
    cuentas = collections.Counter()
    for u, (antes, comprimido, ahora) in titulos.items():
        if not antes and comprimido:
            cuentas[f"{u[0]}:solo_descargar"] += 1
            if ahora:
                cuentas[f"{u[0]}:pasan_a_ver"] += 1
    return {**_estado, "clases": {c["clase"]: {"n": c["n"], "bytes": c["bytes"]} for c in clases},
            "titulos": dict(cuentas)}
