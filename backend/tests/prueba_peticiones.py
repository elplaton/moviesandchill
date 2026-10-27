"""Comprueba las peticiones de titulos que no tenemos (services/peticiones.py).

Lo que importa es lo que sale en nombre de la cuenta de Telegram del
servidor: que todo pase por la cola y salga **como mucho una a la hora**, que
nada se mande dos veces, que el limite diario se cumpla (y no cuente sumarse
a una ya pedida), que el admin pueda mover, mandar ya o quitar, que se le
avise una sola vez al pasar de cinco en cola, que un fallo de Telegram no se
reintente solo, y que al llegar el titulo se avise a todos los que lo
esperaban, una vez, aunque aun estuviera en la cola.

Se lanza solo, sin framework, sin base de datos y sin Telegram:
  PYTHONPATH=backend python3 backend/tests/prueba_peticiones.py
"""
import asyncio
import sys
import types

from app.services import peticiones as s

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


# --- Una base de datos de mentira, con un reloj que se adelanta a mano -------

class Base:
    def __init__(self):
        self.peticiones = {}        # (tmdb_id, tipo) -> dict
        self.esperan = {}           # (pid, user) -> {"origen", "avisado"}
        self.catalogo = set()
        self.mandadas = {}          # user -> cuantas hoy
        self.ajustes = {}
        self.app = {}               # app_settings
        self.siguiente = 1
        self.minuto = 0             # el reloj
        self.admins = [99]

    def _por_id(self, pid):
        return next((p for p in self.peticiones.values() if p["id"] == pid), None)

    async def en_catalogo(self, claves):
        return {c for c in claves if c in self.catalogo}

    async def de_titulo(self, tmdb_id, tipo):
        return self.peticiones.get((tmdb_id, tipo))

    async def mandadas_hoy(self, user_id):
        return self.mandadas.get(user_id, 0)

    async def encolar(self, datos):
        clave = (datos["tmdb_id"], datos["media_type"])
        p = self.peticiones.get(clave)
        if not p:
            p = {"id": self.siguiente}
            self.siguiente += 1
        orden = max([q["orden"] for q in self.peticiones.values() if q["estado"] == "en_cola"] or [0]) + 1
        p.update(datos, estado="en_cola", orden=orden, error=None)
        self.peticiones[clave] = p
        return p["id"]

    async def cola(self):
        return sorted((p for p in self.peticiones.values() if p["estado"] == "en_cola"),
                      key=lambda p: (p["orden"], p["id"]))

    async def cuantas_en_cola(self):
        return len(await self.cola())

    async def puesto(self, pid):
        ids = [p["id"] for p in await self.cola()]
        return ids.index(pid) + 1 if pid in ids else None

    async def segundos_para_siguiente(self, minutos):
        intentos = [p["intento_en"] for p in self.peticiones.values() if p.get("intento_en") is not None]
        if not intentos:
            return 0
        return max(0, (max(intentos) + minutos - self.minuto) * 60)

    async def por_id(self, pid):
        return self._por_id(pid)

    async def mover(self, pid, como):
        ids = [p["id"] for p in await self.cola()]
        if pid not in ids:
            return False
        i = ids.index(pid)
        if como == "primera":
            nuevo = [pid] + [x for x in ids if x != pid]
        elif como == "arriba" and i > 0:
            nuevo = ids[:i - 1] + [pid, ids[i - 1]] + ids[i + 1:]
        elif como == "abajo" and i < len(ids) - 1:
            nuevo = ids[:i] + [ids[i + 1], pid] + ids[i + 2:]
        else:
            return False
        for n, x in enumerate(nuevo, start=1):
            self._por_id(x)["orden"] = n
        return True

    async def descartar(self, pid):
        p = self._por_id(pid)
        if p and p["estado"] == "en_cola":
            p["estado"] = "descartada"

    async def marcar_enviada(self, pid, chat_id, chat_nombre, mensaje_id):
        self._por_id(pid).update(estado="enviada", chat_nombre=chat_nombre, intento_en=self.minuto)

    async def marcar_fallida(self, pid, error):
        self._por_id(pid).update(estado="fallida", error=error, intento_en=self.minuto)

    async def sumar(self, pid, user_id, origen):
        self.esperan[(pid, user_id)] = {"origen": origen, "avisado": False}
        if origen:
            self.mandadas[user_id] = self.mandadas.get(user_id, 0) + 1

    async def llegadas(self):
        out = []
        for (tmdb_id, tipo), p in self.peticiones.items():
            if p["estado"] in ("enviada", "en_cola") and (tmdb_id, tipo) in self.catalogo:
                out.append({"id": p["id"], "tmdb_id": tmdb_id, "media_type": tipo,
                            "titulo": p["titulo"], "poster": None,
                            "por_avisar": [u for (pid, u), e in self.esperan.items()
                                           if pid == p["id"] and not e["avisado"]]})
        return out

    async def marcar_conseguida(self, pid):
        self._por_id(pid)["estado"] = "conseguida"

    async def marcar_avisado(self, pid, user_id):
        self.esperan[(pid, user_id)]["avisado"] = True


class Conexion:
    """Lo poco que usa `avisar_cola()` de una conexion: la lista de admins."""
    def __init__(self, base):
        self.base = base

    async def fetch(self, sql, *args):
        return [{"id": i} for i in self.base.admins]


class Pool:
    def __init__(self, base):
        self.base = base

    def acquire(self):
        base = self.base

        class _Ctx:
            async def __aenter__(self):
                return Conexion(base)

            async def __aexit__(self, *a):
                return False
        return _Ctx()


class Telegram:
    def __init__(self):
        self.enviados = []
        self.fotos = []
        self.temas = []
        self.romper = None
        self.sin_fotos = False

    def is_connected(self):
        return True

    async def get_input_entity(self, chat_id):
        return f"chat{chat_id}"

    async def send_message(self, destino, texto, link_preview=True, reply_to=None):
        if self.romper:
            raise RuntimeError(self.romper)
        self.enviados.append((destino, texto))
        self.temas.append(reply_to)
        return types.SimpleNamespace(id=len(self.enviados))

    async def send_file(self, destino, archivo, caption="", reply_to=None):
        if self.romper:
            raise RuntimeError(self.romper)
        if self.sin_fotos:
            raise RuntimeError("WEBPAGE_MEDIA_EMPTY")
        self.fotos.append(archivo)
        self.enviados.append((destino, caption))
        self.temas.append(reply_to)
        return types.SimpleNamespace(id=len(self.enviados))


avisos = []


def montar():
    """Engancha la base, Telegram, TMDB y el push de mentira en los modulos
    que importa `services/peticiones.py` por dentro."""
    base, tg = Base(), Telegram()
    db = types.ModuleType("app.database.peticiones")
    for nombre in ("en_catalogo", "de_titulo", "mandadas_hoy", "encolar", "cola", "cuantas_en_cola",
                   "puesto", "segundos_para_siguiente", "por_id", "mover", "descartar",
                   "marcar_enviada", "marcar_fallida", "sumar", "llegadas", "marcar_conseguida",
                   "marcar_avisado"):
        setattr(db, nombre, getattr(base, nombre))
    sys.modules["app.database.peticiones"] = db
    import app.database
    app.database.peticiones = db

    cx = types.ModuleType("app.database.connection")
    async def get_app_settings():
        return dict(base.app)
    async def set_app_settings(valores):
        base.app.update(valores)
    cx.get_app_settings = get_app_settings
    cx.set_app_settings = set_app_settings
    cx.get_pool = lambda: Pool(base)
    sys.modules["app.database.connection"] = cx
    app.database.connection = cx

    tmdb = types.ModuleType("app.services.tmdb")
    async def get_details(api_key, tmdb_id, tipo):
        # Los pares llevan caratula y los impares no.
        poster = f"https://image.tmdb.org/t/p/w342/p{tmdb_id}.jpg" if tmdb_id % 2 == 0 else None
        return {"title": f"Titulo {tmdb_id}", "original_title": f"Original {tmdb_id}",
                "year": 2024, "poster": poster}
    tmdb.get_details = get_details
    sys.modules["app.services.tmdb"] = tmdb

    push = types.ModuleType("app.services.push")
    async def enviar(user_id, payload):
        avisos.append((user_id, payload["body"], payload.get("kind") or payload.get("reason")))
        return 1
    push.enviar = enviar
    sys.modules["app.services.push"] = push

    async def ajustes():
        return {"chat_id": base.ajustes.get("chat"), "chat_nombre": "Peticiones",
                "tema_id": base.ajustes.get("tema"), "tema_nombre": base.ajustes.get("tema_nombre", ""),
                "pausadas": base.ajustes.get("pausa", False),
                "plantilla": base.ajustes.get("plantilla", s.PLANTILLA_POR_DEFECTO)}
    s.ajustes = ajustes
    s._cliente = lambda: tg
    return base, tg


def pedir(user, tmdb_id, tipo="movie", admin=False):
    try:
        return asyncio.run(s.pedir(user, admin, tmdb_id, tipo, "clave"))
    except s.PeticionError as e:
        return ("error", e.codigo, str(e))


def despachar():
    return asyncio.run(s.despachar())


def esperar(minutos):
    base.minuto += minutos


def texto(tmdb_id, tipo="Película", ruta="movie"):
    return f"#peticion Titulo {tmdb_id} (2024) · {tipo}\nhttps://www.themoviedb.org/{ruta}/{tmdb_id}"


print("La plantilla")
comprueba("la de por defecto",
          "#peticion Dune: Parte dos (2024) · Película\nhttps://www.themoviedb.org/movie/693134",
          s.rellenar(s.PLANTILLA_POR_DEFECTO, s.EJEMPLO))
comprueba("una serie dice Serie y enlaza a /tv/",
          "Lost · Serie · https://www.themoviedb.org/tv/4607",
          s.rellenar("{titulo} · {tipo} · {enlace}", {"tmdb_id": 4607, "media_type": "tv", "titulo": "Lost"}))
comprueba("sin año no queda un parentesis vacio",
          "#peticion Lost · Serie", s.rellenar("#peticion {titulo} ({año}) · {tipo}",
                                                {"media_type": "tv", "titulo": "Lost"}))
comprueba("unas llaves sueltas no rompen nada",
          "Lost {otra} {", s.rellenar("{titulo} {otra} {", {"titulo": "Lost"}))
comprueba("los tipos del cliente se traducen", ("tv", "movie", None),
          (s.tipo_tmdb("series"), s.tipo_tmdb("movie"), s.tipo_tmdb("musica")))

print("\nAntes de pedir nada")
base, tg = montar()
comprueba("sin chat elegido no se pide", 409, pedir(1, 10)[1])
base.ajustes["chat"] = -100123
base.catalogo.add((10, "movie"))
comprueba("lo que ya tenemos no se pide", 409, pedir(1, 10)[1])

print("\nPedir es entrar en la cola, no escribir")
comprueba("la primera queda en el puesto 1", {"estado": "en_cola", "ya_pedida": False, "puesto": 1}, pedir(1, 20))
comprueba("y no se ha escrito nada en Telegram", 0, len(tg.enviados))
comprueba("otra cuenta pidiendo lo mismo se suma a la espera",
          {"estado": "en_cola", "ya_pedida": True, "puesto": 1}, pedir(2, 20))
comprueba("sumarse no cuenta para el limite", 0, base.mandadas.get(2, 0))
comprueba("la serie con el mismo id es otra peticion, puesto 2",
          {"estado": "en_cola", "ya_pedida": False, "puesto": 2}, pedir(1, 20, "series"))

print("\nUna a la hora")
comprueba("el despachador manda la primera", True, despachar())
comprueba("con su caratula, al chat elegido",
          [("chat-100123", texto(20))], tg.enviados)
comprueba("con caratula sale como foto, a 500 px", "https://image.tmdb.org/t/p/w500/p20.jpg", tg.fotos[0])
comprueba("y queda enviada", "enviada", base.peticiones[(20, "movie")]["estado"])
comprueba("pedir algo ya enviado tambien se suma, sin volver a la cola",
          {"estado": "enviada", "ya_pedida": True, "puesto": None}, pedir(3, 20))
esperar(10)
comprueba("a los diez minutos no sale la siguiente", False, despachar())
comprueba("faltan 50 minutos", 50 * 60, asyncio.run(s.segundos_para_siguiente()))
esperar(50)
comprueba("pasada la hora sale la siguiente", True, despachar())
comprueba("que era la serie", texto(20, "Serie", "tv"), tg.enviados[-1][1])
esperar(60)
comprueba("con la cola vacia no se manda nada", False, despachar())

print("\nEl limite por cuenta")
pedir(1, 30)
comprueba("con tres hoy, la cuarta no entra", 429, pedir(1, 40)[1])
comprueba("el admin no tiene limite", "en_cola", pedir(1, 40, admin=True)["estado"])

print("\nEl admin mueve la cola")
pedir(9, 51, admin=True)
pedir(9, 52, admin=True)
cola = lambda: [p["tmdb_id"] for p in asyncio.run(base.cola())]
comprueba("en orden de llegada", [30, 40, 51, 52], cola())
pid = base.peticiones[(52, "movie")]["id"]
asyncio.run(base.mover(pid, "primera"))
comprueba("«primera» la pone delante", [52, 30, 40, 51], cola())
asyncio.run(base.mover(base.peticiones[(30, "movie")]["id"], "abajo"))
comprueba("«abajo» la cambia con la siguiente", [52, 40, 30, 51], cola())
comprueba("y el despachador respeta ese orden", True, despachar() and tg.enviados[-1][1] == texto(52))

print("\nMandar ya y quitar")
asyncio.run(s.enviar_ya(base.peticiones[(51, "movie")]["id"]))
comprueba("«mandar ya» no espera su turno", texto(51), tg.enviados[-1][1])
comprueba("pero cuenta: la siguiente espera su hora desde ahora", False, despachar())
asyncio.run(base.descartar(base.peticiones[(30, "movie")]["id"]))
comprueba("«quitar» la saca de la cola sin mandarla", [40], cola())
comprueba("y queda descartada", "descartada", base.peticiones[(30, "movie")]["estado"])

print("\nEl tema del foro")
base.ajustes["tema"], base.ajustes["tema_nombre"] = 77, "Peticiones"
esperar(60)
despachar()
comprueba("con tema, el mensaje va a ese tema", 77, tg.temas[-1])
base.ajustes["tema"] = s.TEMA_GENERAL
pedir(9, 62, admin=True)
esperar(60)
despachar()
comprueba("el tema General no necesita responder a nada", None, tg.temas[-1])
base.ajustes["tema"] = None

print("\nCuando Telegram falla")
pedir(9, 70, admin=True)
tg.romper = "CHAT_WRITE_FORBIDDEN"
esperar(60)
despachar()
comprueba("queda fallida, con el motivo", ("fallida", True),
          (base.peticiones[(70, "movie")]["estado"], "CHAT_WRITE_FORBIDDEN" in base.peticiones[(70, "movie")]["error"]))
tg.romper = None
esperar(60)
comprueba("y no se reintenta sola", False, despachar())
comprueba("pedirla otra vez la devuelve a la cola", "en_cola", pedir(9, 70, admin=True)["estado"])
tg.sin_fotos = True
pedir(9, 72, admin=True)
esperar(60)
despachar()
esperar(60)
despachar()
comprueba("si Telegram no acepta la foto, sale el texto igualmente", texto(72), tg.enviados[-1][1])
tg.sin_fotos = False

print("\nAviso al admin con la cola llena")
avisos.clear()
for n in range(101, 106):
    pedir(9, n, admin=True)
comprueba("con cinco en cola, nada", [], [a for a in avisos if a[2] == "peticiones"])
pedir(9, 106, admin=True)
comprueba("con seis, un aviso al admin", [(99, "Hay 6 peticiones esperando a salir (sale una cada hora)", "peticiones")],
          [a for a in avisos if a[2] == "peticiones"])
pedir(9, 107, admin=True)
comprueba("con siete, no se repite", 1, len([a for a in avisos if a[2] == "peticiones"]))
for _ in range(3):
    esperar(60)
    despachar()
comprueba("al bajar de seis se rearma", "0", base.app.get(s.CLAVE_AVISO_COLA))
pedir(9, 108, admin=True)
pedir(9, 109, admin=True)
comprueba("y si vuelve a pasar de cinco, avisa otra vez", 2, len([a for a in avisos if a[2] == "peticiones"]))

print("\nCuando llega")
avisos.clear()
base.catalogo.add((20, "movie"))
asyncio.run(s.repasar())
comprueba("se avisa a todas las cuentas que la esperaban",
          [(1, "Titulo 20 ya se puede ver o descargar", "movie"),
           (2, "Titulo 20 ya se puede ver o descargar", "movie"),
           (3, "Titulo 20 ya se puede ver o descargar", "movie")], sorted(avisos))
comprueba("queda conseguida", "conseguida", base.peticiones[(20, "movie")]["estado"])
avisos.clear()
asyncio.run(s.repasar())
comprueba("la siguiente pasada no vuelve a avisar", [], avisos)

print("\nLo que llega estando aun en la cola")
avisos.clear()
enviados = len(tg.enviados)
base.catalogo.add((109, "movie"))
asyncio.run(s.repasar())
comprueba("se da por conseguido", "conseguida", base.peticiones[(109, "movie")]["estado"])
comprueba("y se avisa a quien lo pidio", [(9, "Titulo 109 ya se puede ver o descargar", "movie")], avisos)
for _ in range(10):
    esperar(60)
    despachar()
comprueba("sin haberse mandado nunca", False, any(t == texto(109) for _, t in tg.enviados[enviados:]))

print("\nUna serie avisa una vez, no por capitulo")
avisos.clear()
base.catalogo.add((20, "tv"))          # llega el primer capitulo
asyncio.run(s.repasar())
comprueba("al llegar el primer capitulo, un aviso", [(1, "Titulo 20 ya se puede ver o descargar", "series")], avisos)
avisos.clear()
for _ in range(3):                     # van llegando mas capitulos
    asyncio.run(s.repasar())
comprueba("los capitulos siguientes no vuelven a avisar", [], avisos)

print("\nPublicacion en pausa")
base.ajustes["pausa"] = True
esperar(120)
comprueba("en pausa se puede seguir pidiendo", "en_cola", pedir(9, 153, admin=True)["estado"])
enviados = len(tg.enviados)
comprueba("pero no sale nada aunque toque", False, despachar())
comprueba("ni un mensaje", enviados, len(tg.enviados))
base.ajustes["pausa"] = False
comprueba("al reanudar sale la siguiente", True, despachar())
asyncio.run(base.descartar(base.peticiones[(153, "movie")]["id"]))

print(f"\n{total - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
