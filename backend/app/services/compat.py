"""Compatibilidad de video: todo acaba en MP4 con H.264/HEVC y AAC.

MP4 es el unico contenedor que reproducen a la vez iPhone (Safari no abre
MKV), Android, Samsung Tizen y LG webOS. Si el video ya es H.264/HEVC y el
audio AAC solo se reempaqueta (segundos); si no, se transcodifica.
"""
import asyncio
import logging
import os
import re
import subprocess
import time

from app.services.subs import extraer_subtitulos
from app.services.tracks import leer_pistas, mejor_audio

logger = logging.getLogger("tmd")

VIDEO_EXTS = ('.mkv', '.mp4', '.avi', '.ts', '.m4v', '.mov', '.wmv', '.flv', '.webm')
COMPAT_VIDEO = ('avc', 'h264', 'x264', 'hevc', 'h265', 'x265')
COMPAT_AUDIO = ('aac', 'mp4a')
COMPAT_CONTAINER = ('mpeg4', 'mpeg-4')


def _info(path, fmt):
    try:
        r = subprocess.run(["mediainfo", f"--Inform={fmt}", path], capture_output=True, text=True, timeout=10)
        return re.sub(r'[^a-z0-9]', '', r.stdout.strip().lower())
    except FileNotFoundError:
        logger.warning("mediainfo no esta instalado: no se puede comprobar la compatibilidad")
        return ""
    except Exception as e:
        logger.warning("mediainfo fallo sobre %s: %s", os.path.basename(path), e)
        return ""


def _mapeo_audio(pistas: dict) -> list[str]:
    """Mapea el video y todas las pistas de audio, con la preferida la
    primera y marcada como unica activa.

    Antes se hacia `-map 0:a` a secas: todas las pistas entraban y todas
    quedaban activas, de modo que Safari y QuickTime las reproducian a la vez
    y se oia la pelicula en español y en ingles encima. Ahora el idioma que
    manda es el español si esta, y el resto viaja dentro del archivo pero
    apagado, para quien sepa cambiarlo.
    """
    audio = pistas.get("audio") or []
    args = ["-map", "0:v:0"]
    if not audio:
        return args

    pref = mejor_audio(audio)
    orden = [pref] + [a["order"] for a in audio if a["order"] != pref]
    for n in orden:
        args += ["-map", f"0:a:{n}"]

    for destino, origen in enumerate(orden):
        lang = audio[origen]["language"]
        titulo = audio[origen]["title"]
        args += ["-disposition:a:" + str(destino), "default" if destino == 0 else "0"]
        if lang and lang != "und":
            args += [f"-metadata:s:a:{destino}", f"language={lang}"]
        if titulo:
            args += [f"-metadata:s:a:{destino}", f"title={titulo}"]
    return args


def _sacar_subtitulos(path: str, pistas: dict) -> None:
    try:
        extraer_subtitulos(path, pistas.get("subtitles") or [])
    except Exception as e:
        logger.warning("Extraccion de subtitulos fallida en %s: %s", os.path.basename(path), e)


def _arreglar_pistas_mp4(f: str, pistas: dict, converted: list, on_progress=None) -> None:
    """Remux copiando de un MP4 que ya era compatible, solo para dejar una
    unica pista de audio activa (y de paso sacar sus subtitulos)."""
    audio = pistas.get("audio") or []
    activas = [a for a in audio if a["default"]]
    pref = mejor_audio(audio)
    # Si ya hay exactamente una activa y es la que toca, no hay nada que hacer.
    if len(activas) == 1 and activas[0]["order"] == pref:
        _sacar_subtitulos(f, pistas)
        converted.append(f)
        return

    logger.info("Reordenando pistas de audio en %s (%d pistas, %d activas)",
                os.path.basename(f), len(audio), len(activas))
    if on_progress:
        on_progress(f)
    _sacar_subtitulos(f, pistas)

    tmp = os.path.splitext(f)[0] + "_tracks.mp4"
    try:
        subprocess.run(["ffmpeg", "-i", f, *_mapeo_audio(pistas), "-sn", "-dn",
                        "-c", "copy", "-movflags", "+faststart", tmp, "-y", "-loglevel", "error"],
                       check=True)
        os.replace(tmp, f)
    except Exception as e:
        logger.error("No se pudieron reordenar las pistas de %s: %s", f, e)
        if os.path.isfile(tmp):
            os.remove(tmp)
    converted.append(f)


def make_compatible(file_list, on_progress=None):
    """Convierte (o reempaqueta) cada video a MP4. Devuelve las rutas finales."""
    converted = []
    for f in file_list:
        if not f.lower().endswith(VIDEO_EXTS):
            converted.append(f)
            continue

        vnorm = _info(f, "Video;%Format%")
        anorm = _info(f, "Audio;%Format%")
        cnorm = _info(f, "General;%Format%")

        video_ok = (not vnorm) or any(c in vnorm for c in COMPAT_VIDEO)
        audio_ok = (not anorm) or any(c in anorm for c in COMPAT_AUDIO)
        container_ok = (not cnorm) or any(c in cnorm for c in COMPAT_CONTAINER)

        pistas = leer_pistas(f)

        # Un MP4 ya compatible se dejaba tal cual, pero si trae varias pistas
        # de audio puede venir con todas marcadas como activas: hay
        # reproductores (Safari, QuickTime) que entonces las suenan a la vez.
        # Un remux copiando es cuestion de segundos y lo deja en su sitio.
        if video_ok and audio_ok and container_ok:
            # El remux solo vale si el archivo es de verdad un MP4. Sin
            # mediainfo instalado `_info()` devuelve "" y todo pasa por
            # compatible, asi que no basta con fiarse de esa comprobacion.
            if f.lower().endswith(".mp4") and len(pistas.get("audio", [])) > 1:
                _arreglar_pistas_mp4(f, pistas, converted, on_progress)
            else:
                _sacar_subtitulos(f, pistas)
                converted.append(f)
            continue

        v_args = ["-c:v", "copy"] if video_ok else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
        # HEVC en MP4 necesita la etiqueta hvc1 para que Safari lo reconozca.
        if video_ok and any(t in vnorm for t in ("hevc", "h265", "x265")):
            v_args += ["-tag:v", "hvc1"]
        a_args = ["-c:a", "copy"] if audio_ok else ["-c:a", "aac", "-b:a", "256k", "-ac", "2"]

        reason = []
        if not video_ok: reason.append(f"video={vnorm or '?'}")
        if not audio_ok: reason.append(f"audio={anorm or '?'}")
        if not container_ok: reason.append(f"container={cnorm or '?'}")
        logger.info("Conversion a MP4: %s | %s", os.path.basename(f), ", ".join(reason))
        if on_progress:
            on_progress(f)

        new_name = os.path.splitext(f)[0] + ".mp4"
        tmp = os.path.splitext(f)[0] + "_tv.mp4"
        try:
            # Los subtitulos se sacan del original a .vtt sueltos: MP4 no
            # admite PGS ni ASS y antes se perdian sin mas. Va antes de
            # convertir porque es el original el que los lleva.
            _sacar_subtitulos(f, pistas)

            subprocess.run(["ffmpeg", "-i", f, *_mapeo_audio(pistas), "-sn", "-dn",
                            *v_args, *a_args, "-movflags", "+faststart", tmp, "-y", "-loglevel", "error"], check=True)
            if new_name != f and os.path.isfile(f):
                os.remove(f)
            os.replace(tmp, new_name)
            converted.append(new_name)
        except Exception as e:
            logger.error("Conversion a MP4 fallida para %s: %s", f, e)
            if os.path.isfile(tmp):
                os.remove(tmp)
            converted.append(f)

    return converted


_conv_state = {"running": False, "total": 0, "done": 0, "current": "", "started": 0, "converted": 0}


def library_conversion_status():
    return dict(_conv_state)


async def convert_library_job(extract_path: str):
    """Recorre toda la biblioteca y convierte lo que no sea MP4 compatible,
    de uno en uno y en un hilo aparte para no bloquear el servidor."""
    from app.database.downloads import owners_by_path, set_download_status, dir_size

    base = os.path.realpath(extract_path)
    pending = []
    for root, _dirs, files in os.walk(base):
        for name in files:
            if not name.lower().endswith(VIDEO_EXTS):
                continue
            # Los MP4 tambien entran. Antes se saltaban por ser ya compatibles,
            # pero un MP4 puede traer varias pistas de audio activas a la vez
            # (es lo que pasaba con los que convirtio la version anterior) y
            # entonces se oyen todos los idiomas encima. make_compatible mira
            # las pistas y solo toca lo que haga falta.
            pending.append(os.path.join(root, name))
    _conv_state.update({"running": True, "total": len(pending), "done": 0, "current": "", "started": time.time(), "converted": 0})
    logger.info("Revision de biblioteca: %d videos", len(pending))
    loop = asyncio.get_event_loop()
    try:
        for f in pending:
            _conv_state["current"] = os.path.relpath(f, base)
            antes = os.path.getmtime(f) if os.path.exists(f) else 0
            out = await loop.run_in_executor(None, make_compatible, [f])
            # Un remux deja el mismo nombre, asi que mirar solo el nombre no
            # vale para saber si se ha tocado algo.
            if out and (out[0] != f or (os.path.exists(out[0]) and os.path.getmtime(out[0]) != antes)):
                _conv_state["converted"] += 1
            _conv_state["done"] += 1
        # Los tamaños en disco cambian al reempaquetar: se actualizan las cuotas.
        for path, row in (await owners_by_path()).items():
            if os.path.exists(path):
                await set_download_status(path, row["status"], dir_size(path))
    finally:
        _conv_state["running"] = False
        _conv_state["current"] = ""
    logger.info("Conversion de biblioteca terminada: %d/%d convertidos (%.0fs)",
                _conv_state["converted"], _conv_state["total"], time.time() - _conv_state["started"])
