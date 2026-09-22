import asyncio
import random
from collections import defaultdict
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["browse"])

GENRE_LIMIT = 12
ITEMS_PER_ROW = 20
POOL_SIZE = 400


def _item(row: dict) -> dict:
    is_series = row.get("tmdb_type") == "tv"
    return {
        "id": f"{'s' if is_series else 'm'}{row['tmdb_id']}",
        "tmdb_id": row["tmdb_id"],
        "title": row["tmdb_title"] or row["clean_title"],
        "poster": row["poster"],
        "backdrop": row["backdrop"],
        "year": row["year"],
        "rating": float(row["rating"]) if row["rating"] else None,
        "overview": row["overview"],
        "media_type": "series" if is_series else "movie",
        "episode_count": row.get("episode_count", 0) if is_series else None,
        "file_count": row.get("file_count", 0),
        "genres": row.get("genres") or [],
        "channel_id": row["channel_id"],
        "channel_name": row.get("channel_name"),
        "message_id": row["message_id"],
    }


def _dedupe(items: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for it in items:
        if it["id"] in seen:
            continue
        seen.add(it["id"])
        out.append(it)
    return out


@router.get("/browse/home")
async def browse_home(user: Annotated[str, Depends(get_current_user)]):
    from app.database.browse import get_browse_pool, get_recent_releases, get_recently_added
    from app.database.users import get_user_by_username
    from app.database.preferences import get_preferences

    this_year = date.today().year
    movies, series, releases, added = await asyncio.gather(
        get_browse_pool("movie", POOL_SIZE),
        get_browse_pool("tv", POOL_SIZE),
        get_recent_releases(ITEMS_PER_ROW, min_year=this_year - 1, max_year=this_year),
        get_recently_added(ITEMS_PER_ROW),
    )

    all_items = [_item(r) for r in movies] + [_item(r) for r in series]
    random.shuffle(all_items)

    rows = []
    if releases:
        rows.append({"genre": "Novedades", "items": _dedupe([_item(r) for r in releases])})
    if added:
        rows.append({"genre": "Añadido recientemente", "items": _dedupe([_item(r) for r in added])})

    genre_rows: dict[str, list[dict]] = defaultdict(list)
    for item in all_items:
        for g in item["genres"]:
            if len(genre_rows[g]) < ITEMS_PER_ROW:
                genre_rows[g].append(item)

    sorted_genres = sorted(genre_rows.items(), key=lambda kv: len(kv[1]), reverse=True)
    rows.extend({"genre": genre, "items": items} for genre, items in sorted_genres[:GENRE_LIMIT])

    db_user = await get_user_by_username(user)
    if db_user:
        prefs = await get_preferences(db_user["id"])
        if prefs and prefs.get("genres"):
            pref_genres = prefs["genres"]
            liked_years = prefs.get("liked_years") or []
            scored = []
            for item in all_items:
                score = sum(pref_genres.get(g, 0) for g in item.get("genres", []))
                if score == 0:
                    continue
                item_year = item.get("year")
                year_bonus = 0
                if item_year:
                    # Cercania a lo que marco en el onboarding, y un empujon a lo
                    # reciente. Antes se descartaba todo lo que no fuera de las
                    # mismas decadas, y la fila se llenaba de series de 2010.
                    for ly in liked_years:
                        diff = abs(item_year - ly)
                        if diff <= 3:
                            year_bonus = max(year_bonus, 3)
                        elif diff <= 8:
                            year_bonus = max(year_bonus, 1)
                    if item_year >= this_year - 2:
                        year_bonus += 2
                total = score + year_bonus
                if total >= 2:
                    scored.append((total, item))
            scored.sort(key=lambda x: -x[0])
            if scored:
                rows.insert(0, {"genre": "Recomendado para ti", "items": [i for _, i in scored[:ITEMS_PER_ROW]]})

    return {"rows": rows}
