"""Bajar un archivo de Telegram por varias conexiones a la vez.

`client.download_media()` pide el archivo en trozos de 512 KB **de uno en uno**:
pide un trozo, espera la respuesta, la descifra, la escribe y solo entonces pide
el siguiente. La velocidad queda atada a la latencia y no al ancho de banda: con
~100 ms por ida y vuelta salen unos 5 MB/s como mucho, sea la cuenta Premium o
no. Premium quita el limite que pone Telegram, pero ese limite ya no era el que
mandaba.

Aqui cada conexion pide trozos alternos (la 0 el 0, N, 2N...; la 1 el 1, N+1...)
y los escribe en su sitio del archivo, igual que hacen la app de escritorio de
Telegram o FastTelethon. Cada conexion es un `MTProtoSender` propio: varias
peticiones por la misma conexion se encolan detras de las respuestas de 512 KB
de las otras y no se gana casi nada.

Usa piezas internas de Telethon 1.x (`MTProtoSender`, `_get_dc`, `_connection`,
`_create_exported_sender`), estables desde hace años pero internas. Por eso, si
algo falla **antes de recibir un solo byte**, se lanza `SinParalelo` y quien
llama vuelve a `download_media()`: mas lento, pero baja.
"""
import asyncio
import concurrent.futures
import copy
import logging
import os
import time

from telethon import errors, functions, types
from telethon.network import MTProtoSender
from telethon.tl.alltlobjects import LAYER

logger = logging.getLogger("tmd")

# Lo que se pide en cada upload.getFile: 1 MB, el maximo que admite Telegram
# (con offsets multiplos de esto ningun trozo cruza un limite de 1 MB, que
# tambien lo exige). Medido en el servidor, Telegram no limita los bytes sino
# las peticiones: con 512 KB se quedaba en ~10 por segundo y 5,3 MB/s, con
# miles de esperas forzosas. Si un DC rechaza el tamaño se vuelve a 512 KB,
# que es lo que pide Telethon.
TROZO = 1024 * 1024
TROZO_PEQUENO = 512 * 1024

# Por debajo de esto no compensa abrir conexiones: cada una son un par de idas
# y vueltas antes del primer byte.
TROZOS_POR_CONEXION_MIN = 4

REINTENTOS = 5

# Escribir en disco no puede frenar el bucle de eventos (es el mismo que sirve
# el streaming), y tampoco se puede cerrar el archivo con escrituras en vuelo:
# un descriptor cerrado se reutiliza y el hilo escribiria en otro archivo.
_disco = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="tmd-disco")


class SinParalelo(Exception):
    """No se pudo preparar la descarga en paralelo; usar la normal."""


class _TrozoRechazado(Exception):
    """Telegram no acepta trozos de ese tamaño; probar con los pequeños."""


def motor_cifrado():
    """Con que descifra Telethon: 'cryptg', 'libssl' o 'python' (muy lento)."""
    from telethon.crypto import aes, libssl
    if aes.cryptg:
        return "cryptg"
    if libssl.decrypt_ige:
        return "libssl"
    return "python"


def reparto(total_trozos, conexiones):
    """Cuantos trozos le tocan a cada conexion (la i baja i, i+n, i+2n...)."""
    n = max(1, min(conexiones, total_trozos // TROZOS_POR_CONEXION_MIN or 1))
    return [len(range(i, total_trozos, n)) for i in range(n)]


async def _abrir_conexiones(client, dc_id, n):
    """`n` conexiones autorizadas contra el DC donde vive el archivo."""
    dc = await client._get_dc(dc_id)

    def nueva(auth_key):
        return MTProtoSender(auth_key, loggers=client._log)

    def conexion():
        return client._connection(dc.ip_address, dc.port, dc.id, loggers=client._log,
                                  proxy=client._proxy, local_addr=client._local_addr)

    async def iniciar(sender):
        # Lo mismo que hace Telethon con su conexion principal: decir quienes
        # somos y en que capa del protocolo hablamos.
        init = copy.copy(client._init_request)
        init.query = functions.help.GetNearestDcRequest()
        await sender.send(functions.InvokeWithLayerRequest(LAYER, init))

    async def otra(auth_key):
        s = nueva(auth_key)
        await s.connect(conexion())
        await iniciar(s)
        return s

    if dc_id == client.session.dc_id:
        clave = client.session.auth_key
        return list(await asyncio.gather(*[otra(clave) for _ in range(n)]))

    # El archivo vive en otro DC: la primera conexion exporta la autorizacion
    # (eso crea una clave nueva y cuesta un segundo); el resto reusa esa clave.
    primera = await client._create_exported_sender(dc_id)
    resto = await asyncio.gather(*[otra(primera.auth_key) for _ in range(n - 1)])
    return [primera, *resto]


async def bajar(client, msg, destino, conexiones, progreso=None):
    """Baja el documento de `msg` a `destino` usando `conexiones` conexiones.

    `progreso(actual, total)` se llama tras cada trozo escrito. Escribe en
    `destino` directamente: quien llama decide el nombre (y si es temporal).
    """
    try:
        return await _bajar(client, msg, destino, conexiones, progreso, TROZO)
    except _TrozoRechazado:
        logger.info("Telegram no acepta trozos de %d KB para %s: se baja en trozos de %d KB",
                    TROZO // 1024, msg.id, TROZO_PEQUENO // 1024)
        return await _bajar(client, msg, destino, conexiones, progreso, TROZO_PEQUENO)


async def _bajar(client, msg, destino, conexiones, progreso, trozo):
    doc = getattr(msg.media, "document", None)
    if not isinstance(doc, types.Document):
        raise SinParalelo("no es un documento")

    tamano = doc.size
    total_trozos = (tamano + trozo - 1) // trozo
    reparto_ = reparto(total_trozos, conexiones)
    n = len(reparto_)
    ubicacion = types.InputDocumentFileLocation(
        id=doc.id, access_hash=doc.access_hash,
        file_reference=doc.file_reference, thumb_size="")

    try:
        senders = await asyncio.wait_for(_abrir_conexiones(client, doc.dc_id, n), timeout=30)
    except Exception as e:
        raise SinParalelo(f"no se pudieron abrir las conexiones: {type(e).__name__}: {e}") from e

    fd = os.open(destino, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    en_vuelo = set()
    escrito = 0
    # Las esperas que impone Telegram, por tipo: FLOOD_WAIT es un limite de
    # peticiones; FLOOD_PREMIUM_WAIT es el freno a las cuentas sin Premium.
    esperas = {}
    segundos_esperando = 0
    referencia_lock = asyncio.Lock()
    inicio = time.monotonic()

    async def refrescar_referencia(vieja):
        # La referencia de un archivo caduca (horas); en una descarga larga
        # puede pasar a mitad. Se vuelve a leer el mensaje, una vez por caducidad
        # aunque la detecten varias conexiones a la vez.
        async with referencia_lock:
            if ubicacion.file_reference != vieja:
                return
            nuevo = await client.get_messages(await msg.get_input_chat(), ids=msg.id)
            d = getattr(getattr(nuevo, "media", None), "document", None)
            if not d or d.id != doc.id:
                raise ValueError("El mensaje ha cambiado durante la descarga")
            ubicacion.file_reference = d.file_reference

    async def pedir(sender, offset):
        nonlocal segundos_esperando
        fallos = 0
        while True:
            referencia = ubicacion.file_reference
            try:
                # Directo por la conexion y no por client._call: ese duerme las
                # esperas de Telegram por su cuenta (e ignora el
                # flood_sleep_threshold que se le pasa, mira solo el del
                # cliente), y aqui hay que verlas para contarlas y saber de que
                # tipo son.
                r = await sender.send(functions.upload.GetFileRequest(
                    location=ubicacion, offset=offset, limit=trozo))
                return r.bytes
            except (errors.FloodWaitError, errors.FloodPremiumWaitError) as e:
                tipo = "FLOOD_PREMIUM_WAIT" if isinstance(e, errors.FloodPremiumWaitError) else "FLOOD_WAIT"
                esperas[tipo] = esperas.get(tipo, 0) + 1
                pausa = max(1, e.seconds)
                segundos_esperando += pausa
                await asyncio.sleep(pausa)
            except (errors.FileReferenceExpiredError, errors.FilerefUpgradeNeededError):
                await refrescar_referencia(referencia)
            except errors.LimitInvalidError:
                if escrito == 0 and trozo > TROZO_PEQUENO:
                    raise _TrozoRechazado()
                raise
            except errors.FileMigrateError as e:
                if escrito == 0:
                    raise SinParalelo(f"el archivo vive en el DC {e.new_dc}") from e
                raise
            except (errors.TimedOutError, errors.ServerError, errors.RpcCallFailError,
                    ConnectionError, OSError) as e:
                fallos += 1
                if fallos >= REINTENTOS:
                    raise
                logger.info("Trozo %d de %s: %s, reintentando", offset // trozo, msg.id, type(e).__name__)
                await asyncio.sleep(fallos)

    async def trabajador(i, sender):
        nonlocal escrito
        for k in range(reparto_[i]):
            offset = (i + k * n) * trozo
            datos = await pedir(sender, offset)
            esperado = min(trozo, tamano - offset)
            if len(datos) != esperado:
                raise IOError(f"Telegram devolvio {len(datos)} bytes en el trozo "
                              f"{offset // trozo} y se esperaban {esperado}")
            cf = _disco.submit(os.pwrite, fd, datos, offset)
            en_vuelo.add(cf)
            try:
                await asyncio.wrap_future(cf)
            finally:
                en_vuelo.discard(cf)
            escrito += len(datos)
            if progreso:
                progreso(escrito, tamano)

    tareas = [asyncio.ensure_future(trabajador(i, s)) for i, s in enumerate(senders)]
    try:
        await asyncio.gather(*tareas)
    except BaseException:
        # gather avisa del primer fallo pero deja a las demas conexiones
        # bajando, y escribirian en un archivo que se va a cerrar.
        for t in tareas:
            t.cancel()
        await asyncio.gather(*tareas, return_exceptions=True)
        raise
    finally:
        # Primero que acaben las escrituras en curso (si se ha cancelado, sus
        # hilos siguen); despues cerrar el archivo y las conexiones.
        if en_vuelo:
            await asyncio.get_running_loop().run_in_executor(
                None, concurrent.futures.wait, list(en_vuelo))
        os.close(fd)
        await asyncio.gather(*[s.disconnect() for s in senders], return_exceptions=True)

    segundos = max(time.monotonic() - inicio, 0.001)
    frenos = ", ".join(f"{v} {k}" for k, v in sorted(esperas.items())) or "ninguna"
    logger.info("Descargado %s | %.1f MB en %.0f s | %.1f MB/s | %d conexiones | trozos de %d KB | "
                "esperas de Telegram: %s (%d s en total, sumando las de todas las conexiones)",
                os.path.basename(destino), tamano / 1e6, segundos, tamano / 1e6 / segundos, n,
                trozo // 1024, frenos, segundos_esperando)
    return destino
