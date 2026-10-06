"""Comprueba el texto y el orden de los avisos de episodios nuevos.

Sin base de datos y sin red: lo que se prueba es la parte que decide *que* se
dice, que es donde esta el riesgo de quedar mal (un aviso que pone "3x07"
cuando lo que ha llegado es el 3x08, o una lista de ocho etiquetas que el
telefono corta por la mitad).
"""
import sys

from app.services.avisos import etiqueta_episodio, ordenar_episodios, texto_aviso

fallos = []


def comprueba(que, esperado, obtenido):
    ok = esperado == obtenido
    print(("  ok    " if ok else "  FALLA ") + que)
    if not ok:
        print(f"        esperado: {esperado!r}")
        print(f"        obtenido: {obtenido!r}")
        fallos.append(que)


print("Etiquetas")
comprueba("temporada y episodio", "3x08", etiqueta_episodio(3, 8))
comprueba("episodio de tres cifras", "1x149", etiqueta_episodio(1, 149))
comprueba("sin temporada se dice el numero", "episodio 89", etiqueta_episodio(None, 89))
comprueba("temporada 0 (especiales) cuenta como sin temporada",
          "episodio 1", etiqueta_episodio(0, 1))

print()
print("Orden")
comprueba("por temporada y episodio",
          [(1, 2), (1, 10), (2, 1)],
          ordenar_episodios([(2, 1), (1, 10), (1, 2)]))
comprueba("los sueltos van primero",
          [(None, 5), (1, 1)],
          ordenar_episodios([(1, 1), (None, 5)]))

print()
print("Texto")
titulo, cuerpo = texto_aviso("Suits", [(3, 8)])
comprueba("un episodio: el titulo es la serie", "Suits", titulo)
comprueba("un episodio: el cuerpo dice cual", "Ya está disponible 3x08", cuerpo)

titulo, cuerpo = texto_aviso("Suits", [(3, 8), (3, 9)])
comprueba("dos episodios: el titulo lleva la cuenta", "Suits · 2 episodios nuevos", titulo)
comprueba("dos episodios: se nombran los dos", "Ya están 3x08, 3x09", cuerpo)

titulo, cuerpo = texto_aviso("Suits", [(3, i) for i in range(1, 9)])
comprueba("ocho episodios: el titulo lleva la cuenta", "Suits · 8 episodios nuevos", titulo)
comprueba("ocho episodios: se nombran tres y se resume el resto",
          "Ya están 3x01, 3x02, 3x03 y 5 más", cuerpo)

titulo, _ = texto_aviso("", [(1, 1)])
comprueba("sin titulo no se manda un aviso en blanco", "Serie", titulo)

print()
print(f"{13 - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
