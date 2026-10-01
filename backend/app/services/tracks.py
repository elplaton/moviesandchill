"""Pistas de audio y subtitulos de un video.

Sirve para dos cosas: enseñar en el panel que trae de verdad un archivo
(cuando algo suena raro, lo primero es mirar las pistas) y decidir en la
conversion cual es el audio que debe sonar por defecto.
"""
import json
import logging
import os
import re
import subprocess

logger = logging.getLogger("tmd")

# Subtitulos que caben en un fichero .vtt. Los de imagen (PGS de Blu-ray,
# VobSub de DVD) son fotogramas, no texto: no hay nada que extraer sin OCR.
SUBS_TEXTO = ("subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text", "sami")
SUBS_IMAGEN = ("hdmv_pgs_subtitle", "pgs", "dvd_subtitle", "dvdsub", "vobsub", "xsub", "dvb_subtitle")

# Codigos ISO 639-2 que usa Matroska, mas lo que suelen escribir a mano.
NOMBRE_IDIOMA = {
    "spa": "Español", "es": "Español", "esp": "Español", "cas": "Español (castellano)",
    "lat": "Español (latino)", "spa-mx": "Español (latino)",
    "eng": "Inglés", "en": "Inglés",
    "fra": "Francés", "fre": "Francés", "fr": "Francés",
    "deu": "Alemán", "ger": "Alemán", "de": "Alemán",
    "ita": "Italiano", "it": "Italiano",
    "por": "Portugués", "pt": "Portugués",
    "cat": "Catalán", "eus": "Euskera", "baq": "Euskera", "glg": "Gallego", "gle": "Irlandés",
    "jpn": "Japonés", "ja": "Japonés", "kor": "Coreano", "zho": "Chino", "chi": "Chino",
    "rus": "Ruso", "ara": "Árabe", "hin": "Hindi", "nld": "Neerlandés", "dut": "Neerlandés",
    "swe": "Sueco", "nor": "Noruego", "dan": "Danés", "fin": "Finés", "pol": "Polaco",
    "tur": "Turco", "ell": "Griego", "gre": "Griego", "heb": "Hebreo", "ces": "Checo", "cze": "Checo",
    "und": "Sin identificar", "": "Sin identificar",
}

# Pistas de audio en las que conviene fijarse: lo que suele querer oir el
# usuario de esta casa. El orden es el de preferencia.
PREFERENCIA = ("spa", "es", "esp", "cas", "lat", "spa-mx")


def nombre_idioma(code: str) -> str:
    c = (code or "").strip().lower()
    return NOMBRE_IDIOMA.get(c, c.upper() if c else "Sin identificar")


def _ffprobe(path: str) -> dict | None:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json",
             "-show_streams", "-show_format", path],
            capture_output=True, text=True, timeout=60,
        )
        if r.returncode != 0:
            logger.warning("ffprobe fallo sobre %s: %s", os.path.basename(path), r.stderr.strip()[:200])
            return None
        return json.loads(r.stdout)
    except FileNotFoundError:
        logger.warning("ffprobe no esta instalado: no se pueden leer las pistas")
        return None
    except Exception as e:
        logger.warning("ffprobe fallo sobre %s: %s", os.path.basename(path), e)
        return None


def _idioma_de(stream: dict) -> str:
    tags = stream.get("tags") or {}
    lang = (tags.get("language") or tags.get("LANGUAGE") or "").strip().lower()
    if lang and lang != "und":
        return lang
    # Muchos archivos no etiquetan el idioma pero lo escriben en el titulo.
    titulo = (tags.get("title") or tags.get("TITLE") or "").lower()
    for clave, patron in (("spa", r"españ|spanish|castellano|\bcast\b|\besp\b"),
                          ("lat", r"latino|latam"),
                          ("eng", r"ingl[eé]s|english|\beng\b|original"),
                          ("fra", r"franc[eé]s|french"),
                          ("ita", r"italiano|italian"),
                          ("por", r"portugu[eé]s|portuguese")):
        if re.search(patron, titulo):
            return clave
    return "und"


def leer_pistas(path: str) -> dict:
    """Pistas de un archivo, ya ordenadas por preferencia de idioma."""
    datos = _ffprobe(path)
    if not datos:
        return {"ok": False, "audio": [], "subtitles": [], "video": None,
                "detail": "No se ha podido leer el archivo (¿ffprobe instalado?)"}

    video = None
    audio = []
    subs = []

    for s in datos.get("streams", []):
        tipo = s.get("codec_type")
        tags = s.get("tags") or {}
        titulo = tags.get("title") or tags.get("TITLE") or ""
        disp = s.get("disposition") or {}

        if tipo == "video" and video is None:
            video = {
                "codec": s.get("codec_name", ""),
                "width": s.get("width"), "height": s.get("height"),
            }
        elif tipo == "audio":
            lang = _idioma_de(s)
            audio.append({
                "index": s.get("index"),
                "order": len(audio),          # posicion entre las de audio (0:a:N)
                "codec": s.get("codec_name", ""),
                "language": lang,
                "language_name": nombre_idioma(lang),
                "title": titulo,
                "channels": s.get("channels"),
                "layout": s.get("channel_layout", ""),
                "default": bool(disp.get("default")),
                # Dos canales sin mas puede ser estereo normal o una pista
                # "dual" con un idioma en cada canal, que al mezclarse se oyen
                # a la vez. No se puede distinguir sin escucharla.
                "dual_sospechoso": s.get("channels") == 2
                                   and bool(re.search(r"dual", titulo, re.I)),
            })
        elif tipo == "subtitle":
            codec = (s.get("codec_name") or "").lower()
            lang = _idioma_de(s)
            subs.append({
                "index": s.get("index"),
                "order": len(subs),
                "codec": codec,
                "language": lang,
                "language_name": nombre_idioma(lang),
                "title": titulo,
                "forced": bool(disp.get("forced")),
                "default": bool(disp.get("default")),
                "textual": codec in SUBS_TEXTO,
            })

    return {"ok": True, "video": video, "audio": audio, "subtitles": subs,
            "container": (datos.get("format") or {}).get("format_name", "")}


def mejor_audio(audio: list[dict]) -> int:
    """Posicion (0:a:N) de la pista que debe sonar por defecto: español si lo
    hay, y si no la que venia marcada, y si no la primera."""
    for pref in PREFERENCIA:
        for a in audio:
            if a["language"] == pref:
                return a["order"]
    for a in audio:
        if a["default"]:
            return a["order"]
    return 0
