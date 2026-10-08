"""Avisar a quien pidio una descarga de que ya ha terminado.

Es el otro aviso de la casa, al lado del de episodio nuevo
(`services/avisos.py`), y no se parece en nada por una razon: aquel es un
**vigilante** que mira cada diez minutos lo que ha llegado a los canales,
porque cuando un archivo se indexa todavia no se sabe de que serie es. Este se
manda **en el momento**, desde el final de la descarga, porque ahi ya se sabe
todo: quien la pidio, que titulo es y que archivos han caido.

Tres cuidados, los tres aprendidos del otro aviso:

* **Va a la cuenta que la pidio**, no a todo el mundo. Una descarga la ve todo
  el mundo pero la pidio alguien, y el aviso es para quien esta esperandola.
* **Enviar no puede romper la descarga.** Es lo ultimo que pasa, cuando el
  archivo ya esta en su sitio y la fila ya dice `done`; si el servicio de push
  falla, se registra y se sigue.
* **El texto dice el titulo, no el nombre del fichero.** `Suits 3x08` se
  entiende en la pantalla de bloqueo; `Suits.S03E08.1080p.WEB-DL.x264.mkv`,
  no. El nombre bonito lo pone el catalogo (TMDB) cuando lo hay, y si no la
  carpeta de destino, que es lo que `layout.py` ya calculo con el mejor dato
  disponible.
"""
import logging
import os

logger = logging.getLogger("tmd")


def etiqueta(season: int | None, episode: int | None) -> str | None:
    """'3x08'. Sin temporada (los animes numerados de corrido) solo el numero."""
    if episode is None:
        return None
    if season:
        return f"{season}x{episode:02d}"
    return f"episodio {episode}"


def texto(titulo: str, season: int | None = None, episode: int | None = None,
          tamano: str = "") -> tuple[str, str]:
    """El titulo y el cuerpo del aviso.

    El titulo del aviso es el del contenido y no «Descarga completada»: en la
    pantalla de bloqueo lo que se lee primero es la primera linea, y lo que
    interesa saber de un vistazo es *que* ha bajado.
    """
    titulo = (titulo or "La descarga").strip()
    ep = etiqueta(season, episode)
    cabecera = f"{titulo} · {ep}" if ep else titulo
    cuerpo = "Descarga completada: ya se puede ver"
    if tamano:
        cuerpo = f"Descarga completada ({tamano}): ya se puede ver"
    return cabecera, cuerpo


async def avisar(owner_id: int | None, *, titulo: str, tmdb_id: int | None = None,
                 tmdb_type: str | None = None, season: int | None = None,
                 episode: int | None = None, tamano: str = "",
                 poster: str | None = None, batch_id: str = "") -> int:
    """Manda el aviso. Devuelve a cuantos aparatos ha llegado (0 si a ninguno).

    No levanta nunca: la descarga ya ha terminado bien y un aviso que no sale
    no puede convertir eso en un error.
    """
    if not owner_id:
        return 0
    try:
        from app.services.push import enviar

        cabecera, cuerpo = texto(titulo, season, episode, tamano)
        return await enviar(owner_id, {
            "title": cabecera,
            "body": cuerpo,
            "tmdb_id": tmdb_id,
            "kind": "series" if tmdb_type == "tv" else "movie",
            "poster": poster,
            # Un aviso por descarga: dos episodios distintos son dos avisos,
            # pero reintentar el mismo lote no apila dos iguales.
            "tag": f"descarga-{batch_id}" if batch_id else "descarga",
            "reason": "descarga",
        })
    except Exception as e:
        logger.warning("No se pudo avisar de la descarga terminada (%s): %s", titulo, e)
        return 0


def titulo_de(batch: dict, catalogo: dict | None, archivos: list[str]) -> str:
    """El nombre bonito de lo que se ha bajado.

    Por orden de cuanto se puede confiar en el: el titulo de TMDB, la carpeta
    de destino que calculo `layout.py` (que ya salio de TMDB si lo habia), y
    por ultimo el nombre del archivo sin extension.
    """
    if catalogo and catalogo.get("tmdb_title"):
        return catalogo["tmdb_title"]
    if batch.get("folder_name"):
        return batch["folder_name"]
    if archivos:
        return os.path.splitext(os.path.basename(archivos[0]))[0]
    return batch.get("base_name") or "La descarga"
