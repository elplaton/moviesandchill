"""Comprueba como se saca titulo y año del texto de los mensajes
(services/contexto.py): la foto de ficha que va encima de los archivos y el pie
de cada archivo. Los textos son reales, del tema "Peliculas" de YoSoyFran.

Tambien que la ficha se le pega al archivo que toca: la de su tema, la ultima
antes de el y sin una pegatina (que cierra el bloque) en medio.

Se lanza solo, sin framework, sin base de datos y sin Telegram:
  PYTHONPATH=backend python3 backend/tests/prueba_contexto.py
"""
import datetime
import sys
import types

from app.services.contexto import Seguidor, concuerda, pistas_de

fallos = []
total = 0


def comprueba(que, esperado, obtenido):
    global total
    total += 1
    ok = esperado == obtenido
    print(("  ok   " if ok else "  FALLA ") + que)
    if not ok:
        fallos.append(que)
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")


def p(texto):
    x = pistas_de(texto)
    return (x.titulo, x.año, x.original) if x else None


print("Fichas (la foto de encima)")
comprueba("titulo y año entre parentesis",
          ("LA SILLA", 2026, None),
          p("LA SILLA (2026)\n📅 Estreno: 2026-05-29\n⭐️ Puntuación: 8/10\n🎬 Película\n🎭 Géneros: Suspense, Terror"))
comprueba("con sinopsis en la misma linea",
          ("El Show de Truman", 1998, None),
          p("El Show de Truman (1998) Truman Burbank es un hombre corriente y algo ingenuo que ha vivido"))
comprueba("titulo original detras de ❕",
          ("Drácula, una historia de amor", None, "Dracula: A Love Tale"),
          p("Drácula, una historia de amor❕Dracula: A Love Tale\n➖➖➖➖➖➖➖➖➖"))
comprueba("año detras de un guion",
          ("LA MOMIA 1", 1999, None),
          p("LA MOMIA 1 - 1999 🇪🇸Castellano 💬Castellano"))

print("\nPies (el texto del archivo)")
comprueba("titulo · original (año)",
          ("El Experimento", 2010, "The Experiment"),
          p("El Experimento | The Experiment (2010) Thriller. Drama | Remake. Drama carcelario."))
comprueba("el formato con emojis y el año con punto",
          ("EL SECUESTRO DE MI HIJO", 2024, None),
          p("🎬 EL SECUESTRO DE MI HIJO 💎 THRILLER SUSPENSE 🍿 2.024 10 ⭐️ 🎵AUDIO CASTELLANO 🇪🇸"))
comprueba("titulo con año y bandera",
          ("La Constelación del Perro", 2026, None),
          p("La Constelación del Perro (2026)🇪🇸"))
comprueba("titulo en mayusculas con pais e idioma",
          ("JOHN Q", 2002, None),
          p("JOHN Q (2002) 🇺🇸 (🇪🇸 Castellano) Género: Drama John Q. Archibald ("))
comprueba("solo el titulo, sin año", ("El show de Truman", None, None), p("El show de Truman"))
comprueba("un texto que no dice nada", None, p("🎵AUDIO CASTELLANO 🇪🇸"))
comprueba("vacio", None, p(""))

print("\nOtros canales")
comprueba("K9: ficha con campos",
          ("King Kong", 1933, None),
          p("Nombre: King Kong\n\nAño: 1933\n\nDirector 🎬: Merian C. Cooper, Ernest B. Schoedsack"))
comprueba("K9: el original entre parentesis",
          ("Zombi", 1978, "Dawn of the Dead"),
          p("Nombre: Zombi (Dawn of the Dead)\n\nAño: 1978\n\nDirector 🎬: George A. Romero"))
comprueba("Las Cositas: la calidad entre parentesis no es titulo",
          ("Buddy", None, None), p("Buddy (1080p)\n\nSINOPSIS:\n\nUn grupo de niños se ve atrapado"))
comprueba("Las Cositas: tampoco 4K SDR", ("Buddy", None, None), p("Buddy (4K SDR)\n\nSINOPSIS:\n\nUn grupo"))
comprueba("Las Cositas: año y calidad",
          ("Scary Movie", 2026, None), p("Scary Movie (2026) (4K HDR)\n\nSINOPSIS:\n\nSexta entrega"))
comprueba("Las Cositas: la temporada no es el titulo original",
          ("Cyberpunk: Edgerunners", None, None), p("Cyberpunk: Edgerunners - Temporada 2 (1080p)\n\nSINOPSIS:"))
comprueba("Las Cositas Ballin: lo de detras del titulo",
          ("VECINOS INVASORES", None, None), p("VECINOS INVASORES Audios en Castellano, Catalán y VO (Inglés)"))
comprueba("Las Cositas Ballin: el formato tampoco",
          ("Gen V", None, "Spin off de The Boys"), p("Gen V (Spin off de The Boys) mkv y zip"))

comprueba("K9: un titulo que empieza por un genero sigue siendo titulo",
          ("Historia de una hierba errante", 1934, None),
          p("Nombre: Historia de una hierba errante\n\nAño: 1934\n\nDirector 🎬: Yasujirō Ozu"))
comprueba("K9: un titulo que es un numero", ("2046", 2004, None), p("Nombre: 2046\n\nAño: 2004\n\nDirector 🎬: Wong Kar-wai"))
comprueba("y uno que parece un año", ("1917", 2019, None), p("Nombre: 1917\n\nAño: 2019"))
comprueba("y otro", ("Crimen perfecto", 1954, None), p("Nombre: Crimen perfecto\n\nAño: 1954"))

print("\nQue la ficha sea del archivo")
comprueba("mismo titulo", True, concuerda(pistas_de("LA SILLA (2026)"), "La silla (2026) ª[HD 1080P].mp4"))
comprueba("uno empieza como el otro", True, concuerda(pistas_de("Gen V (Spin off de The Boys)"), "Generación V 1x01.zip.001"))
comprueba("por el original", True, concuerda(pistas_de("Zombi (Dawn of the Dead)"), "Dawn.of.the.Dead.1978.mkv"))
comprueba("casi la misma palabra (Jezabel, Jezebel)", True, concuerda(pistas_de("Nombre: Jezabel"), "[1938] Jezebel [DuaL].7z.001"))
comprueba("y de un idioma a otro (Sicily, Sicilia)", True, concuerda(pistas_de("Nombre: Sicily"), "[1997] Sicilia.7z.001"))
comprueba("los extras de K9 tambien", True, concuerda(pistas_de("Nombre: Rebeca, una mujer inolvidable"), "Extra - Rebecca.7z.001"))
comprueba("las siglas (HDA)", True, concuerda(pistas_de("Hora de Aventuras - Temporada 1 (1080p)"), "HDA 1x05.mkv"))
comprueba("las siglas con minusculas (LMdMM)", True, concuerda(pistas_de("La Maldición de Molly McGee"), "LMdMM 2x01.mkv"))
comprueba("una serie de al lado no (Breaking Bad, Better Call Saul)", False,
          concuerda(pistas_de("Breaking Bad - Temporada 3 (1080p)"), "Better Call Saul 3x07 - Gastos.zip.001"))
comprueba("otra pelicula no", False, concuerda(pistas_de("VECINOS INVASORES"), "The Iron Claw (2023).mkv"))
comprueba("un archivo sin nombre si", True, concuerda(pistas_de("Kraken (2026)"), "video_2026-10-01_12-00.mp4"))

print("\nEnlaces")
x = pistas_de("Kraken (2026)\nhttps://www.themoviedb.org/movie/1234567-kraken")
comprueba("un enlace a TMDB da el id", (1234567, "movie"), (x.tmdb_id, x.tmdb_tipo) if x else None)
x = pistas_de("Lost (2004) https://www.themoviedb.org/tv/4607?language=es")
comprueba("y el tipo", (4607, "tv"), (x.tmdb_id, x.tmdb_tipo) if x else None)
x = pistas_de("Algo (2001) https://www.imdb.com/title/tt0133093/")
comprueba("un enlace a IMDb da su id", "tt0133093", x.imdb_id if x else None)
x = pistas_de("La silla (2026)\nhttps://image.tmdb.org/t/p/w500/abc123.jpg")
comprueba("la caratula de TMDB", "https://image.tmdb.org/t/p/w500/abc123.jpg", x.poster if x else None)


# --- El seguidor -------------------------------------------------------------

t0 = datetime.datetime(2026, 10, 27, 12, 0, 0)


def msg(mid, minutos, tema=4, texto="", foto=False, archivo=None, sticker=False):
    """Un mensaje de Telethon de mentira, con lo que mira el seguidor."""
    reply = types.SimpleNamespace(reply_to_top_id=None, reply_to_msg_id=tema, forum_topic=True) if tema else None
    return types.SimpleNamespace(id=mid, date=t0 + datetime.timedelta(minutes=minutos), message=texto,
                                 entities=[], reply_to=reply, _foto=foto, _archivo=archivo, _sticker=sticker)


es = {
    "foto": lambda m: m._foto,
    "sticker": lambda m: m._sticker,
    "archivo": lambda m: m._archivo is not None,
}
seg = Seguidor(es_foto=es["foto"], es_sticker=es["sticker"], es_archivo=es["archivo"])

print("\nEl seguidor de fichas")
seg.ver(msg(100, 0, texto="LA SILLA (2026)\n📅 Estreno: 2026-05-29", foto=True))
c = seg.ver(msg(101, 1, texto="🎬 LA SILLA 💎 TERROR", archivo="La silla (2026).mp4"))
comprueba("el archivo de debajo se lleva la ficha", "LA SILLA (2026)", (c.ficha or "").splitlines()[0])
comprueba("y su tema", 4, c.tema)
comprueba("y su pie", "🎬 LA SILLA 💎 TERROR", c.pie)
seg.ver(msg(102, 2, tema=65, texto="F1 Carrera (2026)", foto=True))
c = seg.ver(msg(103, 2, texto="", archivo="La silla (2026) 720p.mkv"))
comprueba("una ficha de otro tema no la pisa", "LA SILLA (2026)", (c.ficha or "").splitlines()[0])
seg.ver(msg(104, 3, sticker=True))
c = seg.ver(msg(105, 4, archivo="Suelta.mp4"))
comprueba("tras la pegatina, el bloque se cierra", None, c.ficha)
seg.ver(msg(106, 5, texto="El Show de Truman (1998) Truman Burbank...", foto=True))
c = seg.ver(msg(200, 125, archivo="El show de Truman.mp4"))
comprueba("una ficha de hace dos horas ya no vale", None, c.ficha)
seg.ver(msg(201, 126, texto="FRESH (1994) Fresh es un niño", foto=True))
c = seg.ver(msg(202, 127, tema=None, archivo="Otro.mp4"))
comprueba("sin tema es el tema General, que es otro", None, c.ficha)
comprueba("y se apunta como el 1", 1, c.tema)
seg.ver(msg(203, 128, foto=True))
c = seg.ver(msg(204, 128, archivo="Fresh (1994).mp4"))
comprueba("una foto sin texto no es ficha, pero no cierra el bloque", "FRESH (1994) Fresh es un niño", c.ficha)
c = seg.ver(msg(205, 128, texto="hola"))
comprueba("lo que no es archivo no devuelve contexto", None, c)

con_nombre = Seguidor(es_foto=es["foto"], es_sticker=es["sticker"], es_archivo=es["archivo"],
                      nombre_de=lambda m: m._archivo)
con_nombre.ver(msg(300, 0, tema=2503, texto="VECINOS INVASORES Audios en Castellano", foto=True))
c = con_nombre.ver(msg(301, 1, tema=2503, archivo="Vecinos Invasores.7z.001"))
comprueba("con el nombre, la ficha que concuerda se pega", "VECINOS INVASORES", c.pistas.titulo if c.pistas else None)
c = con_nombre.ver(msg(302, 2, tema=2503, archivo="The Iron Claw (2023).mkv"))
comprueba("y la de otra pelicula no", None, c.ficha)

print(f"\n{total - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
