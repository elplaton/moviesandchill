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


# Croma que los dispositivos de Apple decodifican por hardware. Todo lo que
# no sea 4:2:0 se queda fuera, y los 10 bits solo valen en HEVC.
CROMA_8 = ("yuv420p", "yuvj420p")
CROMA_10 = ("yuv420p10le", "yuv420p10be")


def video_apto_apple(video: dict | None) -> tuple[bool, str]:
    """Si un iPhone, un iPad o un Apple TV pueden reproducir este video.

    Importa para AirPlay: cuando el receptor no sabe decodificar la imagen
    reproduce **solo el audio**, sin avisar de nada. El caso tipico es un
    H.264 de 10 bits, que Apple no admite de ninguna manera (los 10 bits solo
    los lleva en HEVC) y que es frecuente en los releases en español.

    No basta con mirar el nombre del codec: un H.264 de 8 y otro de 10 bits
    se llaman igual, y lo que los distingue es `pix_fmt`.
    """
    if not video:
        return True, ""          # sin datos no se supone lo peor
    codec = (video.get("codec") or "").lower()
    pix = (video.get("pix_fmt") or "").lower()
    bits = video.get("bits") or (10 if "10" in pix else 8)

    if codec in ("h264", "avc1", "avc"):
        if bits and bits > 8:
            return False, f"H.264 de {bits} bits (Apple solo admite 8)"
        if pix and pix not in CROMA_8:
            return False, f"croma {pix} (Apple necesita 4:2:0)"
        return True, ""

    if codec in ("hevc", "h265", "hvc1"):
        if pix and pix not in CROMA_8 + CROMA_10:
            return False, f"croma {pix} (Apple necesita 4:2:0)"
        return True, ""

    return False, f"codec {codec or 'desconocido'}"


# Lo que decodifica el navegador de la PlayStation 4: MP4 con H.264 (perfiles
# Baseline, Main y High) de 8 bits en 4:2:0, hasta 1920x1080 y 20 Mbps, con
# audio AAC. No lleva HEVC, ni VP9, ni AV1, ni 10 bits.
PS4_MAX_W = 1920
PS4_MAX_H = 1080


def video_apto_ps4(video: dict | None) -> tuple[bool, str]:
    """Si el navegador de la PS4 puede reproducir este video.

    Mismo cuidado que con AirPlay y por el mismo motivo: cuando el cliente no
    sabe decodificar la imagen, reproduce **solo el audio** y no avisa de
    nada. Aqui ademas se descarta el HEVC entero, que en la biblioteca es
    frecuente porque `make_compatible()` lo deja pasar tal cual (a un iPhone
    le vale, a la consola no).
    """
    if not video:
        return True, ""          # sin datos no se supone lo peor
    codec = (video.get("codec") or "").lower()
    pix = (video.get("pix_fmt") or "").lower()
    bits = video.get("bits") or (10 if "10" in pix else 8)

    if codec not in ("h264", "avc1", "avc"):
        return False, f"{codec.upper() or 'codec desconocido'} (la consola solo lee H.264)"
    if bits and bits > 8:
        return False, f"H.264 de {bits} bits (la consola solo admite 8)"
    if pix and pix not in CROMA_8:
        return False, f"croma {pix} (la consola necesita 4:2:0)"
    w, h = video.get("width") or 0, video.get("height") or 0
    if w > PS4_MAX_W or h > PS4_MAX_H:
        return False, f"{w}x{h} (la consola llega a 1920x1080)"
    # El nivel de H.264 se queda fuera a proposito: los codificadores declaran
    # niveles altos de sobra (un 720p con nivel 5.1 es corriente y se
    # reproduce bien), y un aviso que se equivoca es un aviso que se ignora.
    # Lo que de verdad separa lo que se ve de lo que no es el codec, los bits
    # y el croma. El limite de 20 Mbps tampoco se mira: no se sabe sin leer el
    # bitrate real, y pasarse se nota como tirones, no como pantalla negra.
    return True, ""


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
            bits = s.get("bits_per_raw_sample")
            video = {
                "codec": s.get("codec_name", ""),
                "profile": s.get("profile", ""),
                "pix_fmt": s.get("pix_fmt", ""),
                "bits": int(bits) if str(bits or "").isdigit() else None,
                "level": s.get("level"),
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

    apto, motivo = video_apto_apple(video)
    if video is not None:
        video["apple"] = apto
        video["apple_motivo"] = motivo
        apto4, motivo4 = video_apto_ps4(video)
        video["ps4"] = apto4
        video["ps4_motivo"] = motivo4

    fmt = datos.get("format") or {}
    return {"ok": True, "video": video, "audio": audio, "subtitles": subs,
            "container": fmt.get("format_name", ""),
            **_peso(fmt)}


def _peso(fmt: dict) -> dict:
    """Duracion, tamaño y bitrate del archivo.

    El bitrate es el numero que decide si un archivo se puede ver mientras se
    descarga: si son 60 Mbps y la red da 30, va a tirones por mucho que el
    servidor y el reproductor esten bien, y no hay ajuste que lo arregle (un
    `<video>` baja el archivo tal cual, no hay calidades que elegir). Hasta
    ahora no se leia, asi que ante un tiron no habia con que comparar.

    ffprobe no siempre trae `bit_rate` en el `format` (en MKV falta a menudo),
    asi que si no esta se saca del tamaño y la duracion, que es lo mismo
    promediado.
    """
    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    duracion, tamano = _num(fmt.get("duration")), _num(fmt.get("size"))
    bitrate = _num(fmt.get("bit_rate"))
    if not bitrate and duracion and tamano and duracion > 0:
        bitrate = tamano * 8 / duracion
    return {"duration": duracion, "size": int(tamano) if tamano else None,
            "bitrate": int(bitrate) if bitrate else None}


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
