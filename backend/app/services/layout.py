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
    return {
        "kind": "movie", "final_dir": final_dir, "final_stem": folder,
        "work_dir": os.path.join(final_dir, f"{WORK_PREFIX}{batch_id}"),
        "folder_name": folder,
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
    for i, src in enumerate(videos):
        ext = os.path.splitext(src)[1].lower()
        name = f"{stem}{ext}" if i == 0 else f"{stem} ({i + 1}){ext}"
        dst = os.path.join(final_dir, name)
        if os.path.exists(dst):
            os.remove(dst)
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
