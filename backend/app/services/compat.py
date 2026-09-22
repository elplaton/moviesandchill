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

        if video_ok and audio_ok and container_ok:
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
            # Sin subtitulos: MP4 no admite PGS/ASS y ffmpeg abortaria. Se
            # conservan todas las pistas de audio (dual).
            subprocess.run(["ffmpeg", "-i", f, "-map", "0:v:0", "-map", "0:a", "-sn", "-dn",
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
            if name.lower().endswith(VIDEO_EXTS) and not name.lower().endswith(".mp4"):
                pending.append(os.path.join(root, name))
    _conv_state.update({"running": True, "total": len(pending), "done": 0, "current": "", "started": time.time(), "converted": 0})
    logger.info("Conversion de biblioteca: %d archivos que no son MP4", len(pending))
    loop = asyncio.get_event_loop()
    try:
        for f in pending:
            _conv_state["current"] = os.path.relpath(f, base)
            out = await loop.run_in_executor(None, make_compatible, [f])
            if out and out[0] != f:
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
