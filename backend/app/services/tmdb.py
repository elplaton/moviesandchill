import logging
import re
import time
import unicodedata

logger = logging.getLogger("tmd")

TMDB_BASE = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p"

_cache: dict[str, dict] = {}
_cache_ttl = 86400
_MISS = {"_miss": True}


def clean_title(filename: str) -> str:
    """Titulo limpio para busquedas de texto. Mantenido por compatibilidad:
    la logica vive en title_parser."""
    from app.services.title_parser import parse_filename
    parsed = parse_filename(filename)
    return parsed.title or parsed.clean_title


def _cached(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    if time.time() - entry["_ts"] < _cache_ttl:
        return entry
    del _cache[key]
    return None


def _cache_set(key: str, data: dict):
    data = dict(data)
    data["_ts"] = time.time()
    _cache[key] = data


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _to_result(r: dict, media_type: str) -> dict | None:
    title = r.get("title") or r.get("name", "")
    if not title:
        return None
    return {
        "tmdb_id": r["id"],
        "title": title,
        "media_type": media_type,
        "year": _extract_year(r),
        "rating": r.get("vote_average"),
        "overview": r.get("overview", ""),
        "poster": f"{IMAGE_BASE}/w342{r['poster_path']}" if r.get("poster_path") else None,
        "backdrop": f"{IMAGE_BASE}/w780{r['backdrop_path']}" if r.get("backdrop_path") else None,
        "original_title": r.get("original_title") or r.get("original_name", ""),
        "popularity": r.get("popularity") or 0,
        "vote_count": r.get("vote_count") or 0,
    }


def _tokens(text: str) -> set[str]:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if t}


def title_similarity(query: str, *titles: str) -> float:
    """Fraccion de palabras de la consulta que aparecen en alguno de los
    titulos (o 1.0 si uno contiene al otro)."""
    q = _norm(query)
    qt = _tokens(query)
    best = 0.0
    for t in titles:
        if not t:
            continue
        n = _norm(t)
        if n and (n == q or (len(q) >= 4 and (q in n or n in q))):
            return 1.0
        tt = _tokens(t)
        if qt:
            best = max(best, len(qt & tt) / len(qt))
    return best


def _acceptable(candidate: dict, query: str) -> bool:
    # "El gran general a medianoche" no es "El gran tour": un resultado que no
    # comparte al menos el 60% de las palabras con lo buscado se descarta, salvo
    # consultas muy cortas (ambiguas de por si) o titulos muy conocidos que
    # TMDB encuentra por un alias en otro idioma.
    sim = title_similarity(query, candidate["title"], candidate["original_title"])
    if sim >= 0.6:
        return True
    if len(_tokens(query)) <= 2:
        return True
    return (candidate.get("vote_count") or 0) >= 500


def _pick_best(results: list[dict], query: str, forced_type: str | None) -> dict | None:
    """Prefiere el resultado cuyo titulo coincide exactamente con lo buscado;
    si no, el primero aceptable (TMDB los ordena por popularidad)."""
    q = _norm(query)
    candidates = []
    for r in results:
        media_type = forced_type or r.get("media_type", "")
        if media_type not in ("movie", "tv"):
            continue
        item = _to_result(r, media_type)
        if item:
            candidates.append(item)
    if not candidates:
        return None
    for c in candidates:
        if _norm(c["title"]) == q or _norm(c["original_title"]) == q:
            return c
    for c in candidates:
        if _acceptable(c, query):
            return c
    return None


async def _get(path: str, params: dict) -> dict | None:
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{TMDB_BASE}{path}", params=params,
                                   timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    logger.warning("TMDB %s -> %d (%s)", path, resp.status, params.get("query", ""))
                    return None
                return await resp.json()
    except Exception as e:
        logger.warning("TMDB %s fallo: %s", path, e)
        return None


async def search(api_key: str, query: str, media_type: str | None = None, year: int | None = None) -> dict | None:
    """Busca en TMDB. Con media_type ("movie"/"tv") usa el endpoint de ese tipo,
    y con year lo filtra: "Los angeles de Charlie (2000)" ya no devuelve la
    serie de 1976. Si no hay nada, cae a /search/multi sin año."""
    if not api_key or not query or len(query.strip()) < 2:
        return None
    query = query.strip()

    key = f"{media_type or 'multi'}|{year or ''}|{query.lower()}"
    cached = _cached(key)
    if cached is not None:
        return None if cached.get("_miss") else cached

    attempts: list[tuple[str, dict, str | None]] = []
    if media_type in ("movie", "tv"):
        date_param = "year" if media_type == "movie" else "first_air_date_year"
        if year:
            attempts.append((f"/search/{media_type}", {date_param: year}, media_type))
        attempts.append((f"/search/{media_type}", {}, media_type))
    attempts.append(("/search/multi", {}, None))

    best = None
    for path, extra, forced in attempts:
        params = {"api_key": api_key, "query": query, "language": "es-ES", "page": 1, **extra}
        data = await _get(path, params)
        results = (data or {}).get("results") or []
        best = _pick_best(results, query, forced)
        if best:
            break

    _cache_set(key, best or _MISS)
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

    key = f"detail_{media_type}_{tmdb_id}"
    cached = _cached(key)
    if cached is not None:
        return None if cached.get("_miss") else cached

    path = f"/{media_type}/{tmdb_id}" if media_type in ("movie", "tv") else f"/movie/{tmdb_id}"
    data = await _get(path, {"api_key": api_key, "language": "es-ES"})
    if not data:
        _cache_set(key, _MISS)
        return None

    result = {
        "tmdb_id": tmdb_id,
        "media_type": media_type,
        "title": data.get("title") or data.get("name", ""),
        "original_title": data.get("original_title") or data.get("original_name", ""),
        "year": _extract_year(data),
        "rating": data.get("vote_average"),
        "vote_count": data.get("vote_count"),
        "poster": f"{IMAGE_BASE}/w342{data['poster_path']}" if data.get("poster_path") else None,
        "backdrop": f"{IMAGE_BASE}/w780{data['backdrop_path']}" if data.get("backdrop_path") else None,
        "overview": data.get("overview", ""),
        "genres": [g["name"] for g in data.get("genres", [])],
        "runtime": data.get("runtime"),
        "seasons_count": data.get("number_of_seasons") if media_type == "tv" else None,
    }
    _cache_set(key, result)
    return result
