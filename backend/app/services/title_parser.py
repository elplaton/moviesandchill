"""Interpreta nombres de archivo de Telegram: tipo, temporada, episodio, titulo y año.

Es la unica fuente de verdad para decidir si un archivo es pelicula o serie y
que texto se manda a TMDB. Antes cada capa (indexador, buscador, frontend)
tenia su propia regex y no coincidian entre si: el indexador solo reconocia
"1x01"/"S01E01", asi que "Los Simpson Temporada 23.part02.rar" o
"Rurouni Kenshin - 89.mkv" se guardaban como peliculas, y a TMDB se le
mandaba el titulo con el nombre del episodio pegado ("Suits La vida util").
"""
import re
import unicodedata
from dataclasses import dataclass

VIDEO_EXTS = (".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts")
ARCHIVE_EXTS = (".tar.gz", ".tar.bz2", ".7z", ".zip", ".rar", ".tar", ".tgz", ".tbz2")

# Palabras de calidad/idioma que no forman parte del titulo.
QUALITY_TAGS = [
    "2160p", "1080p", "720p", "576p", "480p", "4k", "uhd", "uhdremux", "hdr", "hdr10", "hdr10+",
    "hdrip", "bdrip", "bluray", "blu-ray", "web-dl", "web dl", "webdl", "webrip", "brrip", "dvdrip",
    "dvd", "dvb", "hdtv", "x264", "x265", "hevc", "h265", "h264", "h.265", "h.264", "avc", "av1",
    "aac", "ddp", "dts", "truehd", "atmos", "multi", "dual", "castellano", "spanish", "spanishsub",
    "latino", "sub", "subs", "vose", "vos", "v.o", "v o", "vo", "espanol", "español", "espanola",
    "española", "cas", "lat", "jap", "eng", "english", "englishsub", "spa", "ita", "dl", "dv", "dovi",
    "dolby vision", "remux", "dubbed", "ac3", "eac3", "remastered", "web", "sat", "10 bits", "10bit",
    "zip", "rar", "7z", "multiaudios", "audios", "tv", "bd", "bd-1080p", "extra",
]
_QUALITY_RE = re.compile(r"(?<![\w])(" + "|".join(re.escape(t) for t in QUALITY_TAGS) + r")(?![\w])", re.IGNORECASE)
_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
_TMDBID_RE = re.compile(r"tmdbid[\s_-]*(\d+)", re.IGNORECASE)
# Cosas con forma NxM que no son episodios: resoluciones y codecs.
_NOISE_RE = re.compile(r"\b\d{3,4}x\d{3,4}\b|\b\d?x26[45]\b", re.IGNORECASE)

# Marcadores de episodio con temporada, del mas fiable al mas ambiguo.
_EP_PATTERNS = [
    # 1x01, 01x05, #02x11, 3x23-24, y con el episodio de una cifra: 1x5, 4x1
    # (lo que parece una resolucion o un codec ya lo ha quitado _NOISE_RE).
    re.compile(r"(?<![\dx])(\d{1,2})x(\d{1,3})(?:-\d{1,3})?(?!\d)", re.IGNORECASE),
    # S01E01, S01E009, S01 E01, T01E10, [S05.E06], [S 1 E 3]
    re.compile(r"(?<![A-Za-z])[sStT]\s*(\d{1,2})\s*[.\s]?\s*[eE]\s*(\d{1,3})(?!\d)"),
    # T6 C07, T1 C01, T4C12: temporada y capitulo ("Homeland T6 C07").
    re.compile(r"(?<![A-Za-z])[tT]\s*(\d{1,2})\s*[.\s]?\s*[cC]\s*(\d{1,3})(?!\d)"),
    # S0107 pegado, sin la E: temporada 1, episodio 7 ("rms Mntrss_S0107").
    # Solo 01-19 y nunca el 00: "Honda S2000" no es la temporada 20.
    re.compile(r"(?<![A-Za-z])[sS](0[1-9]|1\d)(?!00)(\d{2})(?!\d)"),
    # Temporada 2 Episodio 17 / Season 2 Episode 3 / Temporada 3 [HDTV][Cap.303]
    re.compile(r"\b(?:temporada|season|temp)[\s.-]*(\d{1,2})\b.*?\b(?:episodio|episode|capitulo|capítulo|cap|ep)[\s.-]*(\d{1,3})\b", re.IGNORECASE),
]
# Solo temporada: packs completos ("Vikingos - Temporada 1 (Blu-ray 1080p).zip.010")
_SEASON_ONLY_RE = re.compile(r"\b(?:temporada|season|temp)[\s.-]*(\d{1,2})\b", re.IGNORECASE)
# Solo episodio: "Katekyo Hitman Reborn Castellano episodio 43", "Final Season 297"
# Las telenovelas pasan de mil: "Capítulo 1229".
_EPISODE_ONLY_RE = re.compile(r"\b(?:episodio|episode|capitulo|capítulo|cap|ep)[\s.-]*(\d{1,4})\b", re.IGNORECASE)
# "Final Season 297": tres cifras justo detras de la palabra no son una temporada.
_SEASON_WORD_NUM_RE = re.compile(r"\b(?:season|temporada)\s+(\d{3})(?=\s*[\[\(.]|\s*$)", re.IGNORECASE)
# Estilo anime/fansub, sin temporada:
#   "Rurouni Kenshin - 89 [1080p].mkv", "InuYasha - 051.mkv"
_ANIME_DASH_RE = re.compile(r"^(.+?)\s+-\s+(\d{1,3})(?=\s*[\[\(.]|\s*$)")
#   "[BB] Fairy Tail 155.mkv"
_ANIME_FANSUB_RE = re.compile(r"^\[[^\]]+\]\s*(.+?)\s+(\d{2,3})(?=\s*[\[\(.]|\s*$)")
#   "Keroro 149 Vuelve Alisa..." / "FullMetal Alchemist 18 La Nota De Marco" (numero seguido de texto)
_ANIME_MID_RE = re.compile(r"^(\D.*?)\s(\d{2,3})\s+(?=[^\d\W])")


@dataclass
class ParsedName:
    media_type: str            # "movie" | "series"
    season: int | None
    episode: int | None
    title: str                 # texto para buscar en TMDB ("" si no se puede deducir)
    year: int | None
    clean_title: str           # titulo + resto util, para busquedas ILIKE
    tmdb_id_hint: int | None = None   # "[tmdbid-812]" en el nombre


def strip_extension(name: str) -> str:
    name = re.sub(r"\.part\d+\.rar$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.part\d+$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.r\d{2,}$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.z\d{2,}$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.\d{3,}$", "", name)
    low = name.lower()
    for ext in ARCHIVE_EXTS + VIDEO_EXTS:
        if low.endswith(ext):
            name = name[:-len(ext)]
            low = name.lower()
    # "mkv.001" deja "mkv" colgando; "_7z.001" tambien.
    name = re.sub(r"[._\s](mkv|mp4|avi|7z|zip|rar)$", "", name, flags=re.IGNORECASE)
    return name


def _clean(text: str) -> str:
    text = _TMDBID_RE.sub(" ", text)
    text = re.sub(r"\{[^}]*\}", " ", text)
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"@\S+", " ", text)
    text = _NOISE_RE.sub(" ", text)
    text = re.sub(r"\s+by\s+\w+.*$", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+por\s+\w+\s*$", " ", text, flags=re.IGNORECASE)
    text = _QUALITY_RE.sub(" ", text)
    text = re.sub(r"\b(?:temporada|season|temp)[\s.-]*\d{1,2}\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:episodio|episode|capitulo|capítulo|cap|ep)[\s.-]*\d{1,4}\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<![A-Za-z])[sS]\d{1,2}(?![\w])", " ", text)
    return _tidy(text)


def _tidy(text: str) -> str:
    text = re.sub(r"(?<![\w])[+#|]+(?![\w])", " ", text)
    text = re.sub(r"(\s*[\-–—]\s*){2,}", " - ", text)
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" -–—_.,:;|#[](){}")
    text = re.sub(r"\s+[\-–—:;,|#]+$", "", text)
    return text.strip()


def _extract_year(text: str) -> int | None:
    # Un año entre parentesis/corchetes manda; si no, el ultimo año suelto
    # ("1917 (2019)" es de 2019, no de 1917).
    m = re.search(r"[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]", text)
    if m:
        return int(m.group(1))
    found = None
    for m in _YEAR_RE.finditer(text):
        before = text[max(0, m.start() - 1):m.start()]
        after = text[m.end():m.end() + 1]
        if (not before or not before.isalnum()) and (not after or not after.isalnum()):
            found = int(m.group(1))
    if found and 1900 <= found <= 2035:
        return found
    return None


def _sin_simbolos(text: str) -> str:
    """Quita lo que no es texto: emojis y pegatinas (🏁, ❕), y "ª"/"º", que en
    algunos canales van pegados al titulo ("La silla (2026) ª[HD 1080P]") y
    acababan en lo que se le mandaba a TMDB ("La silla ª")."""
    return "".join(" " if ch in "ªº" or unicodedata.category(ch) in ("So", "Sk", "Cf", "Co") else ch
                   for ch in text)


# Un año que puede cerrar el titulo de una pelicula: entre parentesis o
# corchetes, o suelto con algo que no sea una cifra delante y detras. Detras
# puede ir una letra: "La_voz_dormida_2011DRAMA_Spanish..." pega el genero.
_AÑO_CORTE_RE = re.compile(r"[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]|(?<![\w])((?:19|20)\d{2})(?!\d)")


def _corte_en_año(norm: str) -> tuple[str, int] | None:
    """En una pelicula, lo que va antes del primer año es el titulo: todo lo
    de detras es calidad, idioma, firma del que la sube... ("Magallanes_2025_
    ªBluray_Rip_X264...", "Kraken (2026) 1080p Es-No+s-kowalski&xusman"). Solo
    si hay algo delante: "1917 (2019)" es la pelicula de 1917, y solo años
    creibles: "Blade Runner 2049" no se corta."""
    for m in _AÑO_CORTE_RE.finditer(norm):
        año = int(m.group(1) or m.group(2))
        if not 1900 <= año <= 2035 or m.start() == 0:
            continue
        titulo = _clean(norm[:m.start()])
        if titulo:
            return titulo, año
    return None


def parse_filename(filename: str) -> ParsedName:
    base = _sin_simbolos(strip_extension(filename or ""))
    # "@La_Comunidad" hay que quitarlo entero antes de convertir "_" en espacio;
    # si no, sobrevive "Comunidad" y "Billions Comunidad" no existe en TMDB.
    base = re.sub(r"@[\w.]+", " ", base)
    # "GHOSTLIGHT AÑO 2.025": el año con punto de los mil, como en los pies.
    base = re.sub(r"\bA[ÑN]O\s*([12])\.(\d{3})\b", r"(\1\2)", base, flags=re.IGNORECASE)
    hint = _TMDBID_RE.search(base)
    tmdb_id_hint = int(hint.group(1)) if hint else None
    year = _extract_year(base)

    # Los guiones bajos son espacios; se limpia lo que tiene forma de episodio
    # pero no lo es antes de buscar marcadores. Y en los nombres de "escena"
    # ("Billy.Bathgate.1991.HDrip.XviD"), sin un espacio y con varios puntos,
    # los puntos tambien lo son: si no, a TMDB le llega "Billy.Bathgate".
    sin_guiones = base.replace("_", " ")
    if " " not in sin_guiones.strip() and sin_guiones.count(".") >= 2:
        sin_guiones = sin_guiones.replace(".", " ")
    norm = _NOISE_RE.sub(" ", sin_guiones)

    season = episode = None
    head = norm
    title = None

    for pat in _EP_PATTERNS:
        m = pat.search(norm)
        if m:
            season, episode = int(m.group(1)), int(m.group(2))
            head = norm[:m.start()]
            if not _clean(head):
                # Marcador al principio: "1x09 - Gomorrah" y "6x04 Elite" llevan la
                # serie detras, pero "12x13. Titulo" y "S02E030_Una buena amiga"
                # llevan el titulo del episodio: sin titulo fiable.
                raw_tail = base[m.end():] if base[:m.end()] == norm[:m.end()] else ""
                tail = norm[m.end():].lstrip()
                if tail.startswith((".", "]")) or raw_tail.startswith("_"):
                    title = ""
                elif tail.startswith(("-", "–", "—")):
                    head = tail.lstrip("-–— ")
                else:
                    head = tail
            break
    else:
        m = _SEASON_ONLY_RE.search(norm) or _SEASON_WORD_NUM_RE.search(norm)
        if m:
            if m.re is _SEASON_ONLY_RE:
                season = int(m.group(1))
            else:
                episode = int(m.group(1))
            head = norm[:m.start()]
        else:
            m = _EPISODE_ONLY_RE.search(norm)
            if m:
                episode = int(m.group(1))
                head = norm[:m.start()]
            else:
                for pat in (_ANIME_DASH_RE, _ANIME_FANSUB_RE, _ANIME_MID_RE):
                    m = pat.match(norm)
                    if not m:
                        continue
                    n = int(m.group(2))
                    if 1900 <= n <= 2035:
                        continue
                    # "Distrito 13 Ultimatum" no es un episodio: un numero de dos
                    # cifras en medio solo cuenta con cero delante o con guiones
                    # bajos alrededor ("FullMetal_Alchemist_18_La_Nota").
                    if pat is _ANIME_MID_RE and len(m.group(2)) == 2 and not m.group(2).startswith("0") \
                            and not re.search(r"_%s_" % m.group(2), base):
                        continue
                    episode = n
                    head = m.group(1)
                    break

    # "Temporada 3 [Cap.303]": el episodio lleva la temporada delante.
    if season is not None and episode is not None and episode >= 100 and episode // 100 == season:
        episode = episode % 100

    is_series = season is not None or episode is not None
    if title is None and not is_series:
        corte = _corte_en_año(norm)
        if corte:
            title, year = corte
    if title is None:
        title = _clean(head)
    if title and year:
        # El año detectado no forma parte del titulo (salvo que el titulo sea
        # solo el año: "1917"). Solo se quita ese año: "Blade Runner 2049" se queda.
        without_year = re.sub(r"(?<!\d)%d(?!\d)" % year, " ", title)
        without_year = re.sub(r"\s+", " ", without_year).strip(" -–—_.,:;|")
        if without_year:
            title = without_year

    clean = _clean(norm)
    clean = re.sub(r"(?<![\dx])\d{1,2}x\d{2,3}(?:-\d{2,3})?(?!\d)", " ", clean, flags=re.IGNORECASE)
    clean = re.sub(r"(?<![A-Za-z])[sStT]\s*\d{1,2}\s*[.\s]?\s*[eE]\s*\d{1,3}(?!\d)", " ", clean)
    clean = _tidy(clean)

    return ParsedName(
        media_type="series" if is_series else "movie",
        season=season,
        episode=episode,
        title=title,
        year=year,
        clean_title=clean or base,
        tmdb_id_hint=tmdb_id_hint,
    )


# Nombres que no dicen nada del titulo: lo que sale de grabar un directo o de
# bajar un video de una web ("chunklist_b1024000 (480p_aac).mp4").
_GENERICO_RE = re.compile(r"^(?:output|chunklist|videoplayback|video|vid|file|archivo|capitulo|capítulo|episodio)\b",
                          re.IGNORECASE)


def numero_suelto(filename: str) -> int | None:
    """El numero de capitulo de un archivo que no dice de que serie es:
    "12 - Televisatron", "063 ¡Resonancia!...", "167. Aparece el dios Ener",
    "136_Zeny_en_la_isla...", "Fraguel_Rock_63", "Ana de nadie 46". Un año no
    cuenta. Solo tiene sentido cuando algo mas dice que es una serie (el tema
    del foro o la ficha de encima): "Apollo 13" tambien acaba en numero."""
    base = _sin_simbolos(strip_extension(filename or "")).replace("_", " ").strip()
    p = parse_filename(filename)
    if p.episode is not None:
        return p.episode
    # Delante ("12 - ..."), al final del nombre, o justo antes de la calidad
    # ("Fraguel_Rock_63_1080p.Dual_Radioactive").
    for m in (re.match(r"^(\d{1,4})\s*(?:[-.)]|\s)\s*\S", base), re.search(r"\s(\d{2,4})$", base),
              re.search(r"\s(\d{2,4})(?=\s+\d{3,4}p\b)", base)):
        if m and not 1900 <= int(m.group(1)) <= 2035:
            return int(m.group(1))
    return None


def es_generico(filename: str) -> bool:
    """El nombre no dice nada que se pueda buscar ("output.mp4", "Capítulo 1229")."""
    base = _sin_simbolos(strip_extension(filename or "")).replace("_", " ").strip()
    return bool(_GENERICO_RE.match(base)) or not re.search(r"[^\W\d_]{3,}", base)
