"""Comprueba como se interpretan los nombres de archivo (services/title_parser.py).

Los casos son nombres reales del catalogo. Los de "Peliculas de YoSoyFran"
son los que hacian que TMDB no encontrara nada: un "ª" pegado al titulo, el
año suelto con guiones bajos ("Magallanes_2025_ªBluray..."), el año pegado a
una palabra ("2011DRAMA") o lo que va detras de "(2026)" colandose en el
titulo. Los de "Lo que ya funcionaba" estan para que el arreglo no rompa nada.

Se lanza solo, sin framework y sin base de datos:
  PYTHONPATH=backend python3 backend/tests/prueba_title_parser.py
"""
import sys

from app.services.title_parser import parse_filename

fallos = []
total = 0


def comprueba(nombre, tipo, titulo, año=None):
    global total
    total += 1
    p = parse_filename(nombre)
    obtenido = (p.media_type, p.title, p.year)
    esperado = (tipo, titulo, año)
    ok = obtenido == esperado
    print(("  ok   " if ok else "  FALLA ") + nombre)
    if not ok:
        fallos.append(nombre)
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")


print("Peliculas de YoSoyFran que no encontraba TMDB")
comprueba("La silla (2026) ª[HD 1080P] Castellano.mp4", "movie", "La silla", 2026)
comprueba("La silla (2026) ª[WEB-DL m720p][Castellano EAC3 2.0].mkv", "movie", "La silla", 2026)
comprueba("Noche fatídica (Gajab Raat) (2026) ª[HD 1080P] Castellano.mp4", "movie", "Noche fatídica", 2026)
comprueba("Noche_Fatídica_Gajab_Raat_2026_ªWeb_DL_1080p_x264_E_AC3_2_0_Castellano",
          "movie", "Noche Fatídica Gajab Raat", 2026)
comprueba("Magallanes_2025_ªBluray_Rip_X264_1080P_E_Ac3_2_0_Castellano_Portugues.",
          "movie", "Magallanes", 2025)
comprueba("La_voz_dormida_2011DRAMA_Spanish_Subs_WEB_DL_1080p_x264_EAC3_by.mkv",
          "movie", "La voz dormida", 2011)
comprueba("La_voz_dormida_2011_7_2_Benito_ZambranoInma_Cuesta,_María_León_2h3m.mk",
          "movie", "La voz dormida", 2011)
comprueba("Kraken (2026) 1080p Es-No+s-kowalski&xusman.mkv", "movie", "Kraken", 2026)
comprueba("El Experimento [2010].mp4", "movie", "El Experimento", 2010)
comprueba("Resumen SBK 2026 🏁 ArchivoGP.mp4", "movie", "Resumen SBK", 2026)

comprueba("Billy.Bathgate.1991.(Spanish.English).HDrip.XviD-AC3..avi", "movie", "Billy Bathgate", 1991)
comprueba("Bronson (2008) (vose) subs spanish+Ingl HD 1080p.mkv", "movie", "Bronson", 2008)

print("\nEpisodios de una cifra, que se tomaban por peliculas")
comprueba("La mujer maravilla 1x5.mp4", "series", "La mujer maravilla", None)
comprueba("Clarksons Farm 4x1.mkv", "series", "Clarksons Farm", None)
comprueba("Planeta helado II 2x4 Sur helado 2022.avi", "series", "Planeta helado II", 2022)

print("\nLo que ya funcionaba")
comprueba("El secuestro de mi hijo (2024).mp4", "movie", "El secuestro de mi hijo", 2024)
comprueba("The Get Out (2026).mkv", "movie", "The Get Out", 2026)
comprueba("La piel (1981).mp4", "movie", "La piel", 1981)
comprueba("El show de Truman.mp4", "movie", "El show de Truman", None)
comprueba("1917 (2019).mkv", "movie", "1917", 2019)
comprueba("Blade Runner 2049 (2017).mkv", "movie", "Blade Runner 2049", 2017)
comprueba("Blade Runner 2049.mkv", "movie", "Blade Runner 2049", None)
comprueba("Una voz silenciosa (2016).part1.rar", "movie", "Una voz silenciosa", 2016)
comprueba("Dune (2021) - 2160p BluRay.mkv", "movie", "Dune", 2021)
comprueba("Gnomos (Gnomes) [HDTV 1080p][Cap.102].mp4", "series", "Gnomos", None)
comprueba("Grande de España_S01E06_Quién es Sofía Carrington.mp4", "series", "Grande de España", None)
comprueba("Suits 3x07.mkv", "series", "Suits", None)
comprueba("Los Simpson Temporada 23.part02.rar", "series", "Los Simpson", None)
comprueba("Rurouni Kenshin - 89 [1080p].mkv", "series", "Rurouni Kenshin", None)
comprueba("Película 1920x1080 x264.mkv", "movie", "Película", None)
comprueba("S.W.A.T. 3x05.mkv", "series", "S.W.A.T", None)

print(f"\n{total - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
