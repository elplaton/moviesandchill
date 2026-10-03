"""Donde se guarda cada descarga en disco.

    peliculas:  <extract>/<Titulo (Año)>/<Titulo (Año)>.<ext>
    series:     <extract>/<Serie>/Temporada N/<N>x<EE>.<ext>

Los nombres de serie y pelicula salen de TMDB cuando el catalogo los tiene
(asi todas las cuentas y todos los ripeos caen en la misma carpeta); si no,
del nombre del archivo. Un episodio se descarga en una carpeta temporal
dentro de su temporada y al acabar se renombra y se sube un nivel.
"""
import os
import re

from app.services.title_parser import parse_filename

VIDEO_EXTS = ('.mkv', '.mp4', '.avi', '.ts', '.m4v', '.mov', '.wmv', '.flv', '.webm')
WORK_PREFIX = ".dl_"

# La misma pelicula se baja en varias calidades y todas caian en
# <Titulo (Año)>/<Titulo (Año)>.mkv: la segunda borraba a la primera sin
# avisar. El nombre lleva ahora la calidad, asi que 4K y 1080p conviven.
_RESOLUCION_RE = re.compile(r"(?<![\w])(2160p|1080p|720p|576p|480p|4k|uhd)(?![\w])", re.IGNORECASE)
_MATIZ_RE = re.compile(r"(?<![\w])(remux|hdr10\+|hdr10|hdr|dolby ?vision|dovi|bluray|blu-?ray|web-?dl|webrip|bdrip|brrip|hdtv|dvdrip)(?![\w])", re.IGNORECASE)
_NORMAL = {"4k": "2160p", "uhd": "2160p", "blu-ray": "BluRay", "bluray": "BluRay",
           "webdl": "WEB-DL", "web-dl": "WEB-DL", "dolbyvision": "DV", "dolby vision": "DV", "dovi": "DV"}


def etiqueta_calidad(file_name: str) -> str:
    """"1080p", "2160p HDR"... o cadena vacia si el nombre no dice nada.

    Es lo que distingue una version de otra en disco, asi que se queda corta a
    proposito: resolucion y, como mucho, un matiz. Mas palabras darian nombres
    de archivo ilegibles sin separar mejor.
    """
    partes = []
    res = _RESOLUCION_RE.search(file_name)
    if res:
        t = res.group(1).lower()
        partes.append(_NORMAL.get(t, t))
    mat = _MATIZ_RE.search(file_name)
    if mat:
        t = mat.group(1).lower().replace(" ", "")
        partes.append(_NORMAL.get(t, mat.group(1).upper() if len(t) <= 5 else mat.group(1).title()))
    return " ".join(partes)


def ruta_libre(final_dir: str, stem: str, ext: str) -> str:
    """Primer nombre que no exista: <stem><ext>, <stem> (2)<ext>...

    Antes se hacia os.remove(dst) cuando el destino existia. Eso es destruir el
    archivo de otro para poner el tuyo, que es justo lo que pasaba con las dos
    calidades de una pelicula.
    """
    dst = os.path.join(final_dir, f"{stem}{ext}")
    n = 2
    while os.path.exists(dst):
        dst = os.path.join(final_dir, f"{stem} ({n}){ext}")
        n += 1
    return dst


def sanitize(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "", name).strip().rstrip(".")
    return name or "descarga"


def plan(extract_path: str, file_name: str, catalog: dict | None, batch_id: str) -> dict:
    """Decide carpeta de trabajo, carpeta final y nombre final para un archivo."""
    parsed = parse_filename(file_name)
    tmdb_title = (catalog or {}).get("tmdb_title")
    tmdb_type = (catalog or {}).get("tmdb_type")
    tmdb_year = (catalog or {}).get("tmdb_year")
    season = (catalog or {}).get("season") if catalog and catalog.get("season") is not None else parsed.season
    episode = (catalog or {}).get("episode") if catalog and catalog.get("episode") is not None else parsed.episode
    is_series = (catalog or {}).get("media_type") == "series" if catalog else parsed.media_type == "series"

    if is_series and episode is not None:
        series = tmdb_title if tmdb_type == "tv" and tmdb_title else (parsed.title or parsed.clean_title or "Serie")
        season = season or 1
        season_dir = os.path.join(extract_path, sanitize(series), f"Temporada {season}")
        return {
            "kind": "series", "series": series, "season": season, "episode": episode,
            "final_dir": season_dir,
            "final_stem": f"{season}x{episode:02d}",
            "work_dir": os.path.join(season_dir, f"{WORK_PREFIX}{batch_id}"),
            "folder_name": f"{sanitize(series)} {season}x{episode:02d}",
        }

    title = tmdb_title if tmdb_type == "movie" and tmdb_title else (parsed.title or parsed.clean_title or "Pelicula")
    year = tmdb_year or parsed.year
    folder = sanitize(f"{title} ({year})" if year and str(year) not in title else title)
    final_dir = os.path.join(extract_path, folder)
    calidad = etiqueta_calidad(file_name)
    return {
        "kind": "movie", "final_dir": final_dir,
        "final_stem": sanitize(f"{folder} - {calidad}") if calidad else folder,
        "calidad": calidad,
        "work_dir": os.path.join(final_dir, f"{WORK_PREFIX}{batch_id}"),
        "folder_name": f"{folder} - {calidad}" if calidad else folder,
    }


def finalize_episode(work_dir: str, final_dir: str, stem: str) -> list[str]:
    """Mueve los videos de la carpeta temporal a su carpeta definitiva con el
    nombre final (episodio o pelicula) y borra la temporal. Devuelve las rutas."""
    import shutil
    videos = sorted(
        os.path.join(root, f)
        for root, _d, files in os.walk(work_dir)
        for f in files if f.lower().endswith(VIDEO_EXTS)
    )
    os.makedirs(final_dir, exist_ok=True)
    out = []
    for src in videos:
        ext = os.path.splitext(src)[1].lower()
        dst = ruta_libre(final_dir, stem, ext)
        shutil.move(src, dst)
        out.append(dst)
    shutil.rmtree(work_dir, ignore_errors=True)
    return out


def prune_empty_dirs(path: str, base: str):
    """Tras borrar un archivo, quita las carpetas que queden vacias hasta la raiz."""
    base = os.path.realpath(base)
    cur = os.path.dirname(os.path.realpath(path))
    while cur.startswith(base + os.sep) and os.path.isdir(cur):
        try:
            if os.listdir(cur):
                break
            os.rmdir(cur)
        except OSError:
            break
        cur = os.path.dirname(cur)
