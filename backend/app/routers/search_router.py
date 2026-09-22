import asyncio
import os
import re
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.services.title_parser import parse_filename

router = APIRouter(prefix="/api", tags=["search"])


class SearchRequest(BaseModel):
    query: str
    page_size: int = 8
    # offset_id es un ID de mensaje de Telegram (paginacion de Telethon).
    # offset son filas a saltar en PostgreSQL: son cosas distintas y usar el
    # primero como OFFSET de SQL saltaba miles de filas y devolvia vacio.
    offset_id: int = 0
    offset: int = 0
    sort_asc: bool = False
    channel_ids: list[int] | None = None


def _row_to_result(r: dict, existing: set) -> dict:
    return {
        "id": r["message_id"], "date": str(r.get("indexed_at", "")), "text": "",
        "file_name": r["file_name"], "size": r.get("file_size", 0),
        "size_str": r.get("size_str", ""),
        "channel_id": r["channel_id"], "channel_name": r.get("channel_name", ""),
        "downloaded": _strip_filename(r.get("file_name") or "").lower() in existing,
        "clean_name": r.get("clean_title"), "media_type": r.get("media_type"),
        "season": r.get("season"), "episode": r.get("episode"), "tags": r.get("tags") or [],
        "tmdb_id": r.get("tmdb_id"), "tmdb_type": r.get("tmdb_type"), "tmdb_valid": r.get("tmdb_valid"),
        "tmdb_title": r.get("tmdb_title"), "tmdb_year": r.get("tmdb_year"),
        "tmdb_rating": float(r["tmdb_rating"]) if r.get("tmdb_rating") is not None else None,
        "tmdb_poster": r.get("tmdb_poster"),
        "tmdb_backdrop": r.get("tmdb_backdrop"), "tmdb_overview": r.get("tmdb_overview"),
        "tmdb_genres": r.get("tmdb_genres") or [],
    }


async def _enrich_live(results: list[dict], api_key: str):
    """Metadatos al vuelo para resultados que vienen de Telegram y no estan
    indexados. Usa el mismo parser y busqueda por tipo que el indexador."""
    from app.services.tmdb import search as tmdb_search

    need = [r for r in results if not r.get("tmdb_poster")]
    if not need or not api_key:
        return
    parsed = {}
    for r in need:
        p = parse_filename(r["file_name"])
        r["clean_name"] = r.get("clean_name") or p.clean_title
        r["media_type"] = r.get("media_type") or p.media_type
        r["season"] = r.get("season") if r.get("season") is not None else p.season
        r["episode"] = r.get("episode") if r.get("episode") is not None else p.episode
        if p.title:
            parsed[id(r)] = p

    async def _one(p):
        return await tmdb_search(api_key, p.title, "tv" if p.media_type == "series" else "movie",
                                 p.year if p.media_type == "movie" else None)

    keys = list(parsed.keys())
    metas = await asyncio.gather(*[_one(parsed[k]) for k in keys], return_exceptions=True)
    by_id = {k: m for k, m in zip(keys, metas) if isinstance(m, dict) and m}
    for r in need:
        m = by_id.get(id(r))
        if not m:
            continue
        r["tmdb_id"] = m.get("tmdb_id")
        r["tmdb_type"] = m.get("media_type")
        r["tmdb_title"] = m.get("title")
        r["tmdb_year"] = m.get("year")
        r["tmdb_rating"] = m.get("rating")
        r["tmdb_poster"] = m.get("poster")
        r["tmdb_backdrop"] = m.get("backdrop")
        r["tmdb_overview"] = m.get("overview")
        r["tmdb_genres"] = []


@router.post("/search")
async def search(req: SearchRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.routers.download import config, downloader

    if not req.query.strip():
        return {"results": [], "count": 0, "has_more": False, "last_message_id": 0}

    existing = _find_downloaded_files(config.get("extract_path", "."))
    results = []

    from app.database.connection import search_media, get_pool
    if get_pool():
        rows = await search_media(req.query.strip(), max(req.page_size, 100) + 1, req.offset)
        results = [_row_to_result(r, existing) for r in rows]

    if len(results) < req.page_size:
        telegram_results = await downloader.search_messages(
            req.query.strip(), req.page_size, req.offset_id,
            reverse=req.sort_asc, channel_ids=req.channel_ids,
        )
        indexed_ids = {(r["channel_id"], r["id"]) for r in results}
        for tr in telegram_results:
            if (tr["channel_id"], tr["id"]) not in indexed_ids:
                tr["downloaded"] = _strip_filename(tr.get("file_name") or "").lower() in existing
                tr["clean_name"] = ""
                results.append(tr)

    has_more = len(results) > req.page_size
    if has_more:
        results = results[:req.page_size]

    await _enrich_live(results, config.get("tmdb_api_key", ""))

    return {
        "results": results,
        "count": len(results),
        "has_more": has_more,
        "last_message_id": results[-1]["id"] if results else 0,
        "next_offset": req.offset + len(results),
    }


@router.get("/media/{tmdb_id}/files")
async def media_files(tmdb_id: int, user: Annotated[str, Depends(get_current_user)],
                      media_type: str | None = None):
    """Todos los archivos indexados de un titulo TMDB (episodios o versiones
    de una pelicula). Es lo que abren los modales de detalle. media_type es
    "movie" o "tv" (tambien acepta "series"): los ids de TMDB se repiten entre
    peliculas y series."""
    from app.routers.download import config
    from app.database.connection import get_media_by_tmdb, get_tmdb_cached

    if media_type == "series":
        media_type = "tv"
    if media_type not in ("movie", "tv"):
        media_type = None
    existing = _find_downloaded_files(config.get("extract_path", "."))
    rows, tmdb = await asyncio.gather(get_media_by_tmdb(tmdb_id, media_type), get_tmdb_cached(tmdb_id, media_type))
    results = [_row_to_result(r, existing) for r in rows]
    meta = None
    if tmdb:
        meta = {
            "tmdb_id": tmdb["tmdb_id"], "media_type": tmdb["media_type"], "title": tmdb["title"],
            "year": tmdb["year"], "rating": float(tmdb["rating"]) if tmdb["rating"] is not None else None,
            "poster": tmdb["poster"], "backdrop": tmdb["backdrop"], "overview": tmdb["overview"],
            "genres": tmdb["genres"] or [], "seasons_count": tmdb.get("seasons_count"),
        }
    return {"tmdb": meta, "results": results, "count": len(results)}


def _find_downloaded_files(base_dir):
    found = set()
    if not os.path.isdir(base_dir):
        return found
    for root, dirs, files in os.walk(base_dir):
        for name in files:
            found.add(_strip_filename(name).lower())
        for name in dirs:
            found.add(name.lower())
    return found


def _strip_filename(name):
    name = re.sub(r"\.part\d+", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.\d{3,}$", "", name)
    for ext in [".rar", ".zip", ".7z", ".tar.gz", ".tar.bz2", ".tar", ".tgz", ".tbz2",
                ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts"]:
        if name.lower().endswith(ext):
            name = name[:-len(ext)]
            break
    return name
