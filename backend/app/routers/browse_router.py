import asyncio
import random
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["browse"])

GENRE_LIMIT = 12
ITEMS_PER_ROW = 20


@router.get("/browse/home")
async def browse_home(user: Annotated[str, Depends(get_current_user)]):
    from app.database.browse import get_browse_movies, get_browse_series
    from app.database.users import get_user_by_username
    from app.database.preferences import get_preferences

    movies, series = await asyncio.gather(
        get_browse_movies(limit=500),
        get_browse_series(limit=500),
    )

    all_items = []

    for m in movies:
        genres = m.get("genres") or []
        all_items.append({
            "id": f"m{m['id']}",
            "title": m["tmdb_title"] or m["clean_title"],
            "poster": m["poster"],
            "backdrop": m["backdrop"],
            "year": m["year"],
            "rating": float(m["rating"]) if m["rating"] else None,
            "overview": m["overview"],
            "media_type": "movie",
            "genres": genres,
            "channel_id": m["channel_id"],
            "channel_name": m["channel_name"],
            "message_id": m["message_id"],
        })

    for s in series:
        genres = s.get("genres") or []
        all_items.append({
            "id": f"s{s['tmdb_id']}",
            "title": s["tmdb_title"] or s["clean_title"],
            "poster": s["poster"],
            "backdrop": s["backdrop"],
            "year": s["year"],
            "rating": float(s["rating"]) if s["rating"] else None,
            "overview": s["overview"],
            "media_type": "series",
            "episode_count": s.get("episode_count", 0),
            "genres": genres,
            "channel_id": s["channel_id"],
        })

    random.shuffle(all_items)

    genre_rows: dict[str, list[dict]] = defaultdict(list)
    for item in all_items:
        for g in item["genres"]:
            if len(genre_rows[g]) < ITEMS_PER_ROW:
                genre_rows[g].append(item)

    sorted_genres = sorted(genre_rows.items(), key=lambda kv: len(kv[1]), reverse=True)
    rows = [{"genre": genre, "items": items} for genre, items in sorted_genres[:GENRE_LIMIT]]

    db_user = await get_user_by_username(user)
    if db_user:
        prefs = await get_preferences(db_user["id"])
        if prefs and prefs.get("genres"):
            pref_genres = prefs["genres"]
            liked_years = prefs.get("liked_years") or []
            allowed_decades = set()
            for y in liked_years:
                allowed_decades.add((y // 10) * 10)
            scored = []
            for item in all_items:
                score = sum(pref_genres.get(g, 0) for g in item.get("genres", []))
                if score == 0:
                    continue
                item_year = item.get("year")
                if liked_years and item_year:
                    item_decade = (item_year // 10) * 10
                    if item_decade not in allowed_decades:
                        continue
                year_bonus = 0
                if liked_years and item_year:
                    for ly in liked_years:
                        diff = abs(item_year - ly)
                        if diff <= 3:
                            year_bonus = 3
                            break
                        elif diff <= 8:
                            year_bonus = 1
                            break
                total = score + year_bonus
                if total >= 2:
                    scored.append((total, item))
            scored.sort(key=lambda x: -x[0])
            if scored:
                rows.insert(0, {"genre": "Recomendado para ti", "items": [i for _, i in scored[:ITEMS_PER_ROW]]})

    return {"rows": rows}
