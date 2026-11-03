"""Cómo se compara lo que se escribe en el buscador con los títulos.

Antes era `ILIKE '%texto%'` contra el título tal cual, y eso fallaba con lo más
normal: «MAY DAY» no encontraba «Mayday», «x men» no encontraba «X-Men» y «como
conoci» no encontraba «Cómo conocí», porque un espacio, un guion o una tilde de
más ya no coincidían. Ahora los dos lados se **normalizan** igual: minúsculas,
sin tildes y sin signos, con las palabras separadas por un espacio
(`' x men dias del futuro pasado '`) o pegadas (`'xmendiasdelfuturopasado'`).

Los títulos se normalizan una vez, en columnas calculadas por PostgreSQL
(`busca`/`busca_c` en `media_items` y `tmdb_cache`, y `busca_original`/
`busca_original_c` en `tmdb_cache`); lo que se escribe, aquí. Las dos cosas
tienen que dar lo mismo, por eso la tabla de tildes es una sola
(`_CON_TILDE`/`_SIN_TILDE`) y la usan `expr_sql()` y `normalizar()`.

Un título coincide, de más a menos parecido (`puntos_sql()`):
  0. igual que lo buscado, sin contar espacios ni signos;
  1. empieza por lo buscado («x men» → «X-Men: Primera generación»);
  2. tiene todas las palabras buscadas al principio de alguna de las suyas,
     en cualquier orden («señor anillos» → «El señor de los anillos»);
  3. lo buscado está dentro, pegado («mayday» → «Operación Mayday»), solo con
     cuatro letras o más: con menos, «it» o «up» coinciden con medio catálogo.
"""

import re

_CON_TILDE = "áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ"
_SIN_TILDE = "aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc"
assert len(_CON_TILDE) == len(_SIN_TILDE)

_TABLA = str.maketrans(_CON_TILDE, _SIN_TILDE)
_PALABRA = re.compile(r"[a-z0-9]+")

# Por debajo de esto no se busca "dentro" de las palabras (motivo 3).
MIN_DENTRO = 4


def expr_sql(columna: str, pegado: bool) -> str:
    """La normalización en SQL, para una columna calculada.

    Solo usa funciones IMMUTABLE (translate, lower, regexp_replace, btrim),
    que es lo que PostgreSQL exige en una columna GENERATED. `translate` va
    antes que `lower` con la tabla en mayúsculas y minúsculas: así no depende
    de que el `lower` de la base sepa bajar las letras con tilde."""
    base = f"lower(translate(coalesce({columna}, ''), '{_CON_TILDE}', '{_SIN_TILDE}'))"
    if pegado:
        return f"regexp_replace({base}, '[^a-z0-9]+', '', 'g')"
    return f"(' ' || btrim(regexp_replace({base}, '[^a-z0-9]+', ' ', 'g')) || ' ')"


def normalizar(texto: str | None) -> str:
    """Las palabras de `texto` normalizadas y separadas por un espacio."""
    return " ".join(_PALABRA.findall((texto or "").translate(_TABLA).lower()))


def consulta(texto: str) -> tuple[str, list[str]]:
    """Lo buscado como se compara: pegado y por palabras."""
    palabras = normalizar(texto).split()
    return "".join(palabras), palabras


def puntos_sql(separado: str, pegado: str) -> str:
    """Lo parecido que es un título a lo buscado (0 = igual), o NULL si no
    coincide. `separado`/`pegado` son las dos columnas normalizadas.

    Parámetros: $1 lo buscado pegado, $2 sus palabras (text[]), $3 si se puede
    buscar dentro de las palabras (ver MIN_DENTRO)."""
    return f"""(CASE
        WHEN {pegado} = $1::text THEN 0
        WHEN {pegado} LIKE $1::text || '%' THEN 1
        WHEN NOT EXISTS (SELECT 1 FROM unnest($2::text[]) AS p
                         WHERE position(' ' || p IN {separado}) = 0) THEN 2
        WHEN $3::boolean AND {pegado} LIKE '%' || $1::text || '%' THEN 3
    END)"""


def coincide(titulo: str | None, buscado: str) -> bool:
    """Lo mismo que `puntos_sql`, en Python: si `titulo` sale buscando
    `buscado`. Para filtrar lo que trae la búsqueda en vivo de Telegram."""
    pegado, palabras = consulta(buscado)
    if not pegado:
        return False
    suyo = normalizar(titulo)
    suyo_pegado = suyo.replace(" ", "")
    if suyo_pegado.startswith(pegado):
        return True
    sus_palabras = suyo.split()
    if all(any(s.startswith(p) for s in sus_palabras) for p in palabras):
        return True
    return len(pegado) >= MIN_DENTRO and pegado in suyo_pegado
