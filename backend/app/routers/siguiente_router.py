"""El siguiente episodio: /api/next-up.

Dos endpoints y nada mas:

* `GET /api/next-up?path=…` dice que viene despues de lo que se esta viendo:
  si el siguiente esta en disco, cuantos quedan por delante y cuales se
  pueden bajar. Lo pide el reproductor cuando el capitulo se acerca al final.
* `POST /api/next-up/download` baja los proximos. **Recalcula** cuales son en
  vez de fiarse de lo que mande el cliente: entre que se pinto la tarjeta y
  que alguien la pulso pueden haber pasado minutos, y en ese rato otra cuenta
  puede haber bajado ya ese episodio.

Lo que decide cada cosa esta en `services/siguiente.py`; aqui solo esta quien
pregunta y las comprobaciones de cuota, que son las de siempre porque la
descarga pasa por `iniciar_descarga()`, la misma funcion que el boton de la
ficha.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_account, get_current_user

logger = logging.getLogger("tmd")

router = APIRouter(prefix="/api", tags=["siguiente"])

# Tope de lo que una sola peticion puede poner a descargar. La regla normal
# son dos episodios; esto es para que un cliente con una version rara no
# pueda pedir media serie de una vez.
MAX_DE_GOLPE = 4


class SiguienteRequest(BaseModel):
    path: str
    tmdb_id: int | None = None
    # Cuantos bajar. Si no se dice, lo decide el servidor con la regla de
    # siempre: dos si no hay nada delante, uno si queda la reserva.
    count: int | None = None


async def _user_id(username: str) -> int | None:
    from app.database.users import get_user_by_username
    user = await get_user_by_username(username)
    return user["id"] if user else None


@router.get("/next-up")
async def next_up(path: str, user: Annotated[str, Depends(get_current_user)],
                  tmdb_id: int | None = None):
    """Que viene despues de este archivo.

    No se cachea a proposito: la respuesta depende de lo que haya en disco
    **ahora** y de lo que esta bajando **ahora**, y se pide una vez por
    capitulo. Una respuesta de hace cinco minutos podria ofrecer bajar algo
    que ya esta bajando.
    """
    from app.services.siguiente import que_viene

    uid = await _user_id(user)
    if uid is None:
        return {"kind": "desconocido"}
    try:
        return await que_viene(path, uid, tmdb_id)
    except Exception as e:
        # Que falle esto no puede estropear el final de un capitulo: sin
        # respuesta el reproductor simplemente no ofrece nada.
        logger.warning("No se pudo calcular el siguiente episodio de %s: %s", path, e)
        return {"kind": "desconocido"}


@router.post("/next-up/download")
async def next_up_download(req: SiguienteRequest,
                           account: Annotated[dict, Depends(get_current_account)]):
    """Baja los proximos episodios de la serie que se esta viendo.

    Devuelve que se ha puesto en marcha y que no, con el motivo: la cuota, un
    archivo que ya estaba, o que entre medias lo cogiera otro. El cliente lo
    enseña tal cual, porque «no se ha podido» sin decir por que es lo que hace
    que alguien piense que la app esta rota.
    """
    from app.routers.download_router import iniciar_descarga
    from app.services.siguiente import que_viene

    datos = await que_viene(req.path, account["id"], req.tmdb_id)
    if datos.get("kind") != "series":
        return {"started": [], "errors": ["Esto no es un episodio de una serie"]}

    pedidos = datos.get("descargables") or []
    if req.count is not None:
        pedidos = pedidos[:max(0, min(req.count, MAX_DE_GOLPE))]
    if not pedidos:
        return {"started": [], "errors": ["No hay episodios nuevos que bajar"]}

    arrancados, errores = [], []
    for ep in pedidos:
        try:
            res = await iniciar_descarga(ep["message_id"], ep.get("channel_id"), account)
        except Exception as e:
            logger.warning("No se pudo bajar %s: %s", ep.get("label"), e)
            errores.append(f"{ep.get('label')}: no se pudo empezar")
            continue
        if res.get("error"):
            errores.append(f"{ep.get('label')}: {res['error']}")
            # Si no cabe en la cuota, el siguiente tampoco va a caber.
            if res.get("quota_exceeded"):
                break
            continue
        arrancados.append({"label": ep.get("label"), "season": ep.get("season"),
                           "episode": ep.get("episode"), "batch_id": res.get("batch_id"),
                           "folder_name": res.get("folder_name")})
    return {"started": arrancados, "errors": errores}
