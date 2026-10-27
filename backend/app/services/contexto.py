"""Lo que dicen los mensajes de alrededor de un archivo.

El nombre del archivo es lo peor que hay para saber que pelicula es: va lleno
de calidades, firmas y basura ("Magallanes_2025_ªBluray_Rip_X264..."). Muchos
canales lo dicen mucho mejor en otros sitios, y hasta ahora no se leia nada de
eso. En el tema "Peliculas" de YoSoyFran, por ejemplo, cada pelicula es un
bloque:

    [foto]     LA SILLA (2026)                       <- la "ficha"
               📅 Estreno: 2026-05-29 · Géneros: ...    (y a veces un enlace
                                                        a TMDB, IMDb o la
                                                        caratula de TMDB)
    [video]    La silla (2026) [HD 1080P].mp4        <- el archivo, con su
               🎬 LA SILLA 💎 TERROR 🍿 2.026           "pie" de texto
    [archivo]  La silla (2026) [WEB-DL 720p].mkv     <- otra calidad
    [pegatina]                                       <- fin del bloque

`Seguidor` va viendo los mensajes en orden (el escaneo y el vivo los ven del
mas viejo al mas nuevo) y a cada archivo le pega la ficha que le toca: la
ultima de su tema, de hace poco, sin una pegatina en medio y que hable de lo
mismo que el nombre del archivo (`concuerda()`): en un tema de conversacion
la foto de uno y el archivo de otro pueden ir seguidos sin tener nada que ver.
`pistas_de()` saca de un texto el titulo, el año, el titulo original y los
enlaces.

Otros canales lo escriben de otra forma, y tambien vale: K9 pone
"Nombre: King Kong / Año: 1933 / Director: ..." en la ficha, y Las Cositas
"Buddy (1080p) / SINOPSIS: ..." (la calidad entre parentesis y sin año).
"""
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from datetime import timedelta

# Una ficha vale para los archivos que llegan detras durante este rato. Es
# holgado a proposito: en un grupo con temas los mensajes de una pelicula se
# intercalan con los de otros temas y a veces se suben con calma.
VIGENCIA = timedelta(minutes=90)
# El tema "General" de un foro, al que va lo que no dice tema.
TEMA_GENERAL = 1
# Sube cuando cambia como se leen las fichas: lo ya releido se vuelve a leer
# (services/relectura.py), porque lo que se guardo se saco con las reglas viejas.
VERSION = 2

_TMDB_RE = re.compile(r"themoviedb\.org/(movie|tv)/(\d+)", re.IGNORECASE)
_IMDB_RE = re.compile(r"imdb\.com/title/(tt\d{5,10})", re.IGNORECASE)
_POSTER_RE = re.compile(r"https?://image\.tmdb\.org/t/p/\w+/[\w-]+\.(?:jpg|jpeg|png|webp)", re.IGNORECASE)
_URL_RE = re.compile(r"https?://\S+")
# El año: "(2026)", "- 1999", "2026" suelto o "2.026" (el formato con emojis).
_AÑO_PAR_RE = re.compile(r"[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]")
_AÑO_RE = re.compile(r"(?<![\w.])((?:19|20)\d{2}|[12]\.\d{3})(?![\w.]|\.\d)")
# Lo que va delante del titulo en las fichas con campos ("Nombre: King Kong").
_ETIQUETA_RE = re.compile(r"^\s*(?:nombre|t[ií]tulo|title|pel[ií]cula|serie)\s*:\s*", re.IGNORECASE)
_ORIGINAL_CAMPO_RE = re.compile(r"^\s*t[ií]tulo original\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
# Lo que entre parentesis no es parte del titulo sino la calidad o el idioma.
_CALIDAD = (r"\d{3,4}p|4k|uhd|hdr\d*|sdr|remux|blu-?ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|"
            r"x26[45]|hevc|dual|vose|vos|castellano|latino|espa[nñ]ol|spanish")
_PARENTESIS_RE = re.compile(r"[\(\[]([^\(\)\[\]]*)[\)\]]")
_CALIDAD_RE = re.compile(rf"\b(?:{_CALIDAD})\b", re.IGNORECASE)
# Desde aqui lo que sigue ya no es titulo: "Gen V mkv y zip", "VECINOS
# INVASORES Audios en Castellano..."
_COLA_RE = re.compile(rf"\b(?:audios?|idiomas?|mkv|mp4|avi|zip|rar|7z|calidad|sinopsis|{_CALIDAD})\b",
                      re.IGNORECASE)
_TEMPORADA_RE = re.compile(r"^(?:temporada|season|parte|volumen)\s*\d+\b", re.IGNORECASE)
# Lo que separa el titulo del titulo original o del resto.
_SEPARADORES = re.compile(r"\s*(?:\||❕|❗|•|·|➖|—|–|\s-\s)\s*")
# Lo que, al principio de un trozo, ya no es titulo sino la ficha tecnica.
_NO_TITULO = re.compile(
    r"^(?:audio|idioma|g[eé]nero|g[eé]neros|estreno|puntuaci[oó]n|duraci[oó]n|sinopsis|calidad|"
    r"formato|tama[nñ]o|castellano|latino|subt[ií]tulos?)\b",
    re.IGNORECASE)
# Un trozo hecho solo de generos ("THRILLER SUSPENSE") tampoco es titulo. Solo
# si es entero: "Historia de una hierba errante" y "Crimen perfecto" si lo son.
_GENERO = (r"thriller|drama|terror|comedia|suspense|acci[oó]n|animaci[oó]n|documental|romance|"
           r"rom[aá]ntica|aventuras?|fantas[ií]a|ciencia ficci[oó]n|western|b[eé]lico|b[eé]lica|musical|"
           r"crimen|misterio|familia|historia|hist[oó]rica|pel[ií]cula|serie")
_SOLO_GENEROS_RE = re.compile(rf"^(?:(?:{_GENERO})[\s,.\-/y]*)+$", re.IGNORECASE)


def _es_simbolo(ch: str) -> bool:
    return unicodedata.category(ch) in ("So", "Sk", "Cf", "Co") or ch in "ªº"


@dataclass
class Pistas:
    titulo: str
    año: int | None = None
    original: str | None = None
    tmdb_id: int | None = None
    tmdb_tipo: str | None = None     # "movie" | "tv"
    imdb_id: str | None = None
    poster: str | None = None


def _año(texto: str) -> tuple[int | None, re.Match | None]:
    for rx in (_AÑO_PAR_RE, _AÑO_RE):
        for m in rx.finditer(texto):
            valor = int(m.group(1).replace(".", ""))
            if 1900 <= valor <= 2035:
                return valor, m
    return None, None


def _limpia(trozo: str) -> str:
    trozo = "".join(" " if _es_simbolo(c) else c for c in trozo)
    trozo = re.sub(r"\s+", " ", trozo)
    return trozo.strip(" -–—_.,:;|#*\"'[]()")


def pistas_de(texto: str | None) -> Pistas | None:
    """Titulo, año, titulo original y enlaces de un texto de Telegram (una
    ficha o un pie). None si no dice nada que parezca un titulo."""
    if not texto:
        return None
    tmdb = _TMDB_RE.search(texto)
    imdb = _IMDB_RE.search(texto)
    poster = _POSTER_RE.search(texto)
    sin_urls = _URL_RE.sub(" ", texto)

    # La primera linea con letras es la que nombra la pelicula.
    linea = next((l for l in sin_urls.splitlines() if re.search(r"[^\W\d_]", l)), "")
    if not linea:
        return None
    # Con etiqueta ("Nombre: 2046") lo de detras es el titulo aunque sea un
    # numero; sin ella, un numero suelto no se toma por titulo.
    con_etiqueta = bool(_ETIQUETA_RE.match(linea))
    linea = _ETIQUETA_RE.sub("", linea)
    # Los emojis hacen de separador en el formato "🎬 TITULO 💎 GENERO 🍿 2.026".
    linea_sep = "".join(" | " if _es_simbolo(c) else c for c in linea)
    año, m_año = _año(linea_sep)
    if m_año is None:
        año, _ = _año(sin_urls)
    # El titulo es lo de antes del año si lo hay delante ("TITULO (2026)
    # sinopsis..."); si el año va detras de todo, la linea entera.
    cabeza = linea_sep[:m_año.start()] if m_año and _limpia(linea_sep[:m_año.start()]) else linea_sep
    if con_etiqueta and m_año and not _limpia(linea_sep[:m_año.start()]) and not _limpia(linea_sep[m_año.end():]):
        # "Nombre: 1917": el numero es el titulo, y el año va en su campo.
        año, _ = _año(sin_urls[sin_urls.index(linea) + len(linea):] if linea in sin_urls else "")

    m = _COLA_RE.search(cabeza)
    if m and re.search(r"[^\W\d_]", _limpia(cabeza[:m.start()])):
        cabeza = cabeza[:m.start()]

    # Lo de entre parentesis sale del titulo: la calidad se tira y lo demas
    # suele ser el titulo original ("Zombi (Dawn of the Dead)").
    entre = []
    def _fuera(m):
        dentro = _limpia(m.group(1))
        if dentro and not _CALIDAD_RE.search(dentro) and not _año(dentro)[0]:
            entre.append(dentro)
        return " "
    cabeza = _PARENTESIS_RE.sub(_fuera, cabeza)

    trozos = []
    for t in _SEPARADORES.split(cabeza):
        t = _limpia(t)
        if ((re.search(r"[^\W\d_]", t) or (con_etiqueta and not trozos and re.search(r"\d", t)))
                and not _NO_TITULO.match(t) and not _SOLO_GENEROS_RE.match(t)
                and not _TEMPORADA_RE.match(t)):
            trozos.append(t)
    if not trozos:
        return None
    titulo = trozos[0]
    # "El Experimento | The Experiment (2010)": el segundo trozo es el titulo
    # original si es corto y no es la sinopsis.
    campo = _ORIGINAL_CAMPO_RE.search(sin_urls)
    candidatos = ([_limpia(campo.group(1))] if campo else []) + trozos[1:2] + entre
    original = next((c for c in candidatos if c and len(c.split()) <= 8 and c.lower() != titulo.lower()), None)
    return Pistas(
        titulo=titulo[:200], año=año, original=original[:200] if original else None,
        tmdb_id=int(tmdb.group(2)) if tmdb else None,
        tmdb_tipo=tmdb.group(1).lower() if tmdb else None,
        imdb_id=imdb.group(1) if imdb else None,
        poster=poster.group(0) if poster else None,
    )


_VACIAS = {"the", "los", "las", "del", "una", "uno", "and", "con", "por", "para", "que", "les", "des",
           "der", "die", "das", "une"}


def _palabras(texto: str | None) -> set[str]:
    sin_tildes = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return {w for w in re.findall(r"[a-z0-9]+", sin_tildes) if len(w) >= 3 and w not in _VACIAS}


def concuerda(pistas: Pistas | None, nombre: str | None) -> bool:
    """Si una ficha puede ser la de este archivo: que compartan alguna
    palabra ("Gen V" y "Generación V 1x01" valen, una empieza como la otra).
    Un archivo cuyo nombre no dice nada ("video_2026-10-01.mp4") se lleva la
    ficha que tenga encima, que es justo para lo que sirve."""
    from app.services.title_parser import parse_filename

    if not pistas:
        return False
    del_archivo = _palabras(parse_filename(nombre or "").title)
    del_archivo = {w for w in del_archivo if not w.isdigit()}
    if not del_archivo or del_archivo <= {"video", "pelicula", "movie"}:
        return True
    de_la_ficha = _palabras(f"{pistas.titulo} {pistas.original or ''}")
    if any(_parecidas(a, b) for a in del_archivo for b in de_la_ficha):
        return True
    # Las siglas: "HDA" es "Hora de Aventuras" y "LMdMM" "La Maldicion de
    # Molly McGee". Las iniciales cuentan todas las palabras, cortas tambien.
    siglas = {_iniciales(t) for t in (pistas.titulo, pistas.original) if t}
    return any(len(w) >= 3 and w.isalpha() and any(w in s for s in siglas)
               for w in _palabras(parse_filename(nombre or "").title))


def _iniciales(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return "".join(w[0] for w in re.findall(r"[a-z0-9]+", sin_tildes))


def _parecidas(a: str, b: str) -> bool:
    """La misma palabra, una que empieza como la otra ("gen", "generacion") o
    casi la misma ("jezabel" y "jezebel", "tokio" y "tokyo", "sicily" y
    "sicilia"), que es como cambian los titulos de un idioma a otro."""
    if a == b or a.startswith(b) or b.startswith(a):
        return True
    return min(len(a), len(b)) >= 4 and SequenceMatcher(None, a, b).ratio() >= 0.75


def pistas_de_contexto(ficha: str | None, pie: str | None) -> Pistas | None:
    """Las pistas de un archivo: las de su ficha y, lo que la ficha no diga
    (la caratula, el enlace, el año), del pie. Sin ficha, las del pie."""
    pistas = pistas_de(ficha) if ficha else None
    del_pie = pistas_de(pie) if pie else None
    if not pistas:
        return del_pie
    if del_pie:
        # La caratula o el enlace pueden venir en el pie aunque la ficha no
        # los traiga.
        pistas.poster = pistas.poster or del_pie.poster
        pistas.tmdb_id = pistas.tmdb_id or del_pie.tmdb_id
        pistas.tmdb_tipo = pistas.tmdb_tipo or del_pie.tmdb_tipo
        pistas.imdb_id = pistas.imdb_id or del_pie.imdb_id
        pistas.año = pistas.año or del_pie.año
    return pistas


def texto_de(msg) -> str:
    """El texto de un mensaje con los enlaces que van escondidos detras de una
    palabra (los "text_url"): ahi suelen ir el de TMDB o IMDb."""
    texto = getattr(msg, "message", None) or ""
    urls = [getattr(e, "url", None) for e in (getattr(msg, "entities", None) or [])]
    urls = [u for u in urls if u and u not in texto]
    return (texto + ("\n" + "\n".join(urls) if urls else "")).strip()


def tema_de(msg) -> int:
    """El tema de un mensaje en un grupo con foro. Lo que no dice tema es del
    "General". En un canal normal tambien sale 1, que es como no tener temas."""
    r = getattr(msg, "reply_to", None)
    if not r:
        return TEMA_GENERAL
    if getattr(r, "reply_to_top_id", None):
        return r.reply_to_top_id
    if getattr(r, "forum_topic", False) and getattr(r, "reply_to_msg_id", None):
        return r.reply_to_msg_id
    return TEMA_GENERAL


@dataclass
class Contexto:
    """Lo que acompaña a un archivo: su tema, su pie y la ficha que le toca."""
    tema: int
    pie: str | None = None
    ficha: str | None = None
    pistas: Pistas | None = None     # de la ficha, o si no hay ficha, del pie


@dataclass
class _Ficha:
    texto: str
    fecha: object


@dataclass
class Seguidor:
    """Recuerda la ultima ficha de cada tema. Hay que enseñarle **todos** los
    mensajes en orden (no solo los archivos): las fichas y las pegatinas son
    justo los que no son archivos."""
    es_foto: callable
    es_sticker: callable
    es_archivo: callable
    # El nombre del archivo de un mensaje, para no pegarle una ficha de otra
    # cosa. Sin el, cualquier ficha vale.
    nombre_de: callable = None
    _fichas: dict = field(default_factory=dict)

    def ver(self, msg) -> Contexto | None:
        tema = tema_de(msg)
        if self.es_sticker(msg):
            # La pegatina cierra el bloque: lo de detras es otra pelicula.
            self._fichas.pop(tema, None)
            return None
        texto = texto_de(msg)
        if self.es_archivo(msg):
            ficha = self._fichas.get(tema)
            if ficha and msg.date and ficha.fecha and msg.date - ficha.fecha > VIGENCIA:
                ficha = None
            if ficha and self.nombre_de and not concuerda(pistas_de(ficha.texto), self.nombre_de(msg)):
                ficha = None
            pie = texto or None
            pistas = pistas_de_contexto(ficha.texto if ficha else None, pie)
            return Contexto(tema=tema, pie=pie, ficha=ficha.texto if ficha else None, pistas=pistas)
        # Una foto (o un texto) que nombra una pelicula abre bloque. Una foto
        # sin texto no dice nada y no cambia nada.
        if texto and pistas_de(texto) and (self.es_foto(msg) or _AÑO_PAR_RE.search(texto)):
            self._fichas[tema] = _Ficha(texto=texto[:2000], fecha=msg.date)
        return None
