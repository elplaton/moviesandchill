import time
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["tmdb"])

_season_cache: dict[str, tuple[float, list[dict]]] = {}
CACHE_TTL = 86400


class EpisodeInfo(BaseModel):
    episode_number: int
    name: str


@router.get("/tmdb/season")
async def get_season_episodes(
    tmdb_id: Annotated[int, Query()],
    season: Annotated[int, Query()],
    user: Annotated[str, Depends(get_current_user)],
):
    from app.routers.download import config

    api_key = config.get("tmdb_api_key", "")
    if not api_key:
        return {"episodes": []}

    cache_key = f"{tmdb_id}_{season}"
    cached = _season_cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return {"episodes": cached[1]}

    import aiohttp

    url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season}"
    params = {"api_key": api_key, "language": "es-ES"}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return {"episodes": []}
                data = await resp.json()
    except Exception:
        return {"episodes": []}

    episodes = []
    for ep in data.get("episodes", []):
        episodes.append({
            "episode_number": ep.get("episode_number"),
            "name": ep.get("name", ""),
        })

    _season_cache[cache_key] = (time.time(), episodes)
    return {"episodes": episodes}
