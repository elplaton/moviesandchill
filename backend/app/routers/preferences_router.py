from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["preferences"])


class SavePreferencesRequest(BaseModel):
    movies: list[int]
    series: list[int]


@router.get("/preferences")
async def get_prefs(user: Annotated[str, Depends(get_current_user)]):
    from app.database.users import get_user_by_username
    from app.database.preferences import get_preferences as db_get_prefs

    db_user = await get_user_by_username(user)
    if not db_user:
        return {"preferences": None}

    prefs = await db_get_prefs(db_user["id"])
    return {"preferences": prefs}


@router.post("/preferences")
async def save_prefs(req: SavePreferencesRequest, user: Annotated[str, Depends(get_current_user)]):
    from app.database.users import get_user_by_username
    from app.database.preferences import save_preferences as db_save_prefs
    from app.routers.download import config
    from app.database.connection import get_tmdb_cached

    db_user = await get_user_by_username(user)
    if not db_user:
        return {"error": "Usuario no encontrado"}

    api_key = config.get("tmdb_api_key", "")
    genre_counter: Counter = Counter()
    liked_years: list[int] = []

    import aiohttp
    from app.services.tmdb import TMDB_BASE

    async def fetch_info(tmdb_id: int, media_type: str):
        if not api_key:
            return
        url = f"{TMDB_BASE}/{media_type}/{tmdb_id}"
        params = {"api_key": api_key, "language": "es-ES"}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for g in data.get("genres", []):
                            genre_counter[g["name"]] += 1
                        year = data.get("release_date") or data.get("first_air_date", "")
                        if year and len(year) >= 4:
                            liked_years.append(int(year[:4]))
        except Exception:
            pass

    all_ids = req.movies + req.series
    movie_ids = set(req.movies)
    for tmdb_id in all_ids:
        mtype = "movie" if tmdb_id in movie_ids else "tv"
        await fetch_info(tmdb_id, mtype)

    await db_save_prefs(db_user["id"], req.movies, req.series, dict(genre_counter), liked_years)
    return {"status": "saved", "genres": dict(genre_counter), "years": liked_years}


@router.get("/onboarding/picks")
async def onboarding_picks(
    user: Annotated[str, Depends(get_current_user)],
    offset: int = 0,
    limit: int = 30,
):
    from app.database.preferences import get_top_rated

    data = await get_top_rated(limit=limit, offset=offset)

    movies = []
    for m in data["movies"]:
        movies.append({
            "id": f"m{m['tmdb_id']}",
            "tmdb_id": m["tmdb_id"],
            "title": m["tmdb_title"],
            "poster": m["poster"],
            "year": m["year"],
            "rating": float(m["rating"]) if m["rating"] else None,
            "genres": m.get("genres") or [],
            "media_type": "movie",
        })

    series = []
    for s in data["series"]:
        series.append({
            "id": f"s{s['tmdb_id']}",
            "tmdb_id": s["tmdb_id"],
            "title": s["tmdb_title"],
            "poster": s["poster"],
            "year": s["year"],
            "rating": float(s["rating"]) if s["rating"] else None,
            "genres": s.get("genres") or [],
            "media_type": "series",
        })

    return {"movies": movies, "series": series}
