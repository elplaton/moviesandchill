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
ultima de su tema, de hace poco y sin una pegatina en medio. `pistas_de()`
saca de un texto el titulo, el año, el titulo original y los enlaces.
"""
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import timedelta

# Una ficha vale para los archivos que llegan detras durante este rato. Es
# holgado a proposito: en un grupo con temas los mensajes de una pelicula se
# intercalan con los de otros temas y a veces se suben con calma.
VIGENCIA = timedelta(minutes=90)
# El tema "General" de un foro, al que va lo que no dice tema.
TEMA_GENERAL = 1

_TMDB_RE = re.compile(r"themoviedb\.org/(movie|tv)/(\d+)", re.IGNORECASE)
_IMDB_RE = re.compile(r"imdb\.com/title/(tt\d{5,10})", re.IGNORECASE)
_POSTER_RE = re.compile(r"https?://image\.tmdb\.org/t/p/\w+/[\w-]+\.(?:jpg|jpeg|png|webp)", re.IGNORECASE)
_URL_RE = re.compile(r"https?://\S+")
# El año: "(2026)", "- 1999", "2026" suelto o "2.026" (el formato con emojis).
_AÑO_PAR_RE = re.compile(r"[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]")
_AÑO_RE = re.compile(r"(?<![\w.])((?:19|20)\d{2}|[12]\.\d{3})(?![\w.]|\.\d)")
# Lo que separa el titulo del titulo original o del resto.
_SEPARADORES = re.compile(r"\s*(?:\||❕|❗|•|·|➖|—|–|\s-\s)\s*")
# Lo que, al principio de un trozo, ya no es titulo sino la ficha tecnica.
_NO_TITULO = re.compile(
    r"^(?:audio|idioma|g[eé]nero|g[eé]neros|estreno|puntuaci[oó]n|duraci[oó]n|sinopsis|calidad|"
    r"formato|tama[nñ]o|castellano|latino|subt[ií]tulos?|thriller|drama|terror|comedia|suspense|"
    r"acci[oó]n|animaci[oó]n|documental|romance|aventura|fantas[ií]a|ciencia ficci[oó]n|western|"
    r"b[eé]lico|musical|crimen|misterio|familia|historia|pel[ií]cula|serie)\b",
    re.IGNORECASE)


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
    # Los emojis hacen de separador en el formato "🎬 TITULO 💎 GENERO 🍿 2.026".
    linea_sep = "".join(" | " if _es_simbolo(c) else c for c in linea)
    año, m_año = _año(linea_sep)
    if m_año is None:
        año, _ = _año(sin_urls)
    # El titulo es lo de antes del año si lo hay delante ("TITULO (2026)
    # sinopsis..."); si el año va detras de todo, la linea entera.
    cabeza = linea_sep[:m_año.start()] if m_año and _limpia(linea_sep[:m_año.start()]) else linea_sep

    trozos = [_limpia(t) for t in _SEPARADORES.split(cabeza)]
    trozos = [t for t in trozos if re.search(r"[^\W\d_]", t) and not _NO_TITULO.match(t)]
    if not trozos:
        return None
    titulo = trozos[0]
    # "El Experimento | The Experiment (2010)": el segundo trozo es el titulo
    # original si es corto y no es la sinopsis.
    original = trozos[1] if len(trozos) > 1 and len(trozos[1].split()) <= 8 else None
    if original and original.lower() == titulo.lower():
        original = None
    return Pistas(
        titulo=titulo[:200], año=año, original=original[:200] if original else None,
        tmdb_id=int(tmdb.group(2)) if tmdb else None,
        tmdb_tipo=tmdb.group(1).lower() if tmdb else None,
        imdb_id=imdb.group(1) if imdb else None,
        poster=poster.group(0) if poster else None,
    )


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
            pie = texto or None
            pistas = (pistas_de(ficha.texto) if ficha else None) or pistas_de(pie)
            if ficha and pie and pistas:
                # La caratula o el enlace pueden venir en el pie aunque la
                # ficha no los traiga.
                del_pie = pistas_de(pie)
                if del_pie:
                    pistas.poster = pistas.poster or del_pie.poster
                    pistas.tmdb_id = pistas.tmdb_id or del_pie.tmdb_id
                    pistas.tmdb_tipo = pistas.tmdb_tipo or del_pie.tmdb_tipo
                    pistas.imdb_id = pistas.imdb_id or del_pie.imdb_id
                    pistas.año = pistas.año or del_pie.año
            return Contexto(tema=tema, pie=pie, ficha=ficha.texto if ficha else None, pistas=pistas)
        # Una foto (o un texto) que nombra una pelicula abre bloque. Una foto
        # sin texto no dice nada y no cambia nada.
        if texto and pistas_de(texto) and (self.es_foto(msg) or _AÑO_PAR_RE.search(texto)):
            self._fichas[tema] = _Ficha(texto=texto[:2000], fecha=msg.date)
        return None
