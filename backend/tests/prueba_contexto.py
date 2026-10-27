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

from app.services.contexto import Seguidor, pistas_de

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

print(f"\n{total - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
