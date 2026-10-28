import asyncio
import logging
import re
import time

from app.services.title_parser import parse_filename, ParsedName
from app.services.tmdb import title_similarity
from app.database.connection import (
    get_pool, get_active_channels,
    insert_media_items, update_media_tmdb_many,
    upsert_tmdb_cache, upsert_index_progress, get_index_progress,
)

logger = logging.getLogger("tmd")

# TMDB admite ~50 peticiones/s; con 5 en paralelo cada lote de 300 tardaba 20-30 s.
TMDB_CONCURRENCY = 10

# Escaneos de canal en curso y si ya hay un bucle de enriquecimiento corriendo.
# El escaneo ya no espera a TMDB en cada lote: inserta y sigue leyendo Telegram,
# y un unico bucle en paralelo va enriqueciendo lo pendiente mientras haya
# escaneos activos. Con 250.000 mensajes, esperar a TMDB por lote suponia horas.
_active_scans = 0
_enrich_running = False


def _es_sticker(msg) -> bool:
    from telethon.tl.types import DocumentAttributeSticker

    doc = getattr(msg, "document", None)
    return bool(doc) and any(isinstance(a, DocumentAttributeSticker) for a in (doc.attributes or []))


# Lo que dice el nombre de cada tema de cada canal (`contexto.tipo_de_tema`):
# {channel_id: (cuando, {tema_id: "series" | "movie" | None})}. Se pregunta a
# Telegram como mucho una vez por hora y canal.
_tipos_temas: dict[int, tuple[float, dict]] = {}
TIPOS_TEMAS_S = 3600


async def tipos_de_temas(channel_id: int) -> dict:
    """Si cada tema de un canal con foro es de series o de peliculas, por su
    nombre. {} si no es un foro o no se ha podido preguntar: entonces el tema
    no dice nada y manda el nombre del archivo, como siempre."""
    from app.services.contexto import tipo_de_tema

    cache = _tipos_temas.get(channel_id)
    if cache and time.time() - cache[0] < TIPOS_TEMAS_S:
        return cache[1]
    tipos: dict = {}
    try:
        from app.routers.telegram_router import _peer_de
        from app.services.peticiones import temas

        tipos = {t["id"]: tipo_de_tema(t["titulo"]) for t in await temas(_peer_de(channel_id))}
    except Exception:
        # No es un foro, o Telegram no contesta: se vuelve a probar en una hora.
        tipos = (cache or (0, {}))[1]
    _tipos_temas[channel_id] = (time.time(), tipos)
    return tipos


def tipo_de(channel_id: int, tema: int | None) -> str | None:
    """Lo que se sabe del tema sin preguntar (lo de `tipos_de_temas`)."""
    return (_tipos_temas.get(channel_id) or (0, {}))[1].get(tema)


def interpretar_item(item: dict):
    """Que es un archivo ya indexado, con su pie, su ficha y su tema."""
    from app.services.contexto import interpretar

    return interpretar(item["file_name"], item.get("pie"), item.get("ficha"),
                       tipo_de(item.get("channel_id"), item.get("tema_id")))


def seguidor_para(downloader, channel_id: int | None = None):
    """Un `Seguidor` (services/contexto.py) que reconoce fotos, pegatinas y
    archivos con las mismas reglas que el indexador. Con el canal, sabe
    tambien que temas son de series (hay que haber llamado antes a
    `tipos_de_temas`)."""
    from telethon.tl.types import MessageMediaPhoto

    from app.services.contexto import Seguidor

    def es_archivo(m) -> bool:
        if not getattr(m, "media", None):
            return False
        nombre = downloader._get_file_name(m)
        return bool(nombre) and downloader._is_downloadable(nombre) and downloader._get_file_size(m) > 0

    return Seguidor(es_foto=lambda m: isinstance(getattr(m, "media", None), MessageMediaPhoto),
                    es_sticker=_es_sticker, es_archivo=es_archivo,
                    nombre_de=downloader._get_file_name,
                    tipo_tema=(lambda tema: tipo_de(channel_id, tema)) if channel_id is not None else None)


def ver(seguidor, msg):
    """El contexto de un mensaje, sin que un fallo al leerlo pare nada: si
    algo sale mal el archivo se indexa como antes, solo con su nombre."""
    try:
        return seguidor.ver(msg)
    except Exception as e:
        logger.warning("Contexto del mensaje %s no leido: %s", getattr(msg, "id", "?"), e)
        return None


def _contexto_a_item(ctx) -> dict:
    """Lo que se guarda del contexto de un archivo en `media_items`."""
    from dataclasses import asdict

    if not ctx:
        return {}
    return {"pie": (ctx.pie or "")[:2000] or None, "ficha": ctx.ficha, "tema_id": ctx.tema,
            "pistas": asdict(ctx.pistas) if ctx.pistas else None}


# El seguidor de cada canal para lo que llega en vivo: recuerda la ultima
# ficha de cada tema entre un mensaje y el siguiente.
_seguidores_vivo: dict[int, object] = {}


def ensure_enrich_worker(api_key: str, broadcast=None):
    """Arranca el bucle de enriquecimiento si no hay uno ya en marcha."""
    if not api_key or _enrich_running:
        return None
    from app.tasks import spawn
    return spawn(enrich_all_missing_tmdb(api_key, broadcast=broadcast), "enrich_tmdb")


TAG_PATTERNS = {
    "1080p": r'\b1080p\b', "720p": r'\b720p\b', "2160p": r'\b2160p\b',
    "4K": r'\b4[Kk]\b',
    "x264": r'\bx264\b', "x265": r'\bx265\b', "HEVC": r'\bhevc\b',
    "HDR": r'\bhdr\b', "DV": r'\bdv\b', "DoVi": r'\bdovi\b',
    "DTS": r'\bdts\b', "AC3": r'\bac3\b', "EAC3": r'\beac3\b',
    "AAC": r'\baac\b', "TrueHD": r'\btruehd\b',
    "BluRay": r'\bbluray\b', "BDRip": r'\bbdrip\b', "WebDL": r'\bweb.dl\b',
    "REMUX": r'\bremux\b',
    "español": r'\bespañola?\b', "latino": r'\blatino\b', "english": r'\benglish\b',
}


def extract_tags(filename: str) -> list[str]:
    tags = []
    seen = set()
    for tag, pattern in TAG_PATTERNS.items():
        if re.search(pattern, filename, re.IGNORECASE) and tag.lower() not in seen:
            seen.add(tag.lower())
            tags.append(tag)
    return tags


def detect_media_type(filename: str):
    p = parse_filename(filename)
    return p.media_type, p.season, p.episode


def tmdb_type_matches(detected: str, tmdb_type: str) -> bool:
    expected = "tv" if detected == "series" else "movie"
    return tmdb_type == expected


def validate_media_type(filename: str, tmdb_type: str) -> bool:
    return tmdb_type_matches(parse_filename(filename).media_type, tmdb_type)


def _pistas(item: dict) -> dict | None:
    """Las pistas guardadas de un archivo (asyncpg devuelve el JSONB como texto)."""
    import json

    p = item.get("pistas")
    if isinstance(p, str):
        try:
            p = json.loads(p)
        except ValueError:
            return None
    return p if isinstance(p, dict) and p.get("titulo") else None


async def lookup_con_pistas(api_key: str, parsed: ParsedName, pistas: dict) -> dict | None:
    """Busca en TMDB con lo que dicen el pie y la ficha del archivo, que es mas
    fiable que su nombre: primero el enlace a TMDB o IMDb si lo hay, luego el
    titulo y el año de la ficha, luego el titulo original. Si nada de eso
    encuentra nada, lo de siempre (el nombre del archivo)."""
    from app.services.tmdb import _get, get_details as tmdb_details, search as tmdb_search

    if pistas.get("tmdb_id") and pistas.get("tmdb_tipo") in ("movie", "tv"):
        d = await tmdb_details(api_key, int(pistas["tmdb_id"]), pistas["tmdb_tipo"])
        if d:
            return {"tmdb_id": d["tmdb_id"], "media_type": pistas["tmdb_tipo"], "title": d["title"],
                    "por_enlace": True}
    if pistas.get("imdb_id"):
        data = await _get(f"/find/{pistas['imdb_id']}", {"api_key": api_key, "external_source": "imdb_id"})
        for clave, tipo in (("movie_results", "movie"), ("tv_results", "tv")):
            r = ((data or {}).get(clave) or [None])[0]
            if r and r.get("id"):
                return {"tmdb_id": r["id"], "media_type": tipo, "title": r.get("title") or r.get("name") or "",
                        "por_enlace": True}

    tmdb_type = "tv" if parsed.media_type == "series" else "movie"
    año = pistas.get("año") or parsed.year
    titulos = [pistas.get("titulo"), pistas.get("original"), *(pistas.get("otros") or [])]
    if parsed.media_type == "series":
        # El pie de un capitulo dice "La reina del flow 2x23": a TMDB va la serie.
        titulos = [parsed.title] + [parse_filename(t).title or t for t in titulos if t]
    for titulo in dict.fromkeys(v for t in titulos if t for v in variantes(t)):
        result = await tmdb_search(api_key, titulo, tmdb_type, año if tmdb_type == "movie" else None)
        if result and pistas.get("plataformas"):
            result = await _el_de_su_plataforma(api_key, titulo, tmdb_type, año, pistas["plataformas"], result)
        if result:
            if tmdb_type_matches(parsed.media_type, result["media_type"]):
                return result
            # La ficha lleva a algo del otro tipo (una serie para un archivo de
            # pelicula): si el nombre del archivo, como antes, da algo que si
            # cuadra, manda el nombre. Asi la ficha nunca empeora lo que ya
            # se encontraba.
            por_nombre = await lookup_tmdb(api_key, parsed)
            if por_nombre and tmdb_type_matches(parsed.media_type, por_nombre["media_type"]):
                return por_nombre
            return result
    return await lookup_tmdb(api_key, parsed)


async def _el_de_su_plataforma(api_key: str, titulo: str, tmdb_type: str, año, plataformas: list, result: dict):
    """Entre varios que se llaman igual, el que esta en la plataforma que dice
    la ficha. Si solo hay uno, o ninguno esta en ella, el que ya se tenia."""
    from app.services.tmdb import en_plataforma, exactos

    candidatos = await exactos(api_key, titulo, tmdb_type, año if tmdb_type == "movie" else None)
    if len(candidatos) < 2:
        return result
    for c in candidatos[:4]:
        if await en_plataforma(api_key, c["tmdb_id"], tmdb_type, plataformas):
            return c
    return result


_ROMANOS = {"ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10"}


def variantes(titulo: str) -> list[str]:
    """El titulo y, si lleva numeros romanos, el mismo con cifras: los canales
    escriben "Solo en Casa IV" y "Destino Final IV", y en TMDB son "Solo en
    casa 4" y "Destino final 4". Y sin el numero de orden de una saga delante
    ("07 - James Bond - Diamantes para la eternidad"): lo de detras del ultimo
    guion."""
    out = [titulo]
    arabigo = re.sub(r"\b(ii|iii|iv|vi|vii|viii|ix)\b", lambda m: _ROMANOS[m.group(1).lower()], titulo,
                     flags=re.IGNORECASE)
    if arabigo != titulo:
        out.append(arabigo)
    sin_orden = re.sub(r"^\d{1,3}\s*[-.]\s+", "", titulo)
    if sin_orden != titulo and re.search(r"[^\W\d_]", sin_orden):
        out.append(sin_orden)
        if " - " in sin_orden:
            out.append(sin_orden.rsplit(" - ", 1)[1])
    return out


async def lookup_tmdb(api_key: str, parsed: ParsedName) -> dict | None:
    """Resuelve un nombre ya interpretado contra TMDB.

    Busca por tipo (serie -> /search/tv, pelicula -> /search/movie con año).
    Para series con varias palabras prueba sin la primera (grupos de fansub
    como "A&KProjects Duelo Xiaolin") y con prefijos mas cortos.
    """
    from app.services.tmdb import search as tmdb_search, get_details as tmdb_details

    tmdb_type = "tv" if parsed.media_type == "series" else "movie"

    if parsed.tmdb_id_hint:
        for t in (tmdb_type, "movie" if tmdb_type == "tv" else "tv"):
            details = await tmdb_details(api_key, parsed.tmdb_id_hint, t)
            if details:
                return {"tmdb_id": details["tmdb_id"], "media_type": t, "title": details["title"]}

    title = parsed.title
    if not title or len(title) < 2:
        return None

    year = parsed.year if parsed.media_type == "movie" else None
    for variante in variantes(title):
        result = await tmdb_search(api_key, variante, tmdb_type, year)
        if result:
            return result

    words = title.split()
    candidates = []
    if parsed.media_type == "series":
        if len(words) >= 3:
            candidates.append(" ".join(words[1:]))
        for wc in (3, 2):
            if wc < len(words):
                candidates.append(" ".join(words[:wc]))
    for cand in dict.fromkeys(candidates):
        result = await tmdb_search(api_key, cand, tmdb_type, None)
        if result:
            return result
    return None


async def _enrich_batch(api_key: str, items: list[dict]):
    """Enriquece un lote agrupando por titulo: todos los episodios de una
    serie (o las partes de una pelicula) hacen UNA consulta a TMDB."""
    if not api_key or not items:
        return 0
    from app.services.tmdb import get_details as tmdb_details
    from app.database.connection import mark_batch_tmdb_searched

    groups: dict[tuple, dict] = {}
    for item in items:
        parsed = interpretar_item(item)
        pistas = _pistas(item)
        if parsed.tmdb_id_hint:
            key = ("hint", parsed.tmdb_id_hint)
        elif pistas:
            # Lo que trae ficha se agrupa por lo que dice la ficha: las dos
            # calidades de "La silla" hacen una sola consulta.
            # En una serie el pie dice el capitulo ("La reina del flow 2x23")
            # y cambia en cada uno: manda el nombre de la serie.
            titulo = parsed.title if parsed.media_type == "series" and parsed.title else pistas["titulo"]
            key = ("pista", parsed.media_type, pistas.get("tmdb_id") or pistas.get("imdb_id")
                   or titulo.lower(), pistas.get("año") or parsed.year)
        elif parsed.title and len(parsed.title) >= 2:
            key = (parsed.media_type, parsed.title.lower(), parsed.year if parsed.media_type == "movie" else None)
        else:
            continue
        grp = groups.setdefault(key, {"parsed": parsed, "pistas": pistas, "items": []})
        grp["items"].append(item)

    sem = asyncio.Semaphore(TMDB_CONCURRENCY)
    enriched = 0
    lock = asyncio.Lock()

    async def _enrich_group(grp):
        nonlocal enriched
        parsed: ParsedName = grp["parsed"]
        pistas = grp.get("pistas")
        async with sem:
            t0 = time.time()
            try:
                result = (await lookup_con_pistas(api_key, parsed, pistas) if pistas
                          else await lookup_tmdb(api_key, parsed))
                if not result:
                    return
                details = await tmdb_details(api_key, result["tmdb_id"], result["media_type"])
                if details:
                    await upsert_tmdb_cache(details)
                # Un enlace a TMDB o IMDb en la ficha dice el tipo mejor que el
                # nombre del archivo ("Peli.mkv" de una miniserie).
                valid = result.get("por_enlace") or tmdb_type_matches(parsed.media_type, result["media_type"])
                # Lo que se vuelve a comprobar ya tenia una ficha buena: un
                # resultado del tipo equivocado no la sustituye (la sacaria de
                # la portada), y lo que no encuentra nada ni llega aqui.
                filas = [it for it in grp["items"] if valid or it.get("tmdb_valid") is not True]
                cambian = [it for it in filas if it.get("tmdb_id") and
                           (it["tmdb_id"], it.get("tmdb_type")) != (result["tmdb_id"], result["media_type"])]
                await update_media_tmdb_many([
                    (result["tmdb_id"], result["media_type"], valid, it["channel_id"], it["message_id"])
                    for it in filas
                ])
                async with lock:
                    enriched += len(filas)
                logger.info("  TMDB %s: %s (%d archivos) -> %s [%s]%s%s (%.2fs)",
                            parsed.media_type, parsed.title[:40], len(filas),
                            result.get("title", "?")[:40], result["media_type"],
                            "" if valid else " TIPO DISTINTO",
                            f" CAMBIA {len(cambian)} (antes {cambian[0].get('tmdb_type')}/{cambian[0]['tmdb_id']})"
                            if cambian else "", time.time() - t0)
            except Exception as e:
                logger.warning("  TMDB error %s: %s", parsed.title[:40], str(e)[:80])

    await asyncio.gather(*[_enrich_group(g) for g in groups.values()], return_exceptions=True)
    await mark_batch_tmdb_searched(items)
    return enriched


def _item_from_message(downloader, channel_id, channel_name, msg, file_name, size, ctx=None):
    from app.services.contexto import interpretar

    parsed = (interpretar(file_name, ctx.pie, ctx.ficha, tipo_de(channel_id, ctx.tema)) if ctx
              else parse_filename(file_name))
    return {
        "channel_id": channel_id, "channel_name": channel_name,
        "message_id": msg.id, "file_name": file_name,
        "file_size": size, "size_str": downloader._format_size(size),
        "clean_title": parsed.clean_title[:300], "media_type": parsed.media_type,
        "season": parsed.season, "episode": parsed.episode,
        **_contexto_a_item(ctx),
    }


async def scan_channel(downloader, channel_id: int, channel_name: str, api_key: str = "",
                       broadcast=None, total_estimate: int = 0, stop_flag: asyncio.Event = None):
    global _active_scans
    pool = get_pool()
    if not pool:
        return
    _active_scans += 1
    try:
        ensure_enrich_worker(api_key, broadcast)
        return await _scan_channel(downloader, channel_id, channel_name, broadcast, total_estimate, stop_flag)
    finally:
        _active_scans -= 1


async def _scan_channel(downloader, channel_id, channel_name, broadcast, total_estimate, stop_flag):

    entity = downloader.channels.get(channel_id, {}).get("entity")
    if not entity:
        logger.warning("No se pudo resolver canal %d", channel_id)
        return

    progress = await get_index_progress()
    prog = next((p for p in progress if p["channel_id"] == channel_id), {})
    offset = prog.get("last_message_id", 0) or 0
    total_indexed = prog.get("total_indexed", 0) or 0
    total_scanned = prog.get("total_scanned", 0) or 0
    batch_items = []
    batch_size = 500

    if not total_estimate:
        total_estimate = prog.get("total_estimate", 0) or 0

    await upsert_index_progress(channel_id, offset, total_indexed, "scanning", phase="scanning",
                                total_estimate=total_estimate)

    if broadcast:
        await broadcast({
            "type": "index_channel_start",
            "channel_id": channel_id,
            "channel_name": channel_name,
            "indexed": total_indexed,
            "total_estimate": total_estimate,
        })

    logger.info("Escaneando canal %s desde offset=%d (ya indexados: %d, total: %d)",
                channel_name, offset, total_indexed, total_estimate)

    from app.database.media import temas_ignorados

    # Ve todos los mensajes en orden (fichas y pegatinas incluidas) para
    # pegarle a cada archivo su pie, su ficha y su tema.
    await tipos_de_temas(channel_id)
    seguidor = seguidor_para(downloader, channel_id)
    ignorados = (await temas_ignorados()).get(channel_id, set())

    had_error = False
    while True:
        if stop_flag and stop_flag.is_set():
            logger.info("Indexacion detenida en canal %s (offset=%d)", channel_name, offset)
            await upsert_index_progress(channel_id, offset, total_indexed, "stopped", phase="stopped",
                                        total_scanned=total_scanned, total_estimate=total_estimate)
            return

        kwargs = {"limit": batch_size, "reverse": True}
        if offset > 0:
            kwargs["offset_id"] = offset
        last_id = offset
        msg_count = 0

        try:
            async for msg in downloader.client.iter_messages(entity, **kwargs):
                msg_count += 1
                last_id = msg.id
                ctx = ver(seguidor, msg)
                if not msg.media:
                    continue
                file_name = downloader._get_file_name(msg)
                if not file_name or not downloader._is_downloadable(file_name):
                    continue
                size = downloader._get_file_size(msg)
                if size == 0:
                    continue
                if ctx and ctx.tema in ignorados:
                    continue
                batch_items.append(_item_from_message(downloader, channel_id, channel_name, msg,
                                                      file_name, size, ctx))
        except Exception as e:
            logger.error("Error escaneando canal %d: %s", channel_id, e)
            had_error = True
            break

        offset = last_id
        total_scanned += msg_count

        if batch_items:
            await insert_media_items(batch_items)
            total_indexed += len(batch_items)

        await upsert_index_progress(channel_id, offset, total_indexed, "scanning", phase="scanning",
                                    total_scanned=total_scanned, total_estimate=total_estimate)

        pct = round((total_scanned / max(total_estimate, 1)) * 100, 1)
        logger.info("  %s: %d media / %d scanned / %d total (%s%%) offset=%d",
                    channel_name, total_indexed, total_scanned, total_estimate, pct, offset)

        if broadcast:
            await broadcast({
                "type": "index_progress",
                "channel_id": channel_id,
                "channel_name": channel_name,
                "indexed": total_indexed,
                "scanned": total_scanned,
                "total_estimate": total_estimate,
                "progress": pct,
                "phase": "scanning",
            })

        batch_items = []
        if msg_count < batch_size:
            break

    if had_error:
        await upsert_index_progress(channel_id, offset, total_indexed, "error", phase="error",
                                    total_scanned=total_scanned, total_estimate=total_estimate)
        logger.warning("Canal %s: error durante escaneo (offset=%d)", channel_name, offset)
        return total_indexed

    final_estimate = total_scanned
    await upsert_index_progress(channel_id, offset, total_indexed, "done", phase="done",
                                total_scanned=total_scanned, total_estimate=final_estimate)

    if broadcast:
        await broadcast({
            "type": "index_channel_done",
            "channel_id": channel_id,
            "channel_name": channel_name,
            "total_indexed": total_indexed,
            "total_scanned": total_scanned,
            "total_estimate": final_estimate,
        })

    logger.info("Canal %s completado: %d items indexados, %d/%d scanned",
                channel_name, total_indexed, total_scanned, final_estimate)
    return total_indexed


async def run_full_index(downloader, config, broadcast=None, stop_flag: asyncio.Event = None, force: bool = False):
    api_key = config.get("tmdb_api_key", "")
    tmdb_enabled = config.get("tmdb_enabled", False) and bool(api_key)

    logger.info("=== Indexacion completa iniciada (TMDB=%s, force=%s) ===", "ON" if tmdb_enabled else "OFF", force)

    if force:
        from app.database.connection import reset_all_index_progress
        await reset_all_index_progress()
        logger.info("Progreso reseteado (force)")
        if broadcast:
            await broadcast({"type": "index_phase", "phase": "resetting"})

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "estimating"})

    from app.services.index_estimator import estimate_channels
    estimated = await estimate_channels(downloader, broadcast=broadcast)

    existing_progress = await get_index_progress()
    done_ids = {p["channel_id"] for p in existing_progress if p["status"] == "done"}

    if stop_flag and stop_flag.is_set():
        logger.info("Indexacion detenida tras estimacion")
        return

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "scanning"})

    total_channels = len(estimated)
    scanned = 0
    skipped = 0
    for i, ch_info in enumerate(estimated):
        if stop_flag and stop_flag.is_set():
            logger.info("Indexacion detenida antes del canal %s", ch_info["channel_name"])
            return

        # Un canal ya completado se escanea igualmente, pero desde su ultimo
        # mensaje: solo se piden los nuevos. Antes se omitia y lo publicado
        # despues del primer escaneo no se indexaba nunca.
        if ch_info["channel_id"] in done_ids and not force:
            prog = next((p for p in existing_progress if p["channel_id"] == ch_info["channel_id"]), {})
            pending = ch_info["total_estimate"] - (prog.get("last_message_id", 0) or 0)
            if pending <= 0:
                skipped += 1
                continue
            logger.info("--- Canal %d/%d: %s — ~%d mensajes nuevos ---",
                        i + 1, total_channels, ch_info["channel_name"], pending)
        else:
            logger.info("--- Canal %d/%d: %s (%s mensajes) ---",
                        i + 1, total_channels, ch_info["channel_name"], ch_info["total_estimate"])
        scanned += 1

        await scan_channel(
            downloader,
            ch_info["channel_id"],
            ch_info["channel_name"],
            api_key=api_key if tmdb_enabled else "",
            broadcast=broadcast,
            total_estimate=ch_info["total_estimate"],
            stop_flag=stop_flag,
        )

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "done"})

    logger.info("=== Indexacion completa finalizada (scanned=%d, skipped=%d) ===", scanned, skipped)


async def enrich_all_missing_tmdb(api_key: str, broadcast=None):
    global _enrich_running
    if not api_key or _enrich_running:
        return 0
    _enrich_running = True
    try:
        return await _enrich_loop(api_key, broadcast)
    finally:
        _enrich_running = False


async def _enrich_loop(api_key: str, broadcast=None):
    total_enriched = 0
    batch_num = 0
    t_start = time.time()
    idle_logged = False

    # Margen antes de cerrar el bucle. ensure_enrich_worker() no arranca otro
    # mientras este siga vivo, asi que un mensaje que llegue justo cuando este
    # iba a salir se quedaria sin enriquecer; y como en la Home solo sale lo
    # `tmdb_valid`, esa pelicula no aparece hasta el siguiente barrido (horas).
    GRACE_CHECKS = 4
    GRACE_SLEEP = 5
    grace_left = GRACE_CHECKS

    while True:
        from app.database.connection import get_media_without_tmdb
        items = await get_media_without_tmdb(limit=300)
        for cid in {i["channel_id"] for i in items}:
            await tipos_de_temas(cid)
        if not items:
            if _active_scans > 0:
                # El escaneo sigue metiendo archivos: se espera en vez de salir.
                if not idle_logged:
                    logger.info("TMDB: al dia, esperando al escaneo en curso")
                    idle_logged = True
                await asyncio.sleep(5)
                grace_left = GRACE_CHECKS
                continue
            if grace_left > 0:
                grace_left -= 1
                await asyncio.sleep(GRACE_SLEEP)
                continue
            break
        idle_logged = False
        grace_left = GRACE_CHECKS

        batch_num += 1
        logger.info("TMDB: batch %d — %d items pendientes", batch_num, len(items))

        if broadcast:
            await broadcast({"type": "index_phase", "phase": "enriching"})

        enriched = await _enrich_batch(api_key, items)
        total_enriched += enriched or 0

        elapsed = time.time() - t_start
        logger.info("TMDB: batch %d completado — %d enriquecidos (%d total en %.1fs)",
                    batch_num, enriched or 0, total_enriched, elapsed)

        await asyncio.sleep(0.5)

    logger.info("TMDB: enriquecimiento finalizado — %d items en %d batches (%.1fs)",
                total_enriched, batch_num, time.time() - t_start)

    if broadcast:
        await broadcast({"type": "index_phase", "phase": "done"})

    return total_enriched


async def reclassify_all(api_key: str, broadcast=None):
    """Vuelve a interpretar todos los nombres de archivo con el parser actual
    y manda a TMDB lo que quedo sin emparejar o emparejado con el tipo
    equivocado. Lo que ya esta bien (tipo detectado == tipo TMDB) se respeta."""
    from app.database.connection import fetch_all_media_for_reclassify, bulk_update_parsed, reset_tmdb_for_ids

    t0 = time.time()
    if broadcast:
        await broadcast({"type": "index_phase", "phase": "reclassifying"})

    rows = await fetch_all_media_for_reclassify()
    for cid in {r["channel_id"] for r in rows}:
        await tipos_de_temas(cid)
    updates = []
    to_reset = []
    changed_type = 0
    for r in rows:
        if r.get("tmdb_manual"):
            # Lo decidido a mano en Admin -> Revision no se recalcula.
            continue
        p = interpretar_item(r)
        clean = p.clean_title[:300]
        if (clean, p.media_type, p.season, p.episode) != (r["clean_title"], r["media_type"], r["season"], r["episode"]):
            updates.append((clean, p.media_type, p.season, p.episode, r["id"]))
            if p.media_type != r["media_type"]:
                changed_type += 1
        mismatch = r["tmdb_type"] and not tmdb_type_matches(p.media_type, r["tmdb_type"])
        # "[1945] Cena de Navidad" emparejado con una pelicula de 2026: el año
        # del archivo manda (antes no se pasaba a TMDB).
        year_off = (p.media_type == "movie" and p.year and r["tmdb_year"]
                    and abs(p.year - r["tmdb_year"]) > 1)
        # Emparejado cuando se mandaba el titulo del episodio como serie, o con
        # un resultado que no se parece en nada a lo que se busco.
        no_title = r["tmdb_id"] is not None and not p.title and not p.tmdb_id_hint
        bad_match = False
        if r["tmdb_id"] is not None and p.title and not p.tmdb_id_hint:
            sim = title_similarity(p.title, r["tmdb_title"], r["tmdb_original"])
            votes = r["tmdb_votes"]
            bad_match = sim < 0.6 and len(p.title.split()) >= 3 and votes is not None and votes < 500
        if r["tmdb_id"] is None or mismatch or year_off or no_title or bad_match or r["tmdb_valid"] is not True:
            to_reset.append(r["id"])

    for i in range(0, len(updates), 2000):
        await bulk_update_parsed(updates[i:i + 2000])
    for i in range(0, len(to_reset), 5000):
        await reset_tmdb_for_ids(to_reset[i:i + 5000])

    logger.info("Reclasificacion: %d archivos, %d actualizados (%d cambian de tipo), %d a re-buscar en TMDB (%.1fs)",
                len(rows), len(updates), changed_type, len(to_reset), time.time() - t0)

    result = {"total": len(rows), "updated": len(updates), "type_changed": changed_type, "to_search": len(to_reset)}
    if api_key:
        result["enriched"] = await enrich_all_missing_tmdb(api_key, broadcast=broadcast)
        result["cache_refreshed"] = await refresh_missing_cache(api_key)
    elif broadcast:
        await broadcast({"type": "index_phase", "phase": "done"})
    return result


async def refresh_missing_cache(api_key: str) -> int:
    """Descarga los detalles de los (tmdb_id, tipo) que media_items referencia
    pero no estan en tmdb_cache (con la clave antigua pelicula y serie con el
    mismo id se pisaban)."""
    from app.database.connection import get_missing_cache_pairs
    from app.services.tmdb import get_details as tmdb_details

    pairs = await get_missing_cache_pairs()
    if not pairs:
        return 0
    logger.info("TMDB: %d titulos sin ficha en cache, descargando", len(pairs))
    sem = asyncio.Semaphore(TMDB_CONCURRENCY)
    done = 0

    async def _one(tmdb_id, media_type):
        nonlocal done
        async with sem:
            details = await tmdb_details(api_key, tmdb_id, media_type)
            if details:
                await upsert_tmdb_cache(details)
                done += 1

    await asyncio.gather(*[_one(i, t) for i, t in pairs], return_exceptions=True)
    logger.info("TMDB: %d/%d fichas recuperadas", done, len(pairs))
    return done


async def reindexar_temas(downloader, channel_id: int, temas: list[int], api_key: str = "") -> int:
    """Vuelve a indexar unos temas de un canal (los que han dejado de
    ignorarse): solo sus mensajes, con su contexto. Lo que ya estaba indexado
    no se duplica (ON CONFLICT)."""
    entidad = downloader.channels.get(channel_id, {}).get("entity")
    if not entidad:
        return 0
    nombre = downloader.channel_name(channel_id)
    total = 0
    for tema in temas:
        await tipos_de_temas(channel_id)
        seguidor = seguidor_para(downloader, channel_id)
        lote: list[dict] = []
        async for msg in downloader.client.iter_messages(entidad, reply_to=tema, reverse=True):
            ctx = ver(seguidor, msg)
            if not ctx:
                continue
            nombre_archivo = downloader._get_file_name(msg)
            lote.append(_item_from_message(downloader, channel_id, nombre, msg, nombre_archivo,
                                           downloader._get_file_size(msg), ctx))
            if len(lote) >= 500:
                await insert_media_items(lote)
                total += len(lote)
                lote = []
                await asyncio.sleep(1)
        if lote:
            await insert_media_items(lote)
            total += len(lote)
    logger.info("Temas %s de %s indexados de nuevo: %d archivos", temas, nombre, total)
    if api_key and total:
        ensure_enrich_worker(api_key)
    return total


async def index_live_message(downloader, channel_id: int, msg, api_key: str = "", broadcast=None):
    """Indexa un mensaje recien publicado en un canal (evento de Telethon).

    Todo lo que llega queda anotado en la tabla `novedades`, se indexe o no, y
    con el motivo del descarte: sin eso, un mensaje ignorado no dejaba ni
    rastro y no habia forma de saber por que una pelicula no aparecia.
    """
    from app.database.connection import bump_index_progress, log_novedad

    from app.database.media import temas_ignorados

    name = downloader.channel_name(channel_id)
    indexed = False
    reason = ""
    item = None
    await tipos_de_temas(channel_id)
    seguidor = _seguidores_vivo.get(channel_id)
    if seguidor is None:
        seguidor = _seguidores_vivo[channel_id] = seguidor_para(downloader, channel_id)
    ctx = ver(seguidor, msg)

    if ctx and ctx.tema in (await temas_ignorados()).get(channel_id, set()):
        reason = "tema ignorado"
    elif not msg.media:
        reason = "mensaje sin archivo"
    else:
        file_name = downloader._get_file_name(msg)
        if not file_name:
            reason = "archivo sin nombre"
        elif not downloader._is_downloadable(file_name):
            reason = "extension no admitida"
        else:
            size = downloader._get_file_size(msg)
            if not size:
                reason = "archivo sin tamaño"
            else:
                item = _item_from_message(downloader, channel_id, name, msg, file_name, size, ctx)
                await insert_media_items([item])
                indexed = True
                logger.info("Nuevo en %s: %s (%s)", name, file_name[:80],
                            item.get("media_type") or "sin clasificar")
                ensure_enrich_worker(api_key, broadcast)

    await log_novedad(
        channel_id=channel_id, channel_name=name, message_id=msg.id,
        file_name=(item or {}).get("file_name") or downloader._get_file_name(msg) or "",
        indexed=indexed, reason=reason,
        media_type=(item or {}).get("media_type"),
        season=(item or {}).get("season"), episode=(item or {}).get("episode"),
        clean_title=(item or {}).get("clean_title"),
    )

    if broadcast:
        try:
            await broadcast({"type": "novedad", "channel": name, "indexed": indexed,
                             "file_name": (item or {}).get("file_name", ""), "reason": reason})
        except Exception as e:
            logger.warning("No se pudo anunciar la novedad: %s", e)

    await bump_index_progress(channel_id, msg.id, indexed)


async def periodic_rescan(downloader, config, hours: float, broadcast=None):
    """Barrido incremental cada `hours` horas por si algun mensaje se perdio
    mientras no habia conexion."""
    from app.routers import index_router

    while True:
        await asyncio.sleep(hours * 3600)
        if index_router._index_running:
            continue
        index_router._index_running = True
        try:
            logger.info("Barrido periodico de canales (cada %.1f h)", hours)
            await run_full_index(downloader, config, broadcast=broadcast)
        except Exception as e:
            logger.error("Barrido periodico fallo: %s", e)
        finally:
            index_router._index_running = False
