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
Anthropic va en el `.env` (`TMD_ANTHROPIC_API_KEY`), no en el panel: es un
secreto y no tiene que poder leerse ni cambiarse desde la web. En el panel
solo estan el interruptor y el tope.
"""
import asyncio
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
# Lo que cuesta de media un grupo (medido: 0,66 centimos sin lote, 0,33 en
# lote), con un 50 % de margen: el tope se comprueba antes de mandar con esta
# cuenta y lo real se apunta al volver, asi que un lote no puede pasarse por
# haber calculado de menos.
COSTE_GRUPO_ESTIMADO = 0.0066 * DESCUENTO_LOTE * 1.5
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


# Preparar un lote (buscar las candidatas de cada grupo en TMDB) tarda minutos.
# Un solo lote a la vez: dos preparandose a la vez mandarian los mismos grupos
# dos veces, y el segundo taparia al primero, cuyos resultados se perderian.
_preparando: dict = {"activo": False, "hechos": 0, "total": 0}
_cerrojo_mandar = asyncio.Lock()


# --- Ajustes -------------------------------------------------------------------

def _clave_env() -> str:
    from app.routers.download import config

    return ((config or {}).get("anthropic_api_key") or "").strip()


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
        "clave": _clave_env(),
        "error": a.get("revision_ia_error") or None,
        "activa": a.get("revision_ia_activa") == "1",
        "tope": tope,
        "gasto_mes": float(gasto.get("dolares") or 0) if gasto.get("mes") == mes else 0.0,
        "mes": mes,
        "lote": a.get("revision_ia_lote") or "",
        "ultimo": json.loads(a.get("revision_ia_ultimo") or "null"),
    }


async def estado() -> dict:
    """Lo que enseña el panel. La clave nunca sale: solo si esta puesta en el
    `.env` y, si Anthropic la rechazo, el motivo."""
    from app.database.connection import get_pool

    a = await _ajustes()
    pendientes = 0
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            pendientes = await conn.fetchval("""SELECT COUNT(*) FROM revision_auto
                                                 WHERE estado IN ('sugerida', 'sin_candidato') AND ia IS NULL""")
    return {"modelo": MODELO, "activa": a["activa"], "configurada": bool(a["clave"]), "error": a["error"],
            "preparando": dict(_preparando) if _preparando["activo"] else None,
            "buscando": dict(_investigando) if _investigando["activo"] else None,
            "tope": a["tope"],
            "gasto_mes": round(a["gasto_mes"], 4), "lote": a["lote"] or None, "pendientes": pendientes,
            "ultimo": a["ultimo"]}


async def guardar(activa: bool | None, tope: float | None) -> dict:
    """El interruptor y el tope. Al encenderla se comprueba la clave del `.env`
    contra la API (pedir la ficha del modelo no cuesta nada)."""
    from app.database.connection import set_app_settings

    valores: dict[str, str] = {}
    if activa:
        clave = _clave_env()
        if not clave:
            raise ValueError("Falta TMD_ANTHROPIC_API_KEY en el .env del servidor")
        import anthropic

        try:
            await anthropic.AsyncAnthropic(api_key=clave).models.retrieve(MODELO)
        except anthropic.AuthenticationError:
            raise ValueError("Anthropic no acepta la clave de TMD_ANTHROPIC_API_KEY")
        except anthropic.APIError as e:
            raise ValueError(f"No se ha podido comprobar la clave: {e}")
        valores["revision_ia_error"] = ""
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


async def avisar_gasto() -> None:
    """Un aviso al movil de los admins al pasar del 80 % del tope del mes y
    otro al alcanzarlo (entonces la revision con IA se para hasta el mes
    siguiente). Cada uno una vez al mes."""
    from app.database.connection import get_app_settings, get_pool, set_app_settings
    from app.services.push import enviar

    a = await _ajustes()
    if not a["activa"] or a["tope"] <= 0:
        return
    nivel = 100 if a["gasto_mes"] >= a["tope"] else 80 if a["gasto_mes"] >= a["tope"] * 0.8 else 0
    if not nivel:
        return
    marca = f'{a["mes"]}:{nivel}'
    avisado = (await get_app_settings()).get("revision_ia_aviso") or ""
    if avisado == marca or (nivel == 80 and avisado == f'{a["mes"]}:100'):
        return
    await set_app_settings({"revision_ia_aviso": marca})
    texto = (f"Gastado {a['gasto_mes']:.2f} $ de {a['tope']:.2f} $ este mes: la revisión con IA se para hasta el mes "
             "que viene (o sube el tope)" if nivel == 100
             else f"Gastado {a['gasto_mes']:.2f} $ de {a['tope']:.2f} $ este mes (más del 80 % del tope)")
    async with get_pool().acquire() as conn:
        admins = [r["id"] for r in await conn.fetch("SELECT id FROM users WHERE role = 'admin' AND active IS NOT FALSE")]
    for uid in admins:
        try:
            await enviar(uid, {"title": "Revisión con IA", "body": texto, "reason": "revision", "tag": "revision-ia-gasto"})
        except Exception as e:
            logger.warning("Aviso de gasto de la IA al admin %d fallo: %s", uid, e)
    logger.info("Revision con IA: %s", texto)


async def mandar(api_key_tmdb: str) -> dict:
    """Monta y manda un lote con lo pendiente, sin pasarse del tope del mes.
    No hace nada si esta apagada, sin clave, con un lote ya en marcha o con
    otro preparandose. Tarda minutos (las candidatas de cada grupo se buscan
    en TMDB): el panel lo lanza en segundo plano y no lo espera."""
    if _cerrojo_mandar.locked():
        return await estado()
    async with _cerrojo_mandar:
        try:
            return await _mandar(api_key_tmdb)
        finally:
            _preparando.update(activo=False, hechos=0, total=0)


async def _mandar(api_key_tmdb: str) -> dict:
    from app.database.connection import get_pool, set_app_settings
    from app.services import revision

    a = await _ajustes()
    if not a["activa"] or not a["clave"] or a["lote"] or not api_key_tmdb:
        return await estado()
    margen = a["tope"] - a["gasto_mes"]
    cuantos = min(LOTE_MAX, int(margen / COSTE_GRUPO_ESTIMADO))
    if cuantos <= 0:
        logger.info("Revision con IA: tope del mes alcanzado (%.2f de %.2f $)", a["gasto_mes"], a["tope"])
        await avisar_gasto()
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

    import anthropic
    # Ya no estan en la lista, o no dicen de que serie son: fuera.
    # Lo de «Sin carátula» no va al lote: lo busca Claude en TMDB el mismo
    # (`investigar_pendientes`), porque las candidatas fijas no la encuentran.
    elegibles = [(f, grupos[f["clave"]]) for f in filas
                 if f["clave"] in grupos and not grupos[f["clave"]].get("sin_nombre")
                 and grupos[f["clave"]]["motivo"] != "sin_caratula"][:cuantos]
    sem = asyncio.Semaphore(5)
    _preparando.update(activo=True, hechos=0, total=len(elegibles))

    async def buscar(g):
        async with sem:
            r = await candidatas_de(g, api_key_tmdb)
            _preparando["hechos"] += 1
            return r

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
        # Que se vea en el panel: una clave revocada o sin saldo no puede
        # fallar en silencio.
        motivo = ("Anthropic no acepta la clave de TMD_ANTHROPIC_API_KEY"
                  if isinstance(e, anthropic.AuthenticationError) else f"No se ha podido mandar el lote: {e}")
        await set_app_settings({"revision_ia_error": motivo[:300]})
        return await estado()
    # Con el lote ya creado en Anthropic, apuntarlo no puede quedarse a medias:
    # si algo cancelara esta tarea aqui, el lote se cobraria y sus respuestas
    # no se recogerian nunca. Primero el id (es lo que permite recogerlo) y
    # protegido de cancelaciones.
    async def apuntar():
        await set_app_settings({"revision_ia_lote": lote.id, "revision_ia_error": ""})
        async with pool.acquire() as conn:
            await conn.execute("INSERT INTO revision_ia_lotes (lote, modelo, grupos) VALUES ($1, $2, $3) "
                               "ON CONFLICT (lote) DO NOTHING", lote.id, MODELO, len(peticiones))
            await conn.executemany("UPDATE revision_auto SET candidatas = $2::jsonb, ia_lote = $3 WHERE id = $1",
                                   [(id_, json.dumps(cands), lote.id) for id_, cands, marca in apuntes if not marca])
    await asyncio.shield(apuntar())
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
    gasto, entrada, salida = 0.0, 0, 0
    # Solo los grupos apuntados a este lote: uno adoptado puede traer alguno
    # que ya no esperaba a Claude, y ese no se toca.
    async with pool.acquire() as conn:
        mios = {f["id"] for f in await conn.fetch("SELECT id FROM revision_auto WHERE ia_lote = $1", lote.id)}
    async for r in await cliente.messages.batches.results(lote.id):
        id_ = int(r.custom_id[1:])
        if id_ not in mios:
            continue
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
        entrada += (msg.usage.input_tokens or 0) + (getattr(msg.usage, "cache_read_input_tokens", 0) or 0) \
            + (getattr(msg.usage, "cache_creation_input_tokens", 0) or 0)
        salida += msg.usage.output_tokens or 0
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
    try:
        await avisar_gasto()
    except Exception as e:
        logger.warning("Revision con IA: no se ha podido avisar del gasto: %s", e)
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO revision_ia_lotes (lote, modelo, grupos) VALUES ($1, $2, 0) ON CONFLICT (lote) DO NOTHING
        """, lote.id, MODELO)
        await conn.execute("""
            UPDATE revision_ia_lotes
               SET terminado = NOW(), aplicadas = $2, sugeridas = $3, ninguna = $4, fallos = $5,
                   entrada = $6, salida = $7, dolares = $8
             WHERE lote = $1
        """, lote.id, resumen["aplicadas"], resumen["sugeridas"], resumen["ninguna"], resumen["fallos"],
            entrada, salida, round(gasto, 4))
    await set_app_settings({"revision_ia_lote": "",
                            "revision_ia_ultimo": json.dumps({**resumen, "terminado": time.time()})})
    from app.services import revision
    revision.olvidar()
    logger.info("Revision con IA: lote %s recogido: %d aplicadas, %d sugeridas, %d ninguna, %d fallos, %.2f $",
                lote.id, resumen["aplicadas"], resumen["sugeridas"], resumen["ninguna"], resumen["fallos"], gasto)
    return resumen


async def _aplicar(id_: int, respuesta: dict) -> str:
    """Hace lo que toque con la respuesta de un grupo del lote."""
    from app.database.connection import get_pool

    pool = get_pool()
    async with pool.acquire() as conn:
        f = await conn.fetchrow("SELECT clave, candidatas FROM revision_auto WHERE id = $1", id_)
    cands = json.loads(f["candidatas"]) if isinstance(f["candidatas"], str) else (f["candidatas"] or [])
    if not cands and respuesta.get("eleccion", "ninguna") != "ninguna":
        # Un lote adoptado (`adoptar`) no tiene las candidatas apuntadas: la
        # elegida se pide a TMDB, con su caratula. Las mismas comprobaciones.
        from app.routers.peticiones_router import _api_key
        from app.services.tmdb import get_details

        tipo, _, tid = respuesta["eleccion"].partition(":")
        if tid.isdigit():
            det = await get_details(_api_key(), int(tid), "tv" if tipo == "tv" else "movie")
            cands = [det] if det else []
    return await aplicar_eleccion(id_, f["clave"], respuesta, cands, MODELO)


async def adoptar(lote_id: str) -> dict:
    """Hace suyo un lote que llego a Anthropic sin apuntarse aqui (pasaba
    cuando «Mandar» esperaba la respuesta y el navegador cortaba la peticion:
    el lote se creaba y se cobraba, pero nadie lo recogia). Solo uno ya
    terminado y cuyos grupos (r<id>) sean casi todos grupos que siguen
    esperando a Claude: si no, no es de aqui y se rechaza. Lo recoge `recoger()`."""
    from app.database.connection import get_pool, set_app_settings

    a = await _ajustes()
    if not a["clave"]:
        raise ValueError("Falta TMD_ANTHROPIC_API_KEY en el servidor")
    if a["lote"]:
        raise ValueError("Ya hay un lote en marcha: espera a que se recoja")
    cliente = _cliente(a["clave"])
    lote = await cliente.messages.batches.retrieve(lote_id)
    if lote.processing_status != "ended":
        raise ValueError("Ese lote aún no ha terminado")
    ids = []
    async for r in await cliente.messages.batches.results(lote_id):
        if r.custom_id.startswith("r") and r.custom_id[1:].isdigit():
            ids.append(int(r.custom_id[1:]))
    pool = get_pool()
    async with pool.acquire() as conn:
        validos = [f["id"] for f in await conn.fetch("""
            SELECT id FROM revision_auto
             WHERE id = ANY($1::int[]) AND estado IN ('sugerida', 'sin_candidato') AND ia IS NULL AND ia_lote IS NULL
        """, ids)]
        if not ids or len(validos) < 0.9 * len(ids):
            raise ValueError(f"Ese lote no parece de aquí: {len(validos)} de {len(ids)} grupos esperan a Claude")
        await conn.execute("UPDATE revision_auto SET ia_lote = $2 WHERE id = ANY($1::int[])", validos, lote_id)
        await conn.execute("INSERT INTO revision_ia_lotes (lote, modelo, grupos) VALUES ($1, $2, $3) "
                           "ON CONFLICT (lote) DO NOTHING", lote_id, MODELO, len(validos))
    await set_app_settings({"revision_ia_lote": lote_id})
    logger.info("Revision con IA: lote %s adoptado (%d de %d grupos)", lote_id, len(validos), len(ids))
    return {"grupos": len(validos), "en_lote": len(ids)}


async def aplicar_eleccion(id_: int, clave: str, respuesta: dict, cands: list[dict], marca: str) -> str:
    """La respuesta de Claude, aplicada: solo vale una ficha que este entre
    `cands` (las que se le dieron o las que salieron en sus busquedas). Alta,
    con caratula y, en una serie, con todos los capitulos -> se aplica; si no,
    sugerencia; «ninguna» -> se queda a mano. `marca` va en `ia`."""
    from app.database.connection import get_pool
    from app.routers.peticiones_router import _api_key
    from app.services import revision
    from app.services.revision_auto import _ficha, tipo_y_episodios, titulo_buscable

    pool = get_pool()
    f = {"clave": clave}
    eleccion, conf, motivo = respuesta["eleccion"], respuesta["confianza"], respuesta["motivo"][:300]
    elegida = next((c for c in cands if clave_de(c) == eleccion), None)

    async def marcar(estado: str, porque: str, sugerencia: dict | None, antes=None):
        async with pool.acquire() as conn:
            await conn.execute("""UPDATE revision_auto
                                     SET estado = $2, porque = $3, sugerencia = $4::jsonb, antes = $5::jsonb,
                                         ia = $6, ia_lote = NULL, creado = NOW()
                                   WHERE id = $1""",
                               id_, estado, porque, json.dumps(sugerencia) if sugerencia else None,
                               json.dumps(antes) if antes else None, marca)

    g = await revision.grupo(f["clave"])
    actual = (g or {}).get("actual")
    if (elegida is not None and actual and clave_de(actual) == eleccion and not elegida.get("poster")):
        # Se queda con la misma ficha sin caratula que ya tenia (no ha
        # encontrado otra): sugerirla no cambia nada. Queda a mano.
        elegida = None
    if elegida is None:
        await marcar("sin_candidato", f"Claude: ninguna encaja — {motivo}", None)
        return "ninguna"
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
                                           _api_key(), titulo=titulo, recalcular=False)
        await marcar("aplicada", f"Claude: {motivo}", _ficha(elegida), antes)
        return "aplicadas"
    nota = "" if conf != "alta" else " (no se aplica sola: faltan carátula o capítulos)"
    await marcar("sugerida", f"Claude ({conf}){nota}: {motivo}", _ficha(elegida))
    return "sugeridas"


async def historial(limite: int = 30) -> dict:
    """Los ultimos lotes, el gasto de cada mes y el total, para el panel. El
    gasto sale de lo que costo cada lote de verdad (su `usage`)."""
    from app.database.connection import get_pool

    pool = get_pool()
    async with pool.acquire() as conn:
        lotes = await conn.fetch("""SELECT lote, modelo, grupos, creado, terminado, aplicadas, sugeridas, ninguna,
                                           fallos, entrada, salida, dolares
                                      FROM revision_ia_lotes ORDER BY creado DESC LIMIT $1""", limite)
        meses = await conn.fetch("""SELECT to_char(creado, 'YYYY-MM') AS mes, COUNT(*) AS lotes,
                                           COALESCE(SUM(grupos), 0) AS grupos, COALESCE(SUM(aplicadas), 0) AS aplicadas,
                                           COALESCE(SUM(dolares), 0) AS dolares
                                      FROM revision_ia_lotes GROUP BY 1 ORDER BY 1 DESC LIMIT 12""")
        total = await conn.fetchval("SELECT COALESCE(SUM(dolares), 0) FROM revision_ia_lotes")
    return {
        "lotes": [{**{k: f[k] for k in ("lote", "modelo", "grupos", "aplicadas", "sugeridas", "ninguna", "fallos",
                                        "entrada", "salida")},
                   "dolares": float(f["dolares"]) if f["dolares"] is not None else None,
                   "creado": f["creado"].isoformat(), "terminado": f["terminado"].isoformat() if f["terminado"] else None}
                  for f in lotes],
        "meses": [{"mes": f["mes"], "lotes": f["lotes"], "grupos": f["grupos"], "aplicadas": f["aplicadas"],
                   "dolares": float(f["dolares"])} for f in meses],
        "total": float(total or 0),
    }



# --- Buscar en TMDB con Claude (lo que no tiene caratula) ---------------------
#
# En «Sin carátula» la ficha que hay no tiene imagen en TMDB, y casi siempre es
# que se emparejo con otra entrada (un especial, una «Collection», la de otro
# pais) o con el titulo mal escrito. Elegir entre unas candidatas fijas no
# basta: Claude recibe una herramienta para buscar en TMDB el mismo, con las
# consultas que se le ocurran (el original, sin subtitulo, como serie...), hasta
# BUSQUEDAS_MAX por grupo. Solo puede quedarse con una ficha que haya salido en
# sus busquedas (lo comprueba el servidor, `aplicar_eleccion`), y se aplica sola
# solo con seguridad alta y caratula. No va en lote: buscar varias veces es una
# conversacion de ida y vuelta, y la Batch API es de una respuesta. Cuenta para
# el mismo tope del mes y sale en el historial como «Búsqueda».

BUSQUEDAS_MAX = 6
# Medido sobre 4 grupos reales (Gomorrah, FoQ, The Punisher, Batallas Navales):
# entre 0,45 y 1,1 centimos por grupo. Con el doble de margen.
COSTE_BUSQUEDA_ESTIMADO = 0.02
MARCA_BUSQUEDA = MODELO + "+tmdb"
_investigando: dict = {"activo": False, "hechos": 0, "total": 0}
_cerrojo_investigar = asyncio.Lock()

SISTEMA_BUSCAR = """Eres el revisor del catálogo de una app de películas y series. Este grupo de archivos tiene puesta una ficha de TMDB que no tiene carátula, y casi siempre es porque se emparejó con la entrada equivocada: un especial, una «Collection», la versión de otro país, o el título mal escrito. Tu trabajo es encontrar en TMDB la ficha correcta de ese título, que normalmente sí tiene carátula.

Tienes la herramienta buscar_tmdb. Úsala con las consultas que creas útiles: el título que dice el canal, el original, sin subtítulos o sin «Temporada N», con otro año, como serie o como película. Haz como mucho 6 búsquedas; para cuando la encuentres.

Reglas:
1. Tiene que ser exactamente ese título, no uno parecido: una secuela, un spin-off, un especial o un documental NO valen.
2. El tipo importa: si los archivos son capítulos (S01E02, 1x03, numerados) es una serie.
3. El año desempata remakes y homónimos (en series vale una que empezó ese año o antes).
4. Solo puedes elegir una ficha que haya salido en tus búsquedas, por su clave ("movie:123" o "tv:456"). Si ninguna es el título, contesta "ninguna".
5. Seguridad "alta" solo si apostarías a que es esa sin mirar nada más; se aplicará sin que nadie lo revise. "media" o "baja" si hay dudas.
6. motivo: una frase corta en español con la razón.

Cuando termines, contesta solo con el JSON: {"eleccion": clave o "ninguna", "confianza": "alta"|"media"|"baja", "motivo": "..."}."""

HERRAMIENTA_TMDB = {
    "name": "buscar_tmdb",
    "description": ("Busca en TMDB (en español de España) y devuelve hasta 8 resultados con su clave, título, título "
                    "original, año, tipo, votos, si tiene carátula y el principio de la sinopsis."),
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "consulta": {"type": "string", "description": "Lo que se busca: un título."},
            "tipo": {"type": "string", "enum": ["movie", "tv", "cualquiera"],
                     "description": "movie para películas, tv para series, cualquiera para las dos."},
            # Sin «ñ»: los nombres de los campos de una herramienta solo admiten
            # letras ASCII, cifras, «_», «.» y «-» (400 si no).
            "anio": {"type": ["integer", "null"], "description": "Año de estreno, o null para no filtrar."},
        },
        "required": ["consulta", "tipo", "anio"],
        "additionalProperties": False,
    },
}

ESQUEMA_FINAL = {
    "type": "object",
    "properties": {
        "eleccion": {"type": "string"},
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
        "motivo": {"type": "string"},
    },
    "required": ["eleccion", "confianza", "motivo"],
    "additionalProperties": False,
}


async def buscar_tmdb(api_key_tmdb: str, consulta: str, tipo: str, año: int | None) -> list[dict]:
    """Lo que hace la herramienta: TMDB tal cual, hasta 8 resultados."""
    from app.services.tmdb import _get, _to_result

    tipos = ["movie", "tv"] if tipo == "cualquiera" else [tipo]
    out: list[dict] = []
    for t in tipos:
        extra = {("year" if t == "movie" else "first_air_date_year"): año} if año else {}
        d = await _get(f"/search/{t}", {"api_key": api_key_tmdb, "query": consulta[:200], "language": "es-ES",
                                         "page": 1, **extra})
        for r in ((d or {}).get("results") or [])[:8]:
            x = _to_result(r, t)
            if x:
                out.append(x)
    out.sort(key=lambda x: -(x.get("vote_count") or 0))
    return out[:8]


def _para_claude(resultados: list[dict]) -> str:
    return json.dumps([{"clave": clave_de(c), "titulo": c["title"], "original": c.get("original_title"),
                        "año": c.get("year"), "tipo": "serie" if c["media_type"] == "tv" else "película",
                        "votos": c.get("vote_count"), "caratula": bool(c.get("poster")),
                        "sinopsis": (c.get("overview") or "")[:160]} for c in resultados], ensure_ascii=False)


async def investigar(g: dict, api_key_tmdb: str, clave_api: str) -> tuple[dict | None, list[dict], float]:
    """(respuesta de Claude o None, fichas vistas en sus busquedas, coste).
    El bucle de herramientas a mano: hace falta el tope de busquedas, saber que
    fichas han salido y el coste de cada vuelta."""
    cliente = _cliente(clave_api)
    actual = g.get("actual")
    visible = json.loads(mensaje(g, []))
    visible.pop("candidatas", None)
    visible["ficha_actual_sin_caratula"] = (
        {"clave": clave_de(actual), "titulo": actual.get("title"), "año": actual.get("year"),
         "tipo": "serie" if actual.get("media_type") in ("tv", "series") else "película"} if actual else None)
    mensajes = [{"role": "user", "content": json.dumps(visible, ensure_ascii=False, indent=1)}]
    vistas: dict[str, dict] = {}
    coste, busquedas = 0.0, 0
    for _ in range(BUSQUEDAS_MAX + 2):
        r = await cliente.messages.create(
            model=MODELO, max_tokens=4000,
            system=[{"type": "text", "text": SISTEMA_BUSCAR, "cache_control": {"type": "ephemeral"}}],
            tools=[HERRAMIENTA_TMDB],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": ESQUEMA_FINAL}},
            messages=mensajes,
        )
        coste += _coste(r.usage) / DESCUENTO_LOTE    # a precio normal: no va en lote
        if r.stop_reason != "tool_use":
            if r.stop_reason != "end_turn":
                return None, list(vistas.values()), coste
            texto = next((b.text for b in r.content if b.type == "text"), "")
            try:
                return json.loads(texto), list(vistas.values()), coste
            except ValueError:
                return None, list(vistas.values()), coste
        mensajes.append({"role": "assistant", "content": r.content})
        resultados = []
        for b in r.content:
            if b.type != "tool_use":
                continue
            busquedas += 1
            if busquedas > BUSQUEDAS_MAX:
                resultados.append({"type": "tool_result", "tool_use_id": b.id, "is_error": True,
                                   "content": "Límite de búsquedas alcanzado: contesta ya con lo que has visto."})
                continue
            try:
                encontrados = await buscar_tmdb(api_key_tmdb, b.input["consulta"], b.input["tipo"], b.input.get("anio"))
            except Exception as e:
                resultados.append({"type": "tool_result", "tool_use_id": b.id, "is_error": True,
                                   "content": f"TMDB no ha contestado: {e}"})
                continue
            for c in encontrados:
                vistas[clave_de(c)] = c
            resultados.append({"type": "tool_result", "tool_use_id": b.id, "content": _para_claude(encontrados)})
        mensajes.append({"role": "user", "content": resultados})
    return None, list(vistas.values()), coste


async def investigar_pendientes(api_key_tmdb: str) -> dict | None:
    """Los grupos de «Sin carátula» que nadie ha buscado aun, de tres en tres y
    sin pasarse del tope. Uno a la vez (cerrojo)."""
    if _cerrojo_investigar.locked():
        return None
    async with _cerrojo_investigar:
        try:
            return await _investigar_pendientes(api_key_tmdb)
        finally:
            _investigando.update(activo=False, hechos=0, total=0)


async def _investigar_pendientes(api_key_tmdb: str) -> dict | None:
    from app.database.connection import get_pool
    from app.services import revision

    a = await _ajustes()
    if not a["activa"] or not a["clave"] or not api_key_tmdb:
        return None
    pool = get_pool()
    async with pool.acquire() as conn:
        filas = await conn.fetch("""SELECT id, clave FROM revision_auto
                                     WHERE motivo = 'sin_caratula' AND estado <> 'aplicada'
                                       AND estado NOT IN ('deshecha', 'descartada')
                                       AND (ia IS NULL OR ia = $1) AND ia_lote IS NULL
                                     ORDER BY archivos DESC""", MODELO)
    grupos = {g["clave"]: g for gs in (await revision.grupos()).values() for g in gs}
    margen = a["tope"] - a["gasto_mes"]
    elegibles = [(f["id"], grupos[f["clave"]]) for f in filas if f["clave"] in grupos][:max(0, int(margen / COSTE_BUSQUEDA_ESTIMADO))]
    if not elegibles:
        return None
    _investigando.update(activo=True, hechos=0, total=len(elegibles))
    nombre = f"busqueda-{int(time.time())}"
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO revision_ia_lotes (lote, modelo, grupos) VALUES ($1, $2, $3)",
                           nombre, MARCA_BUSQUEDA, len(elegibles))
    resumen = {"aplicadas": 0, "sugeridas": 0, "ninguna": 0, "fallos": 0}
    gasto = 0.0
    sem = asyncio.Semaphore(3)

    async def uno(id_, g):
        nonlocal gasto
        async with sem:
            try:
                respuesta, vistas, coste = await investigar(g, api_key_tmdb, a["clave"])
                gasto += coste
                if respuesta is None:
                    resumen["fallos"] += 1
                else:
                    resumen[await aplicar_eleccion(id_, g["clave"], respuesta, vistas, MARCA_BUSQUEDA)] += 1
            except Exception as e:
                logger.warning("Revision con IA: la busqueda de «%s» fallo: %s", g["titulo"], e)
                resumen["fallos"] += 1
            _investigando["hechos"] += 1

    await asyncio.gather(*(uno(i, g) for i, g in elegibles))
    await _sumar_gasto(gasto)
    async with pool.acquire() as conn:
        await conn.execute("""UPDATE revision_ia_lotes SET terminado = NOW(), aplicadas = $2, sugeridas = $3,
                                     ninguna = $4, fallos = $5, dolares = $6 WHERE lote = $1""",
                           nombre, resumen["aplicadas"], resumen["sugeridas"], resumen["ninguna"],
                           resumen["fallos"], round(gasto, 4))
    revision.olvidar()
    try:
        await avisar_gasto()
    except Exception:
        pass
    logger.info("Revision con IA: busqueda de caratulas: %s, %.2f $", resumen, gasto)
    return resumen
