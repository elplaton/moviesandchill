"""Revision con IA: Claude elige la ficha de lo que la revision exacta no resuelve.

La revision automatica (services/revision_auto.py) solo se atreve con lo que
coincide **exactamente** con TMDB. Lo demas —sugerencias y grupos sin
coincidencia exacta— se le manda a Claude Sonnet 5.5 con lo que dice el canal
(titulo, ficha, pie, unos cuantos nombres de archivo) y hasta 8 candidatas de
TMDB, y Claude elige una o «ninguna», con su seguridad y el motivo.

Medido antes de montarlo (noviembre de 2026, 35 grupos reales cuyo canal
enlaza la ficha de TMDB, con el enlace borrado; 23 ambiguos y 11 sin la buena
entre las candidatas): Haiku 5.5, Sonnet 5.5 y Opus 5.5 acertaron los 35 sin
ningun error con seguridad alta; Haiku se atrevia con menos (19 de 24 con
seguridad alta frente a 24) y Opus costaba el doble que Sonnet sin aportar
nada. De ahi Sonnet 5.5.

Lo que se hace con cada respuesta:

* **alta**, y la ficha pasa las comprobaciones de siempre (caratula; en una
  serie, todos los archivos con su capitulo) -> se aplica sola, guardando como
  estaba cada archivo: sale en «Corregido solo» con su Deshacer.
* **media o baja** -> sugerencia en el panel, con la razon de Claude.
* **ninguna** -> se queda para corregirlo a mano.

Claude **solo puede elegir entre las candidatas**: cada peticion lleva sus
claves como lista cerrada en el esquema de la respuesta, asi que no se puede
inventar una ficha.

Va por la **Batch API** (la mitad de precio; los lotes acaban en menos de una
hora casi siempre y como mucho en 24 h) y con un **tope de gasto al mes**: con
el tope alcanzado no se manda nada hasta el mes siguiente. El lote en marcha se
apunta en `app_settings`, asi que un reinicio sigue esperandolo. La clave de
Anthropic se pone en el panel y vive en `app_settings`; nunca se devuelve.
"""
import json
import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger("tmd")

MODELO = "claude-sonnet-5-5"
# $ por millon de tokens: entrada, salida, lectura de cache, escritura de cache.
# La Batch API cobra la mitad de todo.
PRECIOS = (2.00, 10.00, 0.20, 2.50)
DESCUENTO_LOTE = 0.5
# Lo que cuesta de media un grupo (medido en la prueba: 0,66 centimos sin lote),
# para no pasarse del tope al montar un lote.
COSTE_GRUPO_ESTIMADO = 0.0066 * DESCUENTO_LOTE
CANDIDATAS_MAX = 8
LOTE_MAX = 2000
TOPE_MES_DEFECTO = 20.0
# Sin respaldo de otro modelo (`fallbacks`): la Batch API no lo admite (400
# «not supported for batch requests», comprobado). Un grupo que Sonnet rechace
# se queda sin tocar, para revisarlo a mano.

SISTEMA = """Eres el revisor del catálogo de una app de películas y series. El catálogo sale de canales de Telegram: cada grupo son archivos de vídeo que el sistema cree que son el mismo título (una película en varias calidades o partes, o los capítulos de una serie). Tu trabajo es decir a qué ficha de TMDB corresponde el grupo, eligiendo entre las candidatas que te damos, o decir que ninguna es.

Lo que recibes de cada grupo:
- titulo_canal: el título que dice el canal (su ficha o el pie del archivo). Puede venir con ruido: etiquetas, calidad, idioma, nombres de canal, o directamente no ser un título.
- original: el título original si el canal lo da (a veces es basura de la ficha).
- año: el año que dice el canal, si lo dice.
- n_archivos y archivos: cuántos archivos hay y unos cuantos nombres.
- ficha y pie: el texto del canal tal cual.
- candidatas: resultados de TMDB, cada uno con su clave ("movie:123" o "tv:456"), título, título original, año, tipo, votos y el principio de la sinopsis.

Reglas:
1. Tiene que ser exactamente ese título, no uno parecido. Una secuela, una parte distinta, un spin-off, un especial, una película de una serie (o la serie de una película) o un documental sobre el título NO valen.
2. El tipo importa. Si los archivos son capítulos (S01E02, 1x03, numerados por episodio) es una serie; una película en varias partes de un comprimido (.part1.rar, .7z.001, .zip.002) sigue siendo una película.
3. El año desempata remakes y homónimos. En una película, el año del canal debe coincidir con el de la candidata con un año de margen (estrenos en España). En una serie, el año del canal puede ser el de una temporada posterior: vale una serie que empezó ese año o antes.
4. Los títulos pueden estar en otro idioma: compara también con el título original.
5. Si ninguna candidata es ese título, contesta "ninguna". Es mejor "ninguna" que una ficha equivocada: una ficha equivocada pone la carátula de otra película a cientos de archivos.
6. Seguridad:
   - "alta": apostarías a que es esa sin mirar nada más (título y tipo que encajan, y el año si se sabe). Se aplicará sin que nadie lo revise.
   - "media": probablemente es esa, pero hay algo que no cuadra o dos candidatas posibles.
   - "baja": no está claro.
   Con "ninguna", la seguridad dice lo seguro que estás de que ninguna encaja.
7. motivo: una frase corta en español con la razón.

Ejemplos:
- Canal "Dune Parte dos" (2024), 3 archivos .zip.00N; candidatas "Dune" (2021, película) y "Dune: Parte dos" (2024, película) -> "Dune: Parte dos", alta.
- Canal "Black Clover", 135 archivos "135 - Black Clover 1080p.mkv"; candidatas "Black Clover" (2017, serie) y "Black Clover: La espada del rey mago" (2023, película) -> la serie, alta (son capítulos).
- Canal "La familia Addams", sin año, 2 archivos; candidatas "La familia Addams" de 1991 y de 2019 (películas) y de 1964 (serie) -> la más probable con seguridad media o baja: sin año no se puede saber cuál.
- Canal "Star Wars" (2002), archivos de los episodios 1 a 6; candidatas "La guerra de las galaxias" (1977) y la serie "Star Wars: La guerra de los clones" -> ninguna: el grupo mezcla varias películas.
"""


# --- Ajustes -------------------------------------------------------------------

async def _ajustes() -> dict:
    from app.database.connection import get_app_settings

    a = await get_app_settings()
    try:
        tope = float(a.get("revision_ia_tope") or TOPE_MES_DEFECTO)
    except ValueError:
        tope = TOPE_MES_DEFECTO
    gasto = json.loads(a.get("revision_ia_gasto") or "{}")
    mes = datetime.now(timezone.utc).strftime("%Y-%m")
    return {
        "clave": a.get("revision_ia_clave") or "",
        "activa": a.get("revision_ia_activa") == "1",
        "tope": tope,
        "gasto_mes": float(gasto.get("dolares") or 0) if gasto.get("mes") == mes else 0.0,
        "mes": mes,
        "lote": a.get("revision_ia_lote") or "",
        "ultimo": json.loads(a.get("revision_ia_ultimo") or "null"),
    }


async def estado() -> dict:
    """Lo que enseña el panel. La clave nunca sale: solo si hay y sus 4 ultimas."""
    from app.database.connection import get_pool

    a = await _ajustes()
    pendientes = 0
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            pendientes = await conn.fetchval("""SELECT COUNT(*) FROM revision_auto
                                                 WHERE estado IN ('sugerida', 'sin_candidato') AND ia IS NULL""")
    return {"modelo": MODELO, "activa": a["activa"], "configurada": bool(a["clave"]),
            "clave_fin": a["clave"][-4:] if a["clave"] else None, "tope": a["tope"],
            "gasto_mes": round(a["gasto_mes"], 4), "lote": a["lote"] or None, "pendientes": pendientes,
            "ultimo": a["ultimo"]}


async def guardar(clave: str | None, activa: bool | None, tope: float | None) -> dict:
    """Guarda lo que llegue. Una clave nueva se comprueba antes contra la API
    (pedir la ficha del modelo no cuesta nada)."""
    from app.database.connection import set_app_settings

    valores: dict[str, str] = {}
    if clave is not None:
        clave = clave.strip()
        if clave:
            import anthropic

            try:
                await anthropic.AsyncAnthropic(api_key=clave).models.retrieve(MODELO)
            except anthropic.AuthenticationError:
                raise ValueError("Anthropic no acepta esa clave")
            except anthropic.APIError as e:
                raise ValueError(f"No se ha podido comprobar la clave: {e}")
        valores["revision_ia_clave"] = clave
    if activa is not None:
        valores["revision_ia_activa"] = "1" if activa else "0"
    if tope is not None:
        if tope < 0:
            raise ValueError("El tope no puede ser negativo")
        valores["revision_ia_tope"] = str(tope)
    await set_app_settings(valores)
    return await estado()


def _cliente(clave: str):
    import anthropic

    return anthropic.AsyncAnthropic(api_key=clave)


# --- Lo que se le manda --------------------------------------------------------

def esquema(claves: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "eleccion": {"type": "string", "enum": claves + ["ninguna"]},
            "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
            "motivo": {"type": "string"},
        },
        "required": ["eleccion", "confianza", "motivo"],
        "additionalProperties": False,
    }


def clave_de(c: dict) -> str:
    return f'{"tv" if c["media_type"] in ("tv", "series") else "movie"}:{c["tmdb_id"]}'


def mensaje(g: dict, candidatas: list[dict]) -> str:
    miembros = g["miembros"]
    paso = max(1, len(miembros) // 5)
    visible = {
        "titulo_canal": g["titulo"], "original": g.get("original"), "año": g.get("año"),
        "n_archivos": len(miembros), "archivos": [m[5] for m in miembros[::paso][:5]],
        "ficha": g.get("ficha"), "pie": g.get("pie"),
        "candidatas": [{"clave": clave_de(c), "titulo": c["title"], "original": c.get("original_title"),
                        "año": c.get("year"), "tipo": "serie" if c["media_type"] in ("tv", "series") else "película",
                        "votos": c.get("vote_count"), "sinopsis": (c.get("overview") or "")[:220]}
                       for c in candidatas],
    }
    return json.dumps(visible, ensure_ascii=False, indent=1)


async def candidatas_de(g: dict, api_key_tmdb: str) -> list[dict]:
    """Hasta 8 candidatas de TMDB: lo que se encuentra por el titulo y el
    original, como pelicula y como serie, y la sugerencia que ya hubiera."""
    from app.services.revision_auto import titulo_buscable
    from app.services.tmdb import _get, _to_result

    vistos, out = set(), []

    def poner(c):
        if c and clave_de(c) not in vistos and len(out) < CANDIDATAS_MAX:
            vistos.add(clave_de(c))
            out.append(c)

    for t in (titulo_buscable(g["titulo"]), titulo_buscable(g.get("original"))):
        if not t:
            continue
        for tipo in ("movie", "tv"):
            d = await _get(f"/search/{tipo}", {"api_key": api_key_tmdb, "query": t, "language": "es-ES", "page": 1})
            for r in ((d or {}).get("results") or [])[:4]:
                poner(_to_result(r, tipo))
    return out


# --- El lote -------------------------------------------------------------------

def _coste(u) -> float:
    ent, sal, lee, esc = PRECIOS
    return ((u.input_tokens or 0) * ent + (u.output_tokens or 0) * sal
            + (getattr(u, "cache_read_input_tokens", 0) or 0) * lee
            + (getattr(u, "cache_creation_input_tokens", 0) or 0) * esc) / 1e6 * DESCUENTO_LOTE


async def _sumar_gasto(dolares: float) -> None:
    from app.database.connection import set_app_settings

    a = await _ajustes()
    await set_app_settings({"revision_ia_gasto": json.dumps({"mes": a["mes"], "dolares": a["gasto_mes"] + dolares})})


async def mandar(api_key_tmdb: str) -> dict:
    """Monta y manda un lote con lo pendiente, sin pasarse del tope del mes.
    No hace nada si esta apagada, sin clave o con un lote ya en marcha."""
    from app.database.connection import get_pool, set_app_settings
    from app.services import revision

    a = await _ajustes()
    if not a["activa"] or not a["clave"] or a["lote"] or not api_key_tmdb:
        return await estado()
    margen = a["tope"] - a["gasto_mes"]
    cuantos = min(LOTE_MAX, int(margen / COSTE_GRUPO_ESTIMADO))
    if cuantos <= 0:
        logger.info("Revision con IA: tope del mes alcanzado (%.2f de %.2f $)", a["gasto_mes"], a["tope"])
        return await estado()

    pool = get_pool()
    async with pool.acquire() as conn:
        filas = await conn.fetch("""SELECT id, clave FROM revision_auto
                                     WHERE estado IN ('sugerida', 'sin_candidato') AND ia IS NULL
                                     ORDER BY archivos DESC""")
    grupos = {}
    for lista in (await revision.grupos()).values():
        for g in lista:
            grupos[g["clave"]] = g

    import asyncio

    import anthropic
    # Ya no estan en la lista, o no dicen de que serie son: fuera.
    elegibles = [(f, grupos[f["clave"]]) for f in filas
                 if f["clave"] in grupos and not grupos[f["clave"]].get("sin_nombre")][:cuantos]
    sem = asyncio.Semaphore(5)

    async def buscar(g):
        async with sem:
            return await candidatas_de(g, api_key_tmdb)

    todas = await asyncio.gather(*(buscar(g) for _, g in elegibles))
    peticiones, apuntes = [], []
    for (f, g), cands in zip(elegibles, todas):
        if not cands:
            apuntes.append((f["id"], None, "sin_candidatas"))
            continue
        params = {
            "model": MODELO, "max_tokens": 2000,
            "system": [{"type": "text", "text": SISTEMA, "cache_control": {"type": "ephemeral"}}],
            "output_config": {"effort": "low", "format": {"type": "json_schema",
                                                          "schema": esquema([clave_de(c) for c in cands])}},
            "messages": [{"role": "user", "content": mensaje(g, cands)}],
        }
        peticiones.append({"custom_id": f"r{f['id']}", "params": params})
        apuntes.append((f["id"], cands, None))

    async with pool.acquire() as conn:
        for id_, cands, marca in apuntes:
            if marca:
                await conn.execute("UPDATE revision_auto SET ia = $2 WHERE id = $1", id_, marca)
    if not peticiones:
        return await estado()

    try:
        lote = await _cliente(a["clave"]).messages.batches.create(requests=peticiones)
    except anthropic.APIError as e:
        logger.warning("Revision con IA: no se ha podido mandar el lote: %s", e)
        return await estado()
    async with pool.acquire() as conn:
        await conn.executemany("UPDATE revision_auto SET candidatas = $2::jsonb, ia_lote = $3 WHERE id = $1",
                               [(id_, json.dumps(cands), lote.id) for id_, cands, marca in apuntes if not marca])
    await set_app_settings({"revision_ia_lote": lote.id})
    logger.info("Revision con IA: lote %s con %d grupos", lote.id, len(peticiones))
    return await estado()


async def recoger() -> dict | None:
    """Si el lote en marcha ha acabado, aplica lo que ha dicho Claude."""
    from app.database.connection import get_pool, set_app_settings

    a = await _ajustes()
    if not a["lote"] or not a["clave"]:
        return None
    cliente = _cliente(a["clave"])
    lote = await cliente.messages.batches.retrieve(a["lote"])
    if lote.processing_status != "ended":
        return None
    pool = get_pool()
    resumen = {"aplicadas": 0, "sugeridas": 0, "ninguna": 0, "fallos": 0, "dolares": 0.0}
    gasto = 0.0
    async for r in await cliente.messages.batches.results(lote.id):
        id_ = int(r.custom_id[1:])
        if r.result.type != "succeeded":
            resumen["fallos"] += 1
            logger.warning("Revision con IA: el grupo %d no ha salido (%s): %s", id_, r.result.type,
                           getattr(r.result, "error", ""))
            # Sin marcar: el siguiente lote lo vuelve a intentar.
            async with pool.acquire() as conn:
                await conn.execute("UPDATE revision_auto SET ia_lote = NULL WHERE id = $1", id_)
            continue
        msg = r.result.message
        gasto += _coste(msg.usage)
        if msg.stop_reason in ("refusal", "max_tokens"):
            # Se marca para no volver a mandarlo en cada lote: queda a mano.
            logger.warning("Revision con IA: el grupo %d acabo en %s", id_, msg.stop_reason)
            resumen["fallos"] += 1
            async with pool.acquire() as conn:
                await conn.execute("UPDATE revision_auto SET ia = $2, ia_lote = NULL WHERE id = $1",
                                   id_, f"{MODELO}:{msg.stop_reason}")
            continue
        try:
            respuesta = json.loads(next(b.text for b in msg.content if b.type == "text"))
            cual = await _aplicar(id_, respuesta)
        except Exception as e:
            logger.warning("Revision con IA: el grupo %d no se ha podido aplicar: %s", id_, e)
            cual = "fallos"
        resumen[cual] += 1
    resumen["dolares"] = round(gasto, 4)
    await _sumar_gasto(gasto)
    await set_app_settings({"revision_ia_lote": "",
                            "revision_ia_ultimo": json.dumps({**resumen, "terminado": time.time()})})
    from app.services import revision
    revision.olvidar()
    logger.info("Revision con IA: lote %s recogido: %d aplicadas, %d sugeridas, %d ninguna, %d fallos, %.2f $",
                lote.id, resumen["aplicadas"], resumen["sugeridas"], resumen["ninguna"], resumen["fallos"], gasto)
    return resumen


async def _aplicar(id_: int, respuesta: dict) -> str:
    """Hace lo que toque con la respuesta de un grupo."""
    from app.database.connection import get_pool
    from app.routers.peticiones_router import _api_key
    from app.services import revision
    from app.services.revision_auto import _ficha, tipo_y_episodios, titulo_buscable

    pool = get_pool()
    async with pool.acquire() as conn:
        f = await conn.fetchrow("SELECT clave, candidatas FROM revision_auto WHERE id = $1", id_)
    cands = json.loads(f["candidatas"]) if isinstance(f["candidatas"], str) else (f["candidatas"] or [])
    eleccion, conf, motivo = respuesta["eleccion"], respuesta["confianza"], respuesta["motivo"][:300]
    elegida = next((c for c in cands if clave_de(c) == eleccion), None)

    async def marcar(estado: str, porque: str, sugerencia: dict | None, antes=None):
        async with pool.acquire() as conn:
            await conn.execute("""UPDATE revision_auto
                                     SET estado = $2, porque = $3, sugerencia = $4::jsonb, antes = $5::jsonb,
                                         ia = $6, ia_lote = NULL, creado = NOW()
                                   WHERE id = $1""",
                               id_, estado, porque, json.dumps(sugerencia) if sugerencia else None,
                               json.dumps(antes) if antes else None, MODELO)

    if elegida is None:
        await marcar("sin_candidato", f"Claude: ninguna encaja — {motivo}", None)
        return "ninguna"
    g = await revision.grupo(f["clave"])
    if g is None:
        await marcar("sin_candidato", "el grupo ya no está en la lista", None)
        return "fallos"
    tipo = "series" if elegida["media_type"] in ("tv", "series") else "movie"
    titulo = titulo_buscable(g["titulo"]) or g["titulo"]
    seguro = conf == "alta" and bool(elegida.get("poster"))
    if seguro and tipo == "series":
        # Las mismas comprobaciones que lo exacto: todos con su capitulo.
        _, episodios = tipo_y_episodios(g["miembros"], "series", g.get("ficha"), titulo)
        seguro = episodios is not None
    if seguro:
        antes = await revision.poner_ficha(g["miembros"], elegida["tmdb_id"], elegida["media_type"],
                                           _api_key(), titulo=titulo)
        await marcar("aplicada", f"Claude: {motivo}", _ficha(elegida), antes)
        return "aplicadas"
    nota = "" if conf != "alta" else " (no se aplica sola: faltan carátula o capítulos)"
    await marcar("sugerida", f"Claude ({conf}){nota}: {motivo}", _ficha(elegida))
    return "sugeridas"
