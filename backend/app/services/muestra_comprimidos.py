"""Medir cuanto de lo que solo esta comprimido se podria ver sin descargarlo.

Un rar no siempre comprime: en modo «almacenar» el video va dentro tal cual,
byte a byte, troceado en volumenes, y entonces se podria servir desde
Telegram igual que un zip sin comprimir (`reproduccion._video_en_zip`). Antes
de construir eso hay que saber cuantos son, y eso lo dice la cabecera del
primer volumen: unos KB por archivo.

Solo lee. Coge al azar titulos (peliculas y episodios) que no tienen ningun
enlace que se pueda ver, uno de sus archivos comprimidos por titulo, y mira
el primer volumen. Lo lanza el panel (`/api/admin/telegram/muestra-comprimidos`)
y el resultado vive en memoria.
"""
import asyncio
import collections
import logging
import random
import re
import struct
import time

from app.services.reproduccion import clasificar, EXT_VIDEO
from app.services.storage import _detect_multipart

logger = logging.getLogger("tmd")

LEER = 256 * 1024     # lo que se lee del principio de cada archivo
PAUSA = 0.3           # entre archivo y archivo, para no apretar a Telegram

_estado: dict = {"estado": "sin_empezar"}
_tarea = None


# --- Cabeceras ---------------------------------------------------------------

def _vint(b: bytes, i: int) -> tuple[int, int]:
    """Entero de longitud variable de RAR5 (7 bits por byte)."""
    valor, desplazamiento = 0, 0
    while True:
        if i >= len(b):
            raise IndexError("vint cortado")
        c = b[i]
        valor |= (c & 0x7F) << desplazamiento
        i += 1
        if not c & 0x80:
            return valor, i
        desplazamiento += 7


def _es_video(nombre: str) -> bool:
    return nombre.lower().endswith(EXT_VIDEO)


def _rar5(b: bytes) -> dict:
    i = 8
    otros = []
    while i < len(b):
        inicio = i
        i += 4                                   # CRC
        tam_cab, i = _vint(b, i)
        fin_cab = i + tam_cab
        tipo, i = _vint(b, i)
        banderas, i = _vint(b, i)
        tam_extra = tam_datos = 0
        if banderas & 0x0001:
            tam_extra, i = _vint(b, i)
        if banderas & 0x0002:
            tam_datos, i = _vint(b, i)
        if tipo == 4:
            return {"clase": "cifrado", "detalle": "rar5 con las cabeceras cifradas"}
        if tipo == 5:
            break
        if tipo == 2:
            fbanderas, i = _vint(b, i)
            _tam, i = _vint(b, i)
            _attr, i = _vint(b, i)
            if fbanderas & 0x0002:
                i += 4
            if fbanderas & 0x0004:
                i += 4
            compresion, i = _vint(b, i)
            _so, i = _vint(b, i)
            largo, i = _vint(b, i)
            nombre = b[i:i + largo].decode("utf-8", "replace")
            cifrado = False
            j = fin_cab - tam_extra
            while j < fin_cab:
                tam_reg, k = _vint(b, j)
                tipo_reg, _ = _vint(b, k)
                if tipo_reg == 0x01:
                    cifrado = True
                j = k + tam_reg
            if fbanderas & 0x0001:               # es un directorio
                pass
            elif _es_video(nombre):
                return _veredicto("rar5", nombre, (compresion >> 7) & 7, cifrado, otros)
            else:
                otros.append(nombre)
        i = fin_cab + tam_datos
        if i <= inicio:
            break
    return {"clase": "sin_video", "detalle": f"rar5; antes del video: {otros[:3]}"}


def _rar4(b: bytes) -> dict:
    i = 7
    otros = []
    while i + 7 <= len(b):
        _crc, tipo, banderas, tam_cab = struct.unpack_from("<HBHH", b, i)
        if tam_cab < 7:
            break
        extra = 0
        if tipo == 0x73 and banderas & 0x0080:
            return {"clase": "cifrado", "detalle": "rar4 con las cabeceras cifradas"}
        if tipo == 0x74:
            empaquetado, = struct.unpack_from("<I", b, i + 7)
            metodo = b[i + 25]
            largo, = struct.unpack_from("<H", b, i + 26)
            n = i + 32
            if banderas & 0x0100:
                alto, = struct.unpack_from("<I", b, n)
                empaquetado |= alto << 32
                n += 8
            crudo = b[n:n + largo]
            nombre = crudo.split(b"\0", 1)[0].decode("utf-8", "replace")
            if _es_video(nombre):
                return _veredicto("rar4", nombre, 0 if metodo == 0x30 else metodo - 0x30,
                                  bool(banderas & 0x0004), otros)
            if (banderas & 0x00E0) != 0x00E0:   # no es un directorio
                otros.append(nombre)
            extra = empaquetado
        elif banderas & 0x8000:
            extra, = struct.unpack_from("<I", b, i + 7)
        i += tam_cab + extra
    return {"clase": "sin_video", "detalle": f"rar4; antes del video: {otros[:3]}"}


def _zip(b: bytes) -> dict:
    i = 0
    otros = []
    while i + 30 <= len(b) and b[i:i + 4] == b"PK\x03\x04":
        banderas, metodo = struct.unpack_from("<HH", b, i + 6)
        comprimido, = struct.unpack_from("<I", b, i + 18)
        largo, largo_extra = struct.unpack_from("<HH", b, i + 26)
        nombre = b[i + 30:i + 30 + largo].decode("utf-8", "replace")
        if _es_video(nombre):
            return _veredicto("zip", nombre, metodo, bool(banderas & 0x01), otros)
        otros.append(nombre)
        i += 30 + largo + largo_extra + comprimido
    return {"clase": "sin_video", "detalle": f"zip; antes del video: {otros[:3]}"}


_FIRMAS_VIDEO = ((b"\x1a\x45\xdf\xa3", 0, "mkv"), (b"ftyp", 4, "mp4"), (b"RIFF", 0, "avi"))


def _7z(b: bytes) -> dict:
    """El metodo de un 7z esta en la cabecera del final (en el ultimo volumen)
    y suele ir comprimida ella misma. Pero los datos empiezan justo despues de
    los 32 bytes de la firma, sin cabecera por archivo: almacenado, ahi esta
    el video tal cual (o, si delante va un .nfo, unos bytes despues). En un
    flujo comprimido que aparezca la firma de un MKV o un MP4 por azar es
    casi imposible."""
    datos = b[32:]
    for firma, desfase, formato in _FIRMAS_VIDEO:
        i = datos.find(firma)
        if i >= desfase:
            return {"clase": "almacenado", "formato": "7z",
                    "detalle": f"7z: {formato} tal cual en el byte {32 + i - desfase}"}
    return {"clase": "comprimido", "formato": "7z",
            "detalle": f"7z: ningun video tal cual en {len(b) // 1024} KB; empieza por {datos[:4].hex()}"}


def _veredicto(formato: str, nombre: str, metodo: int, cifrado: bool, otros: list) -> dict:
    if cifrado:
        clase = "cifrado"
    elif metodo == 0:
        clase = "almacenado"
    else:
        clase = "comprimido"
    detalle = f"{formato} metodo {metodo}"
    if otros:
        detalle += f"; antes del video: {otros[:3]}"
    return {"clase": clase, "formato": formato, "video": nombre, "detalle": detalle}


def analizar(b: bytes) -> dict:
    """Que guarda un primer volumen, por sus primeros bytes."""
    try:
        if b.startswith(b"Rar!\x1a\x07\x01\x00"):
            return _rar5(b)
        if b.startswith(b"Rar!\x1a\x07\x00"):
            return _rar4(b)
        if b.startswith(b"PK\x03\x04"):
            return _zip(b)
        if b.startswith(b"7z\xbc\xaf\x27\x1c"):
            return _7z(b)
        if b.startswith(b"\x1a\x45\xdf\xa3"):
            return {"clase": "video_troceado", "detalle": "mkv partido sin archivador"}
        if b[4:8] == b"ftyp":
            return {"clase": "video_troceado", "detalle": "mp4 partido sin archivador"}
        if b.startswith(b"RIFF"):
            return {"clase": "video_troceado", "detalle": "avi partido sin archivador"}
    except (IndexError, struct.error) as e:
        return {"clase": "sin_video", "detalle": f"cabecera mas larga que lo leido ({e})"}
    return {"clase": "desconocido", "detalle": b[:8].hex()}


# --- La muestra ----------------------------------------------------------------

_RNN = re.compile(r"\.r\d{2,}$", re.IGNORECASE)


def _es_primero(nombre: str) -> bool:
    """Si ese archivo es el primer volumen (o el unico)."""
    if _RNN.search(nombre):            # .r00, .r01: el primero es el .rar
        return False
    base, parte, _ = _detect_multipart(nombre)
    return base is None or parte in (0, 1)


async def _poblacion() -> list[dict]:
    """Un candidato por titulo que no tenga ningun enlace que se pueda ver."""
    from app.database.connection import get_pool
    async with get_pool().acquire() as conn:
        filas = await conn.fetch("""
            SELECT channel_id, channel_name, message_id, file_name, file_size,
                   tmdb_id, tmdb_type, media_type, season, episode
            FROM media_items WHERE tmdb_valid AND tmdb_id IS NOT NULL""")
    titulos = collections.defaultdict(lambda: {"ver": False, "grupos": collections.defaultdict(list)})
    for f in filas:
        serie = f["media_type"] == "series" or f["tmdb_type"] == "tv"
        u = ("tv", f["tmdb_id"], f["season"], f["episode"]) if serie else ("movie", f["tmdb_id"])
        t = titulos[u]
        k = clasificar(f["file_name"])
        if k in ("video", "partes"):
            t["ver"] = True
        elif k in ("zip", "comprimido"):
            nombre = f["file_name"]
            base = _detect_multipart(nombre)[0] or _RNN.sub("", nombre)
            base = re.sub(r"\.rar$", "", base, flags=re.IGNORECASE)
            t["grupos"][(f["channel_id"], base.lower())].append(f)
    candidatos = []
    for u, t in titulos.items():
        if t["ver"] or not t["grupos"]:
            continue
        opciones = []
        for partes in t["grupos"].values():
            primero = next((p for p in partes if _es_primero(p["file_name"])), None)
            if primero:
                opciones.append((primero, sum(p["file_size"] or 0 for p in partes), len(partes)))
        if opciones:
            f, tam, n = random.choice(opciones)
            candidatos.append({"tipo": u[0], "channel_id": f["channel_id"],
                               "canal": f["channel_name"] or str(f["channel_id"]),
                               "message_id": f["message_id"], "file_name": f["file_name"],
                               "bytes": tam, "partes": n})
    return candidatos


async def _leer_principio(dl, channel_id: int, ids: list[int]) -> dict[int, bytes | Exception]:
    from app.services.reproduccion import _documentos
    docs = await _documentos(dl, channel_id, ids)
    salida = {}
    for mid in ids:
        d = docs.get(mid)
        if d is None:
            salida[mid] = LookupError("el mensaje ya no tiene archivo")
            continue
        try:
            trozos = []
            async for t in dl.client.iter_download(d, request_size=LEER, limit=1, file_size=d.size):
                trozos.append(bytes(t))
            salida[mid] = b"".join(trozos)
        except Exception as e:
            salida[mid] = e
        await asyncio.sleep(PAUSA)
    return salida


async def _medir(n: int):
    global _estado
    from app.services.reproduccion import _downloader
    empezado = time.time()
    _estado = {"estado": "midiendo", "hechos": 0, "empezado": empezado}
    try:
        poblacion = await _poblacion()
        muestra = random.sample(poblacion, min(n, len(poblacion)))
        _estado.update(poblacion=len(poblacion), total=len(muestra),
                       bytes_poblacion=sum(c["bytes"] for c in poblacion))
        dl = _downloader()
        por_canal = collections.defaultdict(list)
        for c in muestra:
            por_canal[c["channel_id"]].append(c)
        resultados = []
        for channel_id, cs in por_canal.items():
            for i in range(0, len(cs), 50):
                lote = cs[i:i + 50]
                try:
                    leido = await _leer_principio(dl, channel_id, [c["message_id"] for c in lote])
                except Exception as e:
                    leido = {c["message_id"]: e for c in lote}
                for c in lote:
                    b = leido.get(c["message_id"])
                    if isinstance(b, Exception) or b is None:
                        r = {"clase": "error", "detalle": f"{type(b).__name__}: {b}"}
                    else:
                        r = analizar(b)
                    resultados.append({**c, **r})
                    _estado["hechos"] = len(resultados)
        _estado = {"estado": "hecho", "segundos": round(time.time() - empezado),
                   "poblacion": _estado["poblacion"], "bytes_poblacion": _estado["bytes_poblacion"],
                   **_resumir(resultados)}
        logger.info("Muestra de comprimidos: %s", _estado["resumen"])
    except Exception as e:
        logger.exception("Muestra de comprimidos")
        _estado = {"estado": "error", "motivo": str(e)}


def _resumir(resultados: list[dict]) -> dict:
    resumen = collections.defaultdict(lambda: {"n": 0, "bytes": 0})
    por_canal = collections.defaultdict(collections.Counter)
    ejemplos = collections.defaultdict(list)
    for r in resultados:
        claves = [r["clase"], f'{r["tipo"]}:{r["clase"]}']
        if r.get("formato"):
            claves.append(f'{r["formato"]}:{r["clase"]}')
        for k in claves:
            resumen[k]["n"] += 1
            resumen[k]["bytes"] += r["bytes"]
        por_canal[r["canal"]][r["clase"]] += 1
        if len(ejemplos[r["clase"]]) < 5:
            ejemplos[r["clase"]].append({"archivo": r["file_name"], "detalle": r.get("detalle"),
                                         "video": r.get("video")})
    return {"total": len(resultados), "resumen": dict(resumen),
            "por_canal": {k: dict(v) for k, v in sorted(por_canal.items(), key=lambda x: -sum(x[1].values()))},
            "ejemplos": dict(ejemplos)}


def empezar(n: int) -> dict:
    global _tarea
    from app.tasks import spawn
    if _tarea is not None and not _tarea.done():
        return _estado
    _tarea = spawn(_medir(n), name="muestra-comprimidos")
    return {"estado": "midiendo", "hechos": 0}


def estado() -> dict:
    return _estado
