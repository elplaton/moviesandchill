"""Subtitulos: se sacan del video a ficheros .vtt al lado.

MP4 no admite PGS ni ASS, asi que la conversion los tiraba y se perdian. En
vez de meterlos dentro, los de texto se extraen a WebVTT sueltos: es lo unico
que los tres reproductores saben cargar de verdad (`<track>` del navegador),
mientras que las pistas de subtitulos dentro del MP4 las ignora Chrome.
"""
import logging
import os
import re
import subprocess

logger = logging.getLogger("tmd")

SUFIJO = ".vtt"


def _nombre_vtt(video_path: str, lang: str, forced: bool, usados: set[str]) -> str:
    base = os.path.splitext(video_path)[0]
    etiqueta = lang or "und"
    if forced:
        etiqueta += ".forced"
    destino = f"{base}.{etiqueta}{SUFIJO}"
    # Dos pistas del mismo idioma (normal y para sordos, por ejemplo).
    n = 2
    while destino in usados or os.path.exists(destino):
        destino = f"{base}.{etiqueta}.{n}{SUFIJO}"
        n += 1
    usados.add(destino)
    return destino


def extraer_subtitulos(video_path: str, subtitulos: list[dict]) -> list[str]:
    """Saca a .vtt las pistas de texto. Devuelve las rutas creadas.

    Se hace en una sola pasada de ffmpeg: abrir un remux de varios GB una vez
    por subtitulo seria absurdo cuando se pueden escribir todos a la vez.
    """
    textuales = [s for s in subtitulos if s.get("textual")]
    if not textuales:
        return []

    usados: set[str] = set()
    salidas = []
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", video_path]
    for s in textuales:
        destino = _nombre_vtt(video_path, s.get("language") or "und", s.get("forced"), usados)
        cmd += ["-map", f"0:s:{s['order']}", "-c:s", "webvtt", destino]
        salidas.append(destino)

    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=1800)
    except subprocess.CalledProcessError as e:
        logger.warning("No se pudieron extraer los subtitulos de %s: %s",
                       os.path.basename(video_path), (e.stderr or b"").decode(errors="replace")[:200])
        for s in salidas:
            if os.path.isfile(s) and os.path.getsize(s) == 0:
                os.remove(s)
        return [s for s in salidas if os.path.isfile(s)]
    except Exception as e:
        logger.warning("No se pudieron extraer los subtitulos de %s: %s", os.path.basename(video_path), e)
        return []

    creados = []
    for s in salidas:
        # Una pista vacia (o que ffmpeg no supo convertir) deja un .vtt con
        # solo la cabecera: no merece salir en el selector.
        if os.path.isfile(s) and os.path.getsize(s) > 32:
            creados.append(s)
        elif os.path.isfile(s):
            os.remove(s)
    if creados:
        logger.info("Subtitulos extraidos de %s: %d", os.path.basename(video_path), len(creados))
    return creados


def subtitulos_externos(video_abs: str, video_rel: str) -> list[dict]:
    """Los .vtt que haya junto al video, con el idioma sacado del nombre."""
    from app.services.tracks import nombre_idioma

    carpeta = os.path.dirname(video_abs)
    base = os.path.basename(os.path.splitext(video_abs)[0])
    rel_dir = os.path.dirname(video_rel)

    encontrados = []
    try:
        nombres = sorted(os.listdir(carpeta))
    except OSError:
        return []

    for nombre in nombres:
        if not nombre.lower().endswith(SUFIJO) or not nombre.startswith(base + "."):
            continue
        resto = nombre[len(base) + 1:-len(SUFIJO)]
        partes = [p for p in resto.split(".") if p]
        forced = "forced" in partes
        lang = next((p for p in partes if p not in ("forced",) and not p.isdigit()), "und")
        etiqueta = nombre_idioma(lang) + (" (forzados)" if forced else "")
        encontrados.append({
            "path": os.path.join(rel_dir, nombre) if rel_dir else nombre,
            "language": lang,
            "label": etiqueta,
            "forced": forced,
        })
    return encontrados


def limpiar_subtitulos(video_path: str) -> None:
    """Borra los .vtt de un video que se va. Se llama al borrar la descarga."""
    base = os.path.basename(os.path.splitext(video_path)[0])
    carpeta = os.path.dirname(video_path)
    try:
        for nombre in os.listdir(carpeta):
            if nombre.startswith(base + ".") and nombre.lower().endswith(SUFIJO):
                os.remove(os.path.join(carpeta, nombre))
    except OSError as e:
        logger.warning("No se pudieron borrar los subtitulos de %s: %s", base, e)


def es_vtt(path: str) -> bool:
    return path.lower().endswith(SUFIJO)


_LINEA_TIEMPO = re.compile(r"^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->")


def parece_vtt(path: str) -> bool:
    """Comprueba que el fichero es WebVTT de verdad antes de servirlo."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.readline().lstrip("﻿").strip().startswith("WEBVTT")
    except OSError:
        return False
