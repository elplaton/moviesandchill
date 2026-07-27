import logging
import re
import time
from typing import Any

logger = logging.getLogger("tmd")

TMDB_BASE = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p"

_cache: dict[str, dict] = {}
_cache_ttl = 86400

QUALITY_TAGS = [
    "1080p", "720p", "2160p", "4k", "4K", "hdr", "hdrip", "bdrip", "bluray", "blu-ray", "web-dl", "web dl",
    "webrip", "brrip", "dvdrip", "hdtv", "x264", "x265", "hevc", "h265",
    "aac", "ddp", "dts", "truehd", "atmos", "h264", "av1",
    "multi", "dual", "castellano", "spanish", "spanishsub", "latino", "sub", "subs", "espanol",
    "zip", "rar", "7z", "dv", "dovi", "dolby vision", "hdr10", "hdr10+",
    "remux", "dubbed", "ac3", "eac3", "remastered",
    "english", "englishsub", "web", "sat", "dvd", "bdrip", "brrip",
    "spa", "ita", "dl",
]


def clean_title(filename: str) -> str:
    name = filename
    for ext in [".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts", ".7z", ".zip", ".rar"]:
        if name.lower().endswith(ext):
            name = name[:-len(ext)]
    name = re.sub(r"\.part\d+", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.r\d{2,}$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.\d{3,}$", "", name)

    name = re.sub(r"[sS]\d{2}[eE]\d{2}", "", name)
    name = re.sub(r"\d{1,2}x\d{2}", "", name)
    name = re.sub(r"\[[Ss]\s*\d{1,2}\s*[Ee]\s*\d{1,2}\]", "", name)
    name = re.sub(r"\s+[sS]\d{1,2}\s*$", "", name)

    name = re.sub(r"\[tmdbid-\d+\]", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\btmdbid[\s_-]*\d+\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"[\[\(].*?[\]\)]", "", name)
    name = re.sub(r"\b(19|20)\d{2}\b", "", name)

    name = name.replace(".", " ").replace("_", " ").replace("-", " ")
    name = re.sub(r"\s+", " ", name).strip()

    for tag in QUALITY_TAGS:
        name = re.sub(rf"\b{re.escape(tag)}\b", "", name, flags=re.IGNORECASE)

    name = re.sub(r"\s+", " ", name).strip()

    name = re.sub(r"\b[Tt]emporada\s*\d+\b", "", name)
    name = re.sub(r"\b[Ss]eason\s*\d+\b", "", name)
    name = re.sub(r"\bepisodio\s*\d+\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\bcapitulo\s*\d+\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"@\S+", "", name)
    name = re.sub(r"\s+por\s+\w+\s*$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+", " ", name).strip()

    return name if len(name) > 1 else filename


def _cached(key: str) -> dict | None:
    if key in _cache:
        entry = _cache[key]
        if time.time() - entry["_ts"] < _cache_ttl:
            return entry
        del _cache[key]
    return None


def _cache_set(key: str, data: dict):
    data["_ts"] = time.time()
    _cache[key] = data


async def search(api_key: str, query: str) -> dict | None:
    if not api_key:
        return None

    cached = _cached(query.lower())
    if cached:
        return cached

    import aiohttp

    url = f"{TMDB_BASE}/search/multi"
    params = {"api_key": api_key, "query": query, "language": "es-ES", "page": 1}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    logger.warning("TMDB search error %d for %s", resp.status, query)
                    return None
                data = await resp.json()
    except Exception as e:
        logger.warning("TMDB search failed for %s: %s", query, e)
        return None

    results = data.get("results", [])
    if not results:
        return None

    best = None
    for r in results:
        media_type = r.get("media_type", "")
        if media_type in ("movie", "tv"):
            title = r.get("title") or r.get("name", "")
            if not title:
                continue
            best = {
                "tmdb_id": r["id"],
                "title": title,
                "media_type": media_type,
                "year": _extract_year(r),
                "rating": r.get("vote_average"),
                "overview": r.get("overview", ""),
                "poster": f"{IMAGE_BASE}/w342{r['poster_path']}" if r.get("poster_path") else None,
                "backdrop": f"{IMAGE_BASE}/w780{r['backdrop_path']}" if r.get("backdrop_path") else None,
                "original_title": r.get("original_title") or r.get("original_name", ""),
            }
            break

    if best:
        _cache_set(query.lower(), best)

    return best


def _extract_year(item: dict) -> int | None:
    date_str = item.get("release_date") or item.get("first_air_date")
    if date_str and len(date_str) >= 4:
        try:
            return int(date_str[:4])
        except ValueError:
            pass
    return None


async def batch_search(api_key: str, names: list[str]) -> dict[str, dict]:
    import asyncio

    unique = list(dict.fromkeys([n for n in names if n and len(n) > 1]))
    tasks = [search(api_key, name) for name in unique]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    output = {}
    for name, result in zip(unique, results):
        if isinstance(result, dict) and result:
            output[name] = result
    return output


async def get_details(api_key: str, tmdb_id: int, media_type: str) -> dict | None:
    if not api_key:
        return None

    import aiohttp
    cached = _cached(f"detail_{tmdb_id}")
    if cached:
        return cached

    path = f"/{media_type}/{tmdb_id}" if media_type in ("movie", "tv") else f"/movie/{tmdb_id}"
    url = f"{TMDB_BASE}{path}"
    params = {"api_key": api_key, "language": "es-ES"}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
    except Exception:
        return None

    result = {
        "tmdb_id": tmdb_id,
        "media_type": media_type,
        "title": data.get("title") or data.get("name", ""),
        "original_title": data.get("original_title") or data.get("original_name", ""),
        "year": _extract_year(data),
        "rating": data.get("vote_average"),
        "poster": f"{IMAGE_BASE}/w342{data['poster_path']}" if data.get("poster_path") else None,
        "backdrop": f"{IMAGE_BASE}/w780{data['backdrop_path']}" if data.get("backdrop_path") else None,
        "overview": data.get("overview", ""),
        "genres": [g["name"] for g in data.get("genres", [])],
        "runtime": data.get("runtime"),
        "seasons_count": data.get("number_of_seasons") if media_type == "tv" else None,
    }
    _cache_set(f"detail_{tmdb_id}", result)
    return result
