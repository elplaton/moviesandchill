import os
import re
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["search"])


class SearchRequest(BaseModel):
    query: str
    page_size: int = 8
    offset_id: int = 0
    sort_asc: bool = False
    channel_ids: list[int] | None = None


@router.post("/search")
async def search(req: SearchRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.routers.download import config, downloader

    if not req.query.strip():
        return {"results": [], "count": 0, "has_more": False, "last_message_id": 0}

    existing = _find_downloaded_files(config.get("extract_path", "."))
    results = []

    from app.database.connection import search_media, get_pool
    if get_pool():
        rows = await search_media(req.query.strip(), 100, req.offset_id)
        for r in rows:
            results.append({
                "id": r["message_id"], "date": str(r.get("indexed_at", "")), "text": "",
                "file_name": r["file_name"], "size": r.get("file_size", 0),
                "size_str": r.get("size_str", ""),
                "channel_id": r["channel_id"], "channel_name": r.get("channel_name", ""),
                "downloaded": _strip_filename(r.get("file_name") or "").lower() in existing,
                "clean_name": r.get("clean_title"), "media_type": r.get("media_type"),
                "season": r.get("season"), "episode": r.get("episode"), "tags": r.get("tags") or [],
                "tmdb_title": r.get("tmdb_title"), "tmdb_year": r.get("tmdb_year"),
                "tmdb_rating": r.get("tmdb_rating"), "tmdb_poster": r.get("tmdb_poster"),
                "tmdb_backdrop": r.get("tmdb_backdrop"), "tmdb_overview": r.get("tmdb_overview"),
                "tmdb_genres": r.get("tmdb_genres") or [],
            })

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

    need_metadata = [r for r in results if not r.get("tmdb_poster")]
    if need_metadata and config.get("tmdb_api_key"):
        from app.services.tmdb import batch_search as bs, clean_title as ct
        names = {ct(r["file_name"]) for r in need_metadata}
        meta = await bs(config["tmdb_api_key"], list(names))
        for r in need_metadata:
            key = ct(r["file_name"])
            if key in meta:
                r["tmdb_title"] = meta[key].get("title")
                r["tmdb_year"] = meta[key].get("year")
                r["tmdb_rating"] = meta[key].get("rating")
                r["tmdb_poster"] = meta[key].get("poster")
                r["tmdb_backdrop"] = meta[key].get("backdrop")
                r["tmdb_overview"] = meta[key].get("overview")
                r["tmdb_genres"] = []
                r["clean_name"] = key

    return {
        "results": results,
        "count": len(results),
        "has_more": has_more,
        "last_message_id": results[-1]["id"] if results else 0,
    }


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
