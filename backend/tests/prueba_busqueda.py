"""Comprueba cómo compara el buscador lo escrito con los títulos
(services/busqueda.py).

Existe por tres quejas concretas: «MAY DAY» no encontraba «Mayday», «x men» no
encontraba «X-Men» si no se escribía con el guion, y buscando una película
salían otras que no tenían nada que ver. Lo del SQL no se puede probar sin
base de datos, pero sí que `normalizar()` dé lo mismo que la expresión de las
columnas calculadas, que es lo que hace que las dos mitades coincidan.

    PYTHONPATH=backend python3 backend/tests/prueba_busqueda.py
"""
import re
import sys

from app.services.busqueda import (_CON_TILDE, _SIN_TILDE, coincide, consulta, expr_sql,
                                   normalizar)

fallos = 0


def ver(cond: bool, que: str):
    global fallos
    print(("  ok   " if cond else "  MAL  ") + que)
    if not cond:
        fallos += 1


def como_sql(texto: str, pegado: bool) -> str:
    """Lo que calcula `expr_sql()` en PostgreSQL, paso a paso: translate,
    lower, regexp_replace (y btrim con espacios a los lados)."""
    t = (texto or "").translate(str.maketrans(_CON_TILDE, _SIN_TILDE)).lower()
    if pegado:
        return re.sub(r"[^a-z0-9]+", "", t)
    return " " + re.sub(r"[^a-z0-9]+", " ", t).strip() + " "


print("Normalizar")
ver(normalizar("X-Men: Días del futuro pasado") == "x men dias del futuro pasado", "X-Men: Días del futuro pasado")
ver(normalizar("CÓMO CONOCÍ A VUESTRA MADRE") == "como conoci a vuestra madre", "mayúsculas con tilde")
ver(normalizar("  Spider-Man: Cruzando el Multiverso!! ") == "spider man cruzando el multiverso", "signos y espacios")
ver(consulta("MAY DAY") == ("mayday", ["may", "day"]), "consulta: pegado y por palabras")
ver(consulta("¿?!") == ("", []), "solo signos: nada que buscar")

print("Igual que la columna calculada")
for t in ["X-Men '97", "Mayday", "El Señor de los Anillos", "Amélie", "Ñu ÑAÑA", "Fast & Furious 7",
          "Pokémon: Mewtwo contraataca", "  ", None]:
    ver(como_sql(t, False).strip() == normalizar(t), f"separado: {t!r}")
    ver(como_sql(t, True) == normalizar(t).replace(" ", ""), f"pegado: {t!r}")
ver("GENERATED" not in expr_sql("title", True) and "translate(" in expr_sql("title", True),
    "expr_sql da una expresión, no la columna")

print("Lo que se quejó")
ver(coincide("Mayday", "MAY DAY"), "«MAY DAY» encuentra «Mayday»")
ver(coincide("Mayday", "mayday"), "«mayday» encuentra «Mayday»")
ver(coincide("X-Men: Primera generación", "x men"), "«x men» encuentra «X-Men: Primera generación»")
ver(coincide("X-Men '97", "xmen"), "«xmen» encuentra «X-Men '97»")
ver(coincide("X-Men: Días del futuro pasado", "dias del futuro pasado"),
    "el subtítulo solo encuentra la película")
ver(coincide("X-Men: Días del futuro pasado", "futuro pasado x-men"), "palabras en otro orden")
ver(coincide("Cómo conocí a vuestra madre", "como conoci"), "sin tildes")
ver(coincide("El señor de los anillos: La comunidad del anillo", "señor anillos"), "palabras sueltas")
ver(coincide("Spider-Man: Cruzando el Multiverso", "spiderman"), "«spiderman» encuentra «Spider-Man»")
ver(coincide("X-Men.Primera.Generacion.2011.1080p", "x men primera"), "nombre de archivo con puntos")

print("Lo que no tiene que salir")
ver(not coincide("Mayo del 68", "MAY DAY"), "«MAY DAY» no trae «Mayo del 68»")
ver(not coincide("Daylight", "MAY DAY"), "«MAY DAY» no trae «Daylight»")
ver(not coincide("Los Simpson", "x men"), "«x men» no trae otra cosa")
ver(not coincide("Superman", "up"), "«up» no busca dentro de las palabras")
ver(coincide("Up", "up"), "pero «up» sí encuentra «Up»")
ver(coincide("Operación Mayday", "mayday"), "«mayday» sí dentro de un título (4 letras o más)")
ver(not coincide("Amen", "x men"), "cada palabra tiene que empezar una del título")

print()
print(f"{fallos} fallidas" if fallos else "todo bien")
sys.exit(1 if fallos else 0)
