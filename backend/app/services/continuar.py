"""La fila "Continuar viendo".

Dos reglas que la definen, y que son las que complican lo que si no seria un
simple ORDER BY:

1. **Una tarjeta por titulo, la del capitulo mas avanzado.** Lo que decide
   que dos filas son el mismo titulo es su ficha de TMDB (`clave_titulo`), y
   solo sin ficha la carpeta: lo visto sin descargar no tiene carpeta, y
   agrupando solo por ella cada capitulo salia como una tarjeta. De cada serie
   manda el capitulo mas avanzado (temporada y episodio mas altos), no el
   ultimo que se toco: volver a ver el 2x03 no puede tapar que vas por el 4x08.

2. **Al terminar un episodio se ofrece el siguiente.** Por eso el historial no
   se borra al acabar: una fila terminada es justo lo que permite saber por
   donde seguir. Si el siguiente no esta en disco, el titulo desaparece de la
   fila (no se ofrece algo que no se puede reproducir).
"""
import os
import re

# Por debajo de esto no se considera que se haya empezado: un video que se
# abre y se cierra a los diez segundos no deberia aparecer en la portada.
MIN_SEGUNDOS = 30
# A partir de aqui se da por visto. Es el mismo 95 % que ya usaban el movil y
# la tele cuando esto vivia en localStorage.
FIN = 0.95

EP_RE = re.compile(r"(\d{1,2})x(\d{2,3})|[sS](\d{1,2})[eE](\d{1,3})")
# Estructura antigua: una carpeta por temporada ("Suits S1", "Suits S2"). Son
# el mismo titulo, asi que comparten grupo; si no, cada temporada saldria como
# una tarjeta distinta y el episodio siguiente nunca cruzaria de una a otra.
SUFIJO_TEMPORADA_RE = re.compile(r"^(.*?)\s*[sS](\d{1,2})\s*$")
DIR_TEMPORADA_RE = re.compile(r"^(?:temporada|season)\s*(\d{1,2})$", re.IGNORECASE)
VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts"}


def _base() -> str:
    from app.routers.download import config
    return os.path.realpath(config["extract_path"])


def ruta_relativa(path: str) -> str | None:
    """La ruta que se guarda es relativa a la biblioteca.

    Los clientes mandan la absoluta (es lo que les devuelve /files), pero
    guardarla asi ataria el progreso a donde este montada la biblioteca: la
    misma pelicula es /app/movies/... en Docker y /Users/.../movies/... en
    desarrollo. Devuelve None si la ruta se sale de la biblioteca.
    """
    if not path:
        return None
    base = _base()
    destino = os.path.realpath(os.path.join(base, path))
    if destino != base and not destino.startswith(base + os.sep):
        return None
    rel = os.path.relpath(destino, base)
    return None if rel.startswith("..") else rel


def grupo_de(rel: str) -> str:
    """La carpeta del titulo: el primer tramo de la ruta relativa. Un video
    suelto en la raiz es su propio grupo, y "Suits S1" y "Suits S2" son el
    mismo (ver SUFIJO_TEMPORADA_RE)."""
    partes = rel.split(os.sep)
    primero = partes[0] if len(partes) > 1 else rel
    m = SUFIJO_TEMPORADA_RE.match(primero)
    return m.group(1).strip() if m else primero


def _carpetas_del_grupo(grupo: str) -> list[str]:
    """Las carpetas de la biblioteca que son este titulo. Normalmente una; con
    la estructura antigua, una por temporada."""
    base = _base()
    exacta = os.path.join(base, grupo)
    carpetas = [exacta] if os.path.isdir(exacta) else []
    try:
        for d in os.listdir(base):
            ruta = os.path.join(base, d)
            if ruta == exacta or not os.path.isdir(ruta):
                continue
            m = SUFIJO_TEMPORADA_RE.match(d)
            if m and m.group(1).strip() == grupo:
                carpetas.append(ruta)
    except OSError:
        pass
    return carpetas


def temporada_y_episodio(rel: str) -> tuple[int | None, int | None]:
    """Del nombre del archivo, y si ahi no hay temporada, de la carpeta
    "Temporada N" que lo contiene (asi es como los guarda layout.py)."""
    nombre = os.path.basename(rel)
    m = EP_RE.search(nombre)
    if not m:
        return None, None
    temporada = m.group(1) or m.group(3)
    episodio = m.group(2) or m.group(4)
    if temporada is None:
        carpeta = os.path.basename(os.path.dirname(rel))
        md = DIR_TEMPORADA_RE.match(carpeta)
        temporada = md.group(1) if md else None
    return (int(temporada) if temporada is not None else None,
            int(episodio) if episodio is not None else None)


def episodios_en_disco(grupo: str) -> list[tuple[int, int, str]]:
    """(temporada, episodio, ruta relativa) de todo lo que hay en la carpeta de
    la serie, ordenado. Se recorre el disco y no la tabla media_items porque lo
    que importa es lo que se puede reproducir ahora mismo, no lo indexado."""
    base = _base()
    fuera = []
    for raiz in _carpetas_del_grupo(grupo):
        for carpeta, _, ficheros in os.walk(raiz):
            for f in ficheros:
                if os.path.splitext(f)[1].lower() not in VIDEO_EXTS:
                    continue
                rel = os.path.relpath(os.path.join(carpeta, f), base)
                t, e = temporada_y_episodio(rel)
                if t is not None and e is not None:
                    fuera.append((t, e, rel))
    return sorted(fuera)


def siguiente_episodio(rel: str, terminados: set[str] | None = None,
                       marcados: set[tuple[int, int]] | None = None) -> dict | None:
    """El episodio que va despues del de `rel`, si esta descargado.

    Se compara por (temporada, episodio) y no por el orden del listado, asi el
    salto de final de temporada al primero de la siguiente sale solo.

    `terminados` son las rutas que esta cuenta ya ha visto enteras: se saltan.
    Sin eso, a quien se viera el 8 y luego volviera a ver el 7 se le ofrecia el
    8 otra vez. `marcados` son los (temporada, episodio) que ha marcado a mano
    como vistos, que es lo mismo pero sin haberlos reproducido aqui.
    """
    t, e = temporada_y_episodio(rel)
    if t is None or e is None:
        return None
    terminados = terminados or set()
    marcados = marcados or set()
    for ts, es, ruta in episodios_en_disco(grupo_de(rel)):
        if (ts, es) > (t, e) and ruta not in terminados and (ts, es) not in marcados:
            return {"path": ruta, "season": ts, "episode": es}
    return None


def _etiqueta_episodio(season, episode) -> str | None:
    if season is None or episode is None:
        return None
    return f"{season}x{episode:02d}"


def _tarjeta(fila: dict, path: str, position: float, duration: float,
             season, episode, siguiente: bool) -> dict:
    # En la tarjeta del episodio siguiente el subtitulo se recalcula: el
    # guardado es el del episodio anterior, y poner "3x07" sobre el 3x08
    # confunde justo donde hay que confiar en lo que pone.
    subtitulo = _etiqueta_episodio(season, episode) if siguiente else fila.get("subtitle")
    return {
        "path": path,
        "title": fila.get("title") or grupo_de(path),
        "subtitle": subtitulo,
        "poster": fila.get("poster"),
        "backdrop": fila.get("backdrop"),
        "tmdb_id": fila.get("tmdb_id"),
        "media_type": "series" if fila.get("tmdb_type") == "tv" else "movie",
        "grupo": fila.get("grupo"),
        "season": season,
        "episode": episode,
        "position": position,
        "duration": duration,
        # Si es el episodio siguiente (empieza de cero) en vez de reanudar uno
        # a medias. Los clientes lo usan para decir "Empezar" y no "Continuar".
        "next_episode": siguiente,
        "updated": fila["updated_at"].isoformat() if fila.get("updated_at") else None,
    }


def clave_titulo(fila: dict) -> tuple:
    """Que titulo es una fila del historial: su ficha si la tiene; si no, su
    carpeta."""
    if fila.get("tmdb_id"):
        return ("tmdb", fila.get("tmdb_type") or "", fila["tmdb_id"])
    return ("grupo", fila.get("grupo") or grupo_de(fila["path"]))


def _terminada(f: dict) -> bool:
    duracion = float(f.get("duration") or 0)
    return duracion > 0 and float(f.get("position") or 0) / duracion >= FIN


def _vale(f: dict) -> bool:
    """Si una fila puede dar tarjeta: terminada (ofrece el siguiente) o
    empezada de verdad y todavia reproducible."""
    if _terminada(f):
        return True
    if float(f.get("position") or 0) < MIN_SEGUNDOS or float(f.get("duration") or 0) <= 0:
        return False
    # `tg:<canal>:<msg>` se vio sin descargar: no esta en disco y no tiene
    # por que estarlo.
    return f["path"].startswith("tg:") or os.path.isfile(os.path.join(_base(), f["path"]))


def _mas_avanzada(filas: list[dict]) -> dict | None:
    """De las filas de un mismo titulo que valen, la del capitulo mas avanzado.
    Llegan de la mas reciente a la mas vieja, asi que sin capitulos (una
    pelicula, o filas que no lo saben) gana la primera, y a igual capitulo
    tambien. Solo entre las que valen: si el capitulo mas alto se abrio diez
    segundos o se borro del disco, la serie no puede desaparecer de la fila."""
    validas = [f for f in filas if _vale(f)]
    if not validas:
        return None
    con_capitulo = [f for f in validas if f.get("episode") is not None]
    if not con_capitulo:
        return validas[0]
    return max(con_capitulo, key=lambda f: (f.get("season") or 0, f["episode"]))


def continuar_viendo(filas: list[dict], limite: int = 20,
                     marcados: dict[int, set[tuple[int, int]]] | None = None) -> list[dict]:
    """Las tarjetas de la fila, a partir del historial de la cuenta.

    `filas` llega ya ordenada de lo mas reciente a lo mas viejo: las tarjetas
    salen en el orden de lo ultimo que se toco de cada titulo, y de cada uno
    el capitulo mas avanzado (`_mas_avanzada`). `marcados` son los episodios que la
    cuenta ha marcado como vistos a mano, por tmdb_id: no se ofrecen como
    siguiente aunque esten en disco y sin reproducir.
    """
    tarjetas: list[dict] = []
    terminados = {f["path"] for f in filas
                  if (f.get("duration") or 0) > 0
                  and float(f["position"]) / float(f["duration"]) >= FIN}

    # Por titulo, en el orden de lo ultimo que se toco de cada uno.
    por_titulo: dict[tuple, list[dict]] = {}
    for f in filas:
        por_titulo.setdefault(clave_titulo(f), []).append(f)

    for grupo_filas in por_titulo.values():
        fila = _mas_avanzada(grupo_filas)
        if fila is None:
            continue

        rel = fila["path"]
        posicion = float(fila.get("position") or 0)
        duracion = float(fila.get("duration") or 0)
        temporada, episodio = fila.get("season"), fila.get("episode")

        if not _terminada(fila):
            tarjetas.append(_tarjeta(fila, rel, posicion, duracion, temporada, episodio, False))
        else:
            sig = siguiente_episodio(rel, terminados,
                                     (marcados or {}).get(fila.get("tmdb_id")))
            if not sig:
                continue  # pelicula terminada, o serie sin mas episodios en disco
            tarjetas.append(_tarjeta(fila, sig["path"], 0.0, 0.0,
                                     sig["season"], sig["episode"], True))

        if len(tarjetas) >= limite:
            break

    return tarjetas
