"""Pedir lo que no tenemos.

Si un titulo no esta en el catalogo se puede buscar en TMDB y pedirlo: el
servidor escribe un mensaje en el chat de Telegram que el admin haya elegido
(hay canales con grupo de peticiones) y, cuando el titulo aparece indexado,
avisa a quien lo pidio.

Tres cosas a tener presentes:

* **El mensaje sale de la cuenta de Telegram del servidor**, que es la de
  quien lo administra. Cualquiera que use la app escribe ahi en su nombre, y
  por eso hay limite (`LIMITE_DIA` por cuenta; el admin no lo tiene) y nada
  se manda dos veces: quien pide algo ya pedido se suma a la espera.
* **El chat y el texto los elige el admin** (pestaña Peticiones del panel),
  entre todos los chats de la cuenta. Cada grupo tiene sus normas de formato,
  asi que la plantilla lleva huecos (`{titulo}`, `{año}`...) en vez de un
  texto fijo.
* **"Ha llegado" es que haya un archivo del titulo con ficha valida**
  (`tmdb_valid`), lo mismo que hace falta para salir en la portada. Lo mira
  un vigilante cada pocos minutos: cuando el archivo se indexa todavia no se
  sabe de que titulo es (eso lo decide el bucle de TMDB despues).
"""
import asyncio
import logging

logger = logging.getLogger("tmd")

CLAVE_CHAT_ID = "peticiones_chat_id"
CLAVE_CHAT_NOMBRE = "peticiones_chat_nombre"
CLAVE_PLANTILLA = "peticiones_plantilla"
# El tema del grupo donde se escribe. Muchos grupos de peticiones son foros:
# dentro hay temas ("General", "Peticiones", "Avisos"...) y solo en uno se
# pide. Sin tema el mensaje caeria en "General".
CLAVE_TEMA_ID = "peticiones_tema_id"
CLAVE_TEMA_NOMBRE = "peticiones_tema_nombre"
# En Telegram el tema "General" de un foro es el 1, y ahi se escribe sin mas.
TEMA_GENERAL = 1

PLANTILLA_POR_DEFECTO = "#peticion {titulo} ({año}) · {tipo}\n{enlace}"
# Los huecos que entiende la plantilla, con lo que se ve en la vista previa.
HUECOS = {
    "titulo": "Título en español",
    "titulo_original": "Título original",
    "año": "Año de estreno",
    "tipo": "«Película» o «Serie»",
    "enlace": "Enlace a la ficha de TMDB",
}
LIMITE_DIA = 3
MINUTOS_VIGILANTE = 5
# Como mucho una peticion a la hora en total, para no inundar el grupo: lo
# pedido entra en una cola que sale de una en una. El admin la puede
# reordenar, vaciar o mandar algo ya.
MINUTOS_ENTRE_ENVIOS = 60
# Con mas de esto en cola se avisa al admin (una vez cada vez que se pasa).
AVISO_COLA = 5
CLAVE_AVISO_COLA = "peticiones_aviso_cola"
# Estados en los que una peticion sigue viva (hay quien la espera).
PENDIENTES = ("en_cola", "enviada")

# Un solo envio a la vez: dos personas pidiendo lo mismo en el mismo segundo
# mandarian dos mensajes, porque ninguna veria aun la fila de la otra.
_envio = asyncio.Lock()


class PeticionError(Exception):
    """Algo que se le cuenta al usuario tal cual, con su codigo HTTP."""

    def __init__(self, mensaje: str, codigo: int = 400):
        super().__init__(mensaje)
        self.codigo = codigo


def tipo_cliente(media_type: str) -> str:
    return "series" if media_type == "tv" else "movie"


def tipo_tmdb(media_type: str) -> str | None:
    if media_type in ("series", "tv"):
        return "tv"
    if media_type == "movie":
        return "movie"
    return None


def rellenar(plantilla: str, datos: dict) -> str:
    """La plantilla con sus huecos. Se sustituye a mano y no con `format()`:
    unas llaves de mas en lo que escribe el admin no pueden tumbar el envio."""
    valores = {
        "titulo": datos.get("titulo") or "",
        "titulo_original": datos.get("titulo_original") or datos.get("titulo") or "",
        "año": str(datos.get("year") or "").strip(),
        "tipo": "Serie" if datos.get("media_type") == "tv" else "Película",
        "enlace": (f"https://www.themoviedb.org/{datos.get('media_type') or 'movie'}/"
                   f"{datos.get('tmdb_id')}"),
    }
    texto = plantilla or PLANTILLA_POR_DEFECTO
    for hueco, valor in valores.items():
        texto = texto.replace("{" + hueco + "}", valor)
    # Sin año queda "Titulo ()": se quita el parentesis vacio en vez de
    # mandarlo asi.
    return texto.replace(" ()", "").replace("()", "").strip()


EJEMPLO = {"tmdb_id": 693134, "media_type": "movie", "titulo": "Dune: Parte dos",
           "titulo_original": "Dune: Part Two", "year": 2024}


async def ajustes() -> dict:
    from app.database.connection import get_app_settings

    s = await get_app_settings()
    chat = s.get(CLAVE_CHAT_ID) or ""
    tema = s.get(CLAVE_TEMA_ID) or ""
    plantilla = s.get(CLAVE_PLANTILLA) or PLANTILLA_POR_DEFECTO
    return {
        "chat_id": int(chat) if chat.lstrip("-").isdigit() else None,
        "chat_nombre": s.get(CLAVE_CHAT_NOMBRE) or "",
        "tema_id": int(tema) if tema.isdigit() else None,
        "tema_nombre": s.get(CLAVE_TEMA_NOMBRE) or "",
        "plantilla": plantilla,
        "plantilla_por_defecto": PLANTILLA_POR_DEFECTO,
        "huecos": HUECOS,
        "ejemplo": rellenar(plantilla, EJEMPLO),
        "limite_dia": LIMITE_DIA,
    }


def _cliente():
    """El cliente de Telethon del servidor, si esta conectado y con sesion."""
    from app.routers.download import downloader

    if downloader is None or downloader.client is None or not downloader.client.is_connected():
        raise PeticionError("Telegram no está conectado en el servidor", 503)
    return downloader.client


def _puede_escribir(ent) -> bool:
    """Si la cuenta puede escribir en ese chat. En un canal solo publican sus
    admins; en un grupo, todos salvo que lo tengan prohibido (a todos, o a esta
    cuenta en concreto)."""
    from telethon.tl.types import Channel, Chat, User

    if isinstance(ent, User):
        return not getattr(ent, "deleted", False)
    if getattr(ent, "left", False) or getattr(ent, "deactivated", False):
        return False
    prohibido = lambda r: bool(r and getattr(r, "send_messages", False))  # noqa: E731
    if isinstance(ent, Channel):
        if ent.creator:
            return True
        if ent.broadcast:
            return bool(ent.admin_rights and ent.admin_rights.post_messages)
        if ent.admin_rights:
            return True
        return not (prohibido(ent.banned_rights) or prohibido(ent.default_banned_rights))
    if isinstance(ent, Chat):
        return not prohibido(ent.default_banned_rights)
    return False


def _tipo(ent) -> str:
    from telethon.tl.types import Channel, User

    if isinstance(ent, User):
        return "bot" if ent.bot else "persona"
    if isinstance(ent, Channel) and ent.broadcast:
        return "canal"
    return "grupo"


async def chats() -> list[dict]:
    """Todos los chats de la cuenta, primero donde se puede escribir.

    Marca los del catalogo (`del_catalogo`): los canales que se indexan **y
    sus grupos de conversacion**, que es donde suelen estar las peticiones (un
    canal de difusion no deja escribir a nadie). Y si un grupo es un foro
    (`foro`): entonces hay que elegir tambien el tema (`temas()`)."""
    from telethon import utils
    from telethon.tl import functions, types as tl

    from app.database.connection import get_pool

    cliente = _cliente()
    catalogo: set[int] = set()
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            catalogo = {r["channel_id"] for r in await conn.fetch("SELECT channel_id FROM channels")}
    dialogos = [d async for d in cliente.iter_dialogs(limit=800)]

    # El grupo de conversacion de cada canal del catalogo. Son pocos canales,
    # asi que una consulta por canal no pesa.
    enlazado_a: dict[int, str] = {}
    for d in dialogos:
        ent = d.entity
        if isinstance(ent, tl.Channel) and ent.broadcast and ent.id in catalogo:
            try:
                full = await cliente(functions.channels.GetFullChannelRequest(ent))
                if full.full_chat.linked_chat_id:
                    enlazado_a[full.full_chat.linked_chat_id] = d.name or ""
            except Exception as e:
                logger.debug("Peticiones: sin grupo enlazado para %s: %s", d.name, e)

    out = []
    for d in dialogos:
        ent = d.entity
        ident = abs(getattr(ent, "id", 0))
        out.append({
            "id": utils.get_peer_id(ent),
            "nombre": d.name or "(sin nombre)",
            "tipo": _tipo(ent),
            "usuario": getattr(ent, "username", None),
            "puede_escribir": _puede_escribir(ent),
            "del_catalogo": ident in catalogo or ident in enlazado_a,
            # A que canal del catalogo pertenece este grupo de conversacion.
            "grupo_de": enlazado_a.get(ident),
            "foro": bool(getattr(ent, "forum", False)),
        })
    out.sort(key=lambda c: (not c["del_catalogo"], not c["puede_escribir"], c["nombre"].lower()))
    return out


async def temas(chat_id: int) -> list[dict]:
    """Los temas de un grupo con foro, en el orden en que salen en Telegram.
    Un tema cerrado solo deja escribir a los admins del grupo."""
    from telethon.tl import functions, types as tl

    cliente = _cliente()
    destino = await _destino(cliente, chat_id)
    try:
        r = await cliente(functions.messages.GetForumTopicsRequest(
            peer=destino, offset_date=None, offset_id=0, offset_topic=0, limit=100))
    except Exception as e:
        raise PeticionError(f"No se han podido leer los temas: {str(e)[:120]}", 502)
    return [{"id": t.id, "titulo": t.title, "cerrado": bool(getattr(t, "closed", False)),
             "general": t.id == TEMA_GENERAL}
            for t in r.topics if isinstance(t, tl.ForumTopic)]


async def _destino(cliente, chat_id: int):
    """La entidad a la que escribir. Lo normal es que este en la cache de la
    sesion (el panel ha listado los chats); si no, se busca entre los chats."""
    try:
        return await cliente.get_input_entity(chat_id)
    except Exception:
        from telethon import utils

        async for d in cliente.iter_dialogs(limit=800):
            if utils.get_peer_id(d.entity) == chat_id:
                return d.entity
    raise PeticionError("El chat de peticiones ya no está entre los de la cuenta: elige otro en Admin", 409)


# El pie de una foto en Telegram mide como mucho 1024 caracteres; la
# plantilla esta limitada a 1000, asi que cabe salvo titulos imposibles.
MAX_PIE = 1024


async def _mandar(cliente, destino, texto: str, poster: str | None, tema: int | None = None):
    """El mensaje, con la caratula si la hay: la foto con el texto de pie.

    Va a 500 px y no a los 342 que se guardan para las tarjetas: en Telegram
    se ve grande. La imagen la descarga Telegram de la URL de TMDB; si no la
    acepta (pasa a veces con URLs externas), se manda el texto solo. La
    peticion no se puede perder por la foto.
    """
    # En un foro, el mensaje va al tema elegido respondiendo a su mensaje de
    # apertura (asi lo hace Telegram por dentro). En "General" no hace falta.
    tema_kw = {"reply_to": tema} if tema and tema != TEMA_GENERAL else {}
    if poster and len(texto) <= MAX_PIE:
        try:
            return await cliente.send_file(destino, poster.replace("/w342/", "/w500/"), caption=texto,
                                           **tema_kw)
        except Exception as e:
            logger.warning("Peticion: la caratula no se pudo mandar (%s); va solo el texto", str(e)[:120])
    return await cliente.send_message(destino, texto, link_preview=False, **tema_kw)


async def pedir(user_id: int, es_admin: bool, tmdb_id: int, media_type: str, api_key: str) -> dict:
    """Pide un titulo. Devuelve {"estado", "ya_pedida"}; lo que no se puede
    hacer sale como `PeticionError` con un texto para el usuario."""
    from app.database import peticiones as db
    from app.services.tmdb import get_details

    tipo = tipo_tmdb(media_type)
    if not tipo:
        raise PeticionError("Tipo de título desconocido")
    conf = await ajustes()
    if not conf["chat_id"]:
        raise PeticionError("Aún no se ha elegido a qué chat de Telegram van las peticiones", 409)
    if (tmdb_id, tipo) in await db.en_catalogo([(tmdb_id, tipo)]):
        raise PeticionError("Ya está en el catálogo", 409)

    async with _envio:
        existente = await db.de_titulo(tmdb_id, tipo)
        if existente and existente["estado"] in PENDIENTES:
            # Ya pedida (en cola o mandada): no entra otra vez, se espera con
            # los demas.
            await db.sumar(existente["id"], user_id, origen=False)
            return {"estado": existente["estado"], "ya_pedida": True,
                    "puesto": await db.puesto(existente["id"])}

        if not es_admin and await db.mandadas_hoy(user_id) >= LIMITE_DIA:
            raise PeticionError(f"Ya has hecho {LIMITE_DIA} peticiones hoy; vuelve mañana", 429)

        ficha = await get_details(api_key, tmdb_id, tipo) if api_key else None
        if not ficha:
            raise PeticionError("No se ha encontrado ese título en TMDB", 404)
        datos = {"tmdb_id": tmdb_id, "media_type": tipo, "titulo": ficha.get("title") or "",
                 "titulo_original": ficha.get("original_title"), "year": ficha.get("year"),
                 "poster": ficha.get("poster")}
        pid = await db.encolar(datos)
        await db.sumar(pid, user_id, origen=True)
        puesto = await db.puesto(pid)
        logger.info("Peticion en cola (puesto %s): %s", puesto, datos["titulo"])
    await avisar_cola()
    return {"estado": "en_cola", "ya_pedida": False, "puesto": puesto}


async def _mandar_peticion(p: dict, conf: dict) -> None:
    """Escribe en Telegram una peticion de la cola y la marca enviada o
    fallida. Una que falla sale de la cola con su motivo: reintentarla sola
    cada hora contra un chat que no deja escribir no arregla nada."""
    from app.database import peticiones as db

    datos = {"tmdb_id": p["tmdb_id"], "media_type": p["media_type"], "titulo": p["titulo"],
             "titulo_original": None, "year": p.get("year"), "poster": p.get("poster")}
    texto = rellenar(conf["plantilla"], datos)
    try:
        cliente = _cliente()
        destino = await _destino(cliente, conf["chat_id"])
        mensaje = await _mandar(cliente, destino, texto, datos.get("poster"), conf.get("tema_id"))
    except Exception as e:
        motivo = str(e) if isinstance(e, PeticionError) else f"Telegram no ha dejado mandarla: {str(e)[:120]}"
        logger.warning("Peticion «%s» no se pudo mandar: %s", p["titulo"], motivo)
        await db.marcar_fallida(p["id"], motivo)
        return
    donde = conf["chat_nombre"] + (f" › {conf['tema_nombre']}" if conf.get("tema_nombre") else "")
    await db.marcar_enviada(p["id"], conf["chat_id"], donde, getattr(mensaje, "id", None))
    logger.info("Peticion mandada a %s: %s", donde or conf["chat_id"], texto.splitlines()[0])


async def segundos_para_siguiente() -> int:
    """Cuanto falta para que salga la siguiente de la cola (0 = en el proximo
    minuto)."""
    from app.database import peticiones as db

    return await db.segundos_para_siguiente(MINUTOS_ENTRE_ENVIOS)


async def despachar() -> bool:
    """Si toca (ha pasado una hora desde el ultimo envio), manda la primera de
    la cola. Devuelve si ha mandado algo."""
    from app.database import peticiones as db

    conf = await ajustes()
    if not conf["chat_id"]:
        return False
    async with _envio:
        if await segundos_para_siguiente() > 0:
            return False
        lista = await db.cola()
        if not lista:
            return False
        await _mandar_peticion(lista[0], conf)
    await avisar_cola()
    return True


async def enviar_ya(peticion_id: int) -> None:
    """El admin manda una de la cola sin esperar su turno. Cuenta como envio:
    la siguiente espera su hora desde ahora."""
    from app.database import peticiones as db

    conf = await ajustes()
    if not conf["chat_id"]:
        raise PeticionError("Aún no se ha elegido a qué chat de Telegram van las peticiones", 409)
    async with _envio:
        p = await db.por_id(peticion_id)
        if not p or p["estado"] != "en_cola":
            raise PeticionError("Esa petición ya no está en la cola", 409)
        await _mandar_peticion(p, conf)
    await avisar_cola()


async def avisar_cola() -> None:
    """Con mas de AVISO_COLA en cola, un aviso al movil de los admins. Una vez
    cada vez que se pasa el umbral: si la cola baja y vuelve a subir, otra."""
    from app.database import peticiones as db
    from app.database.connection import get_app_settings, get_pool, set_app_settings
    from app.services.push import enviar

    n = await db.cuantas_en_cola()
    avisado = (await get_app_settings()).get(CLAVE_AVISO_COLA) == "1"
    if n <= AVISO_COLA:
        if avisado:
            await set_app_settings({CLAVE_AVISO_COLA: "0"})
        return
    if avisado:
        return
    await set_app_settings({CLAVE_AVISO_COLA: "1"})
    pool = get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        admins = [r["id"] for r in await conn.fetch(
            "SELECT id FROM users WHERE role = 'admin' AND active IS NOT FALSE")]
    for uid in admins:
        try:
            await enviar(uid, {"title": "Peticiones en cola",
                               "body": f"Hay {n} peticiones esperando a salir (sale una cada hora)",
                               "reason": "peticiones", "tag": "peticiones-cola"})
        except Exception as e:
            logger.warning("Aviso de cola al admin %d fallo: %s", uid, e)
    logger.info("Peticiones: %d en cola, avisado a %d admins", n, len(admins))


async def probar(api_key: str, plantilla: str | None = None) -> str:
    """Manda el mensaje de ejemplo (con su caratula) a los Mensajes guardados
    de la cuenta: es la forma de ver como queda sin escribir en el grupo.
    Devuelve el texto mandado."""
    from app.services.tmdb import get_details

    conf = await ajustes()
    ficha = await get_details(api_key, EJEMPLO["tmdb_id"], EJEMPLO["media_type"]) if api_key else None
    datos = {**EJEMPLO, **({"poster": ficha.get("poster")} if ficha else {})}
    texto = rellenar(plantilla or conf["plantilla"], datos)
    try:
        await _mandar(_cliente(), "me", texto, datos.get("poster"))
    except PeticionError:
        raise
    except Exception as e:
        raise PeticionError(f"Telegram no ha dejado mandar la prueba: {str(e)[:120]}", 502)
    return texto


async def repasar() -> int:
    """Una pasada del vigilante: lo pedido que ya esta en el catalogo se da
    por conseguido y se avisa a quien lo esperaba. Devuelve cuantos avisos."""
    from app.database import peticiones as db
    from app.services.push import enviar

    avisos = 0
    for p in await db.llegadas():
        await db.marcar_conseguida(p["id"])
        for user_id in p["por_avisar"] or []:
            try:
                llego = await enviar(user_id, {
                    "title": "Ya está lo que pediste",
                    "body": f"{p['titulo']} ya se puede ver o descargar",
                    "tmdb_id": p["tmdb_id"],
                    "kind": tipo_cliente(p["media_type"]),
                    "poster": p["poster"],
                    "tag": f"peticion-{p['id']}",
                })
            except Exception as e:
                # El titulo ya ha llegado: un aviso que no sale no lo cambia.
                logger.warning("Aviso de peticion a la cuenta %d fallo: %s", user_id, e)
                llego = 0
            # Se marca aunque no haya llegado a ningun aparato (igual que los
            # avisos de episodios): si no, el dia que se suscriba le llegaria.
            await db.marcar_avisado(p["id"], user_id)
            avisos += 1 if llego else 0
        logger.info("Peticion conseguida: %s (%d esperando)", p["titulo"], len(p["por_avisar"] or []))
    return avisos


async def vigilante(minutos: float = MINUTOS_VIGILANTE) -> None:
    """Cada minuto mira si toca mandar la siguiente de la cola; cada
    `minutos`, si ha llegado algo de lo pedido. Lo que llega estando aun en
    la cola se da por conseguido sin mandarse."""
    await asyncio.sleep(60)
    vuelta = 0
    while True:
        try:
            if vuelta % max(int(minutos), 1) == 0:
                await repasar()
            await despachar()
        except Exception as e:
            logger.error("Vigilante de peticiones fallo: %s", e)
        vuelta += 1
        await asyncio.sleep(60)
