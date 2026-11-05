"""Leer el indice (Cues) de un MKV aunque el SeekHead del principio no lo
nombre (services/mkv.py `cabecera`).

Los MKV que escribe libwebm (los «[x265]» de iZombie y The Expanse) llevan al
principio un SeekHead que **solo apunta a otro SeekHead al final**, y es ese el
que dice donde estan las Cues. Se fabrica uno asi a mano, byte a byte, con la
misma forma que el de verdad, y otro normal para comprobar que no cambia.

    PYTHONPATH=backend python3 backend/tests/prueba_mkv.py
"""
import asyncio
import struct
import sys

from app.services import mkv

fallos = []


def comprueba(nombre, esperado, obtenido):
    if esperado == obtenido:
        print(f"  ok  {nombre}")
    else:
        fallos.append(nombre)
        print(f"  MAL {nombre}: esperado {esperado!r}, obtenido {obtenido!r}")


def _id(eid: int) -> bytes:
    return eid.to_bytes((eid.bit_length() + 7) // 8, "big")


def _tam(n: int) -> bytes:
    return (0x10000000 | n).to_bytes(4, "big")   # siempre en 4 bytes: mas facil de colocar


def el(eid: int, datos: bytes) -> bytes:
    return _id(eid) + _tam(len(datos)) + datos


def uint(eid: int, v: int) -> bytes:
    return el(eid, v.to_bytes(8, "big"))


def seek(cual: int, donde: int) -> bytes:
    return el(mkv.SEEK, el(mkv.SEEK_ID, _id(cual)) + uint(mkv.SEEK_POS, donde))


def fabricar(anidado: bool, bucle: bool = False) -> bytes:
    """EBML + Segment de tamaño desconocido. Con `anidado`, el SeekHead del
    principio solo apunta a un segundo SeekHead al final, que apunta a las
    Cues; si no, el del principio apunta a las Cues directamente."""
    cabeza_ebml = el(0x1A45DFA3, el(0x4282, b"matroska"))
    info = el(mkv.INFO, uint(mkv.TIMESTAMP_SCALE, 1_000_000) + el(mkv.DURATION, struct.pack(">d", 90_000.0)))
    pistas = el(mkv.TRACKS, el(mkv.TRACK_ENTRY, uint(mkv.TRACK_NUMBER, 1) + uint(mkv.TRACK_TYPE, 1)))
    cues = el(mkv.CUES, b"".join(
        el(mkv.CUE_POINT, uint(mkv.CUE_TIME, ms) + el(mkv.CUE_TRACK_POSITIONS, uint(mkv.CUE_TRACK, 1)))
        for ms in (0, 4000, 9500, 15000)))
    relleno = b"\xec" + _tam(200_000) + bytes(200_000)   # un Void: "los clusters"

    # Las posiciones del SeekHead son relativas al principio de los datos del
    # Segment; el primero ocupa siempre lo mismo, asi que se puede calcular.
    primero_largo = len(el(mkv.SEEKHEAD, seek(mkv.CUES, 0)))
    antes = primero_largo + len(info) + len(pistas) + len(relleno)
    if anidado:
        segundo = el(mkv.SEEKHEAD, seek(mkv.SEEKHEAD, 0) if bucle else
                     seek(mkv.CUES, antes + len(el(mkv.SEEKHEAD, seek(mkv.CUES, 0)))))
        primero = el(mkv.SEEKHEAD, seek(mkv.SEEKHEAD, antes))
        cuerpo = primero + info + pistas + relleno + segundo + cues
    else:
        primero = el(mkv.SEEKHEAD, seek(mkv.CUES, antes))
        cuerpo = primero + info + pistas + relleno + cues
    assert len(primero) == primero_largo
    segmento = _id(mkv.SEGMENT) + b"\x01\xff\xff\xff\xff\xff\xff\xff" + cuerpo
    return cabeza_ebml + segmento


def lector(datos: bytes):
    async def leer(desde, cuanto):
        return datos[desde:desde + cuanto]
    return leer


async def main():
    print("Indice de un MKV")
    normal = fabricar(anidado=False)
    comprueba("el normal: SeekHead que apunta a las Cues", ([0.0, 4.0, 9.5, 15.0], 90.0),
              await mkv.fotogramas_clave(lector(normal), len(normal)))
    anidado = fabricar(anidado=True)
    comprueba("el de libwebm: SeekHead que apunta a otro SeekHead al final", ([0.0, 4.0, 9.5, 15.0], 90.0),
              await mkv.fotogramas_clave(lector(anidado), len(anidado)))
    bucle = fabricar(anidado=True, bucle=True)
    comprueba("un SeekHead que apunta a si mismo no da vueltas sin fin", None,
              await mkv.fotogramas_clave(lector(bucle), len(bucle)))
    cab = await mkv.cabecera(lector(anidado), len(anidado))
    comprueba("y la cabecera sabe donde estan las Cues", True, cab is not None and mkv.CUES in cab[1])


asyncio.run(main())
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)
