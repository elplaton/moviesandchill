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
    plantilla = s.get(CLAVE_PLANTILLA) or PLANTILLA_POR_DEFECTO
    return {
        "chat_id": int(chat) if chat.lstrip("-").isdigit() else None,
        "chat_nombre": s.get(CLAVE_CHAT_NOMBRE) or "",
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
    """Todos los chats de la cuenta, primero donde se puede escribir. Marca
    los que son canales del catalogo, que suelen ser los que tienen grupo de
    peticiones al lado."""
    from telethon import utils

    from app.database.connection import get_pool

    cliente = _cliente()
    catalogo: set[int] = set()
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            catalogo = {r["channel_id"] for r in await conn.fetch("SELECT channel_id FROM channels")}
    out = []
    async for d in cliente.iter_dialogs(limit=800):
        ent = d.entity
        out.append({
            "id": utils.get_peer_id(ent),
            "nombre": d.name or "(sin nombre)",
            "tipo": _tipo(ent),
            "usuario": getattr(ent, "username", None),
            "puede_escribir": _puede_escribir(ent),
            "del_catalogo": abs(getattr(ent, "id", 0)) in catalogo,
        })
    out.sort(key=lambda c: (not c["puede_escribir"], not c["del_catalogo"], c["nombre"].lower()))
    return out


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


async def _mandar(cliente, destino, texto: str, poster: str | None):
    """El mensaje, con la caratula si la hay: la foto con el texto de pie.

    Va a 500 px y no a los 342 que se guardan para las tarjetas: en Telegram
    se ve grande. La imagen la descarga Telegram de la URL de TMDB; si no la
    acepta (pasa a veces con URLs externas), se manda el texto solo. La
    peticion no se puede perder por la foto.
    """
    if poster and len(texto) <= MAX_PIE:
        try:
            return await cliente.send_file(destino, poster.replace("/w342/", "/w500/"), caption=texto)
        except Exception as e:
            logger.warning("Peticion: la caratula no se pudo mandar (%s); va solo el texto", str(e)[:120])
    return await cliente.send_message(destino, texto, link_preview=False)


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
        if existente and existente["estado"] == "enviada":
            # Ya pedida: no se escribe otra vez, se espera con los demas.
            await db.sumar(existente["id"], user_id, origen=False)
            return {"estado": "enviada", "ya_pedida": True}

        if not es_admin and await db.mandadas_hoy(user_id) >= LIMITE_DIA:
            raise PeticionError(f"Ya has hecho {LIMITE_DIA} peticiones hoy; vuelve mañana", 429)

        ficha = await get_details(api_key, tmdb_id, tipo) if api_key else None
        if not ficha:
            raise PeticionError("No se ha encontrado ese título en TMDB", 404)
        datos = {"tmdb_id": tmdb_id, "media_type": tipo, "titulo": ficha.get("title") or "",
                 "titulo_original": ficha.get("original_title"), "year": ficha.get("year"),
                 "poster": ficha.get("poster")}
        texto = rellenar(conf["plantilla"], datos)

        try:
            cliente = _cliente()
            destino = await _destino(cliente, conf["chat_id"])
            mensaje = await _mandar(cliente, destino, texto, datos.get("poster"))
        except PeticionError as e:
            await db.guardar_fallida(datos, str(e))
            raise
        except Exception as e:
            logger.warning("Peticion de %s/%d no se pudo mandar: %s", tipo, tmdb_id, e)
            await db.guardar_fallida(datos, str(e))
            raise PeticionError(f"Telegram no ha dejado mandar el mensaje: {str(e)[:120]}", 502)

        pid = await db.guardar_enviada(datos, conf["chat_id"], conf["chat_nombre"],
                                       getattr(mensaje, "id", None))
        await db.sumar(pid, user_id, origen=True)
        logger.info("Peticion mandada a %s: %s", conf["chat_nombre"] or conf["chat_id"],
                    texto.splitlines()[0])
        return {"estado": "enviada", "ya_pedida": False}


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
    await asyncio.sleep(60)
    while True:
        try:
            await repasar()
        except Exception as e:
            logger.error("Vigilante de peticiones fallo: %s", e)
        await asyncio.sleep(max(minutos, 1) * 60)
