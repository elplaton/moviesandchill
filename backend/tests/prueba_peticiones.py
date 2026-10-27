"""Comprueba las peticiones de titulos que no tenemos (services/peticiones.py).

Lo que importa es lo que sale en nombre de la cuenta de Telegram del
servidor: que nada se mande dos veces, que el limite diario se cumpla (y no
cuente sumarse a una peticion ya mandada), que un fallo de Telegram no deje
a nadie esperando algo que no salio, y que al llegar el titulo se avise a
todos los que lo esperaban, una sola vez.

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


# --- Una base de datos de mentira -------------------------------------------

class Base:
    def __init__(self):
        self.peticiones = {}        # (tmdb_id, tipo) -> dict
        self.esperan = {}           # (pid, user) -> {"origen", "avisado"}
        self.catalogo = set()
        self.mandadas = {}          # user -> cuantas hoy
        self.ajustes = {}
        self.siguiente = 1

    async def en_catalogo(self, claves):
        return {c for c in claves if c in self.catalogo}

    async def de_titulo(self, tmdb_id, tipo):
        return self.peticiones.get((tmdb_id, tipo))

    async def mandadas_hoy(self, user_id):
        return self.mandadas.get(user_id, 0)

    async def guardar_enviada(self, datos, chat_id, chat_nombre, mensaje_id):
        clave = (datos["tmdb_id"], datos["media_type"])
        p = self.peticiones.get(clave) or {"id": self.siguiente}
        if p["id"] == self.siguiente:
            self.siguiente += 1
        p.update(datos, estado="enviada", chat_id=chat_id, error=None)
        self.peticiones[clave] = p
        return p["id"]

    async def guardar_fallida(self, datos, error):
        clave = (datos["tmdb_id"], datos["media_type"])
        p = self.peticiones.get(clave)
        if p and p["estado"] == "enviada":
            return
        self.peticiones[clave] = {"id": p["id"] if p else 0, **datos, "estado": "fallida", "error": error}

    async def sumar(self, pid, user_id, origen):
        self.esperan[(pid, user_id)] = {"origen": origen, "avisado": False}
        if origen:
            self.mandadas[user_id] = self.mandadas.get(user_id, 0) + 1

    async def llegadas(self):
        out = []
        for (tmdb_id, tipo), p in self.peticiones.items():
            if p["estado"] == "enviada" and (tmdb_id, tipo) in self.catalogo:
                out.append({"id": p["id"], "tmdb_id": tmdb_id, "media_type": tipo,
                            "titulo": p["titulo"], "poster": None,
                            "por_avisar": [u for (pid, u), e in self.esperan.items()
                                           if pid == p["id"] and not e["avisado"]]})
        return out

    async def marcar_conseguida(self, pid):
        for p in self.peticiones.values():
            if p["id"] == pid:
                p["estado"] = "conseguida"

    async def marcar_avisado(self, pid, user_id):
        self.esperan[(pid, user_id)]["avisado"] = True


class Telegram:
    def __init__(self):
        self.enviados = []
        self.fotos = []
        self.romper = None
        self.sin_fotos = False

    def is_connected(self):
        return True

    async def get_input_entity(self, chat_id):
        return f"chat{chat_id}"

    async def send_message(self, destino, texto, link_preview=True):
        if self.romper:
            raise RuntimeError(self.romper)
        self.enviados.append((destino, texto))
        return types.SimpleNamespace(id=len(self.enviados))

    async def send_file(self, destino, archivo, caption=""):
        if self.romper:
            raise RuntimeError(self.romper)
        if self.sin_fotos:
            raise RuntimeError("WEBPAGE_MEDIA_EMPTY")
        self.fotos.append(archivo)
        self.enviados.append((destino, caption))
        return types.SimpleNamespace(id=len(self.enviados))


avisos = []


def montar():
    """Engancha la base, Telegram, TMDB y el push de mentira en los modulos
    que importa `services/peticiones.py` por dentro."""
    base, tg = Base(), Telegram()
    db = types.ModuleType("app.database.peticiones")
    for nombre in ("en_catalogo", "de_titulo", "mandadas_hoy", "guardar_enviada", "guardar_fallida",
                   "sumar", "llegadas", "marcar_conseguida", "marcar_avisado"):
        setattr(db, nombre, getattr(base, nombre))
    sys.modules["app.database.peticiones"] = db
    import app.database
    app.database.peticiones = db

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
        avisos.append((user_id, payload["body"], payload["kind"]))
        return 1
    push.enviar = enviar
    sys.modules["app.services.push"] = push

    async def ajustes():
        return {"chat_id": base.ajustes.get("chat"), "chat_nombre": "Peticiones",
                "plantilla": base.ajustes.get("plantilla", s.PLANTILLA_POR_DEFECTO)}
    s.ajustes = ajustes
    s._cliente = lambda: tg
    return base, tg


def pedir(user, tmdb_id, tipo="movie", admin=False):
    try:
        return asyncio.run(s.pedir(user, admin, tmdb_id, tipo, "clave"))
    except s.PeticionError as e:
        return ("error", e.codigo, str(e))


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

print("\nAntes de mandar nada")
base, tg = montar()
comprueba("sin chat elegido no se pide", 409, pedir(1, 10)[1])
base.ajustes["chat"] = -100123
base.catalogo.add((10, "movie"))
comprueba("lo que ya tenemos no se pide", 409, pedir(1, 10)[1])
comprueba("y no ha salido ningun mensaje", 0, len(tg.enviados))

print("\nPedir y sumarse")
comprueba("la primera vez se manda", {"estado": "enviada", "ya_pedida": False}, pedir(1, 20))
comprueba("un mensaje, al chat elegido", [("chat-100123", "#peticion Titulo 20 (2024) · Película\nhttps://www.themoviedb.org/movie/20")], tg.enviados)
comprueba("otra cuenta pidiendo lo mismo se suma", {"estado": "enviada", "ya_pedida": True}, pedir(2, 20))
comprueba("sin mandar otro mensaje", 1, len(tg.enviados))
comprueba("sumarse no cuenta para el limite", 0, base.mandadas.get(2, 0))
comprueba("la serie y la pelicula con el mismo id son dos peticiones",
          {"estado": "enviada", "ya_pedida": False}, pedir(1, 20, "series"))

comprueba("con caratula sale como foto, a 500 px", "https://image.tmdb.org/t/p/w500/p20.jpg", tg.fotos[0])

print("\nLa caratula")
fotos = len(tg.fotos)
pedir(9, 61, admin=True)
comprueba("sin caratula sale solo el texto", fotos, len(tg.fotos))
tg.sin_fotos = True
pedir(9, 62, admin=True)
comprueba("si Telegram no acepta la foto, sale el texto igualmente",
          "#peticion Titulo 62 (2024) · Película\nhttps://www.themoviedb.org/movie/62", tg.enviados[-1][1])
comprueba("y la peticion queda enviada", "enviada", base.peticiones[(62, "movie")]["estado"])
tg.sin_fotos = False

print("\nEl limite")
pedir(1, 30)
escritos = len(tg.enviados)
comprueba("con tres hoy, la cuarta no sale", 429, pedir(1, 40)[1])
comprueba("y no se ha escrito nada", escritos, len(tg.enviados))
comprueba("el admin no tiene limite", {"estado": "enviada", "ya_pedida": False}, pedir(1, 40, admin=True))

print("\nCuando Telegram falla")
tg.romper = "CHAT_WRITE_FORBIDDEN"
r = pedir(3, 50)
comprueba("se dice que no ha salido", 502, r[1])
comprueba("con el motivo de Telegram", True, "CHAT_WRITE_FORBIDDEN" in r[2])
comprueba("queda apuntada como fallida", "fallida", base.peticiones[(50, "movie")]["estado"])
comprueba("sin nadie esperando algo que no salio", False, any(u == 3 for (_, u) in base.esperan))
comprueba("y no cuenta para el limite", 0, base.mandadas.get(3, 0))
tg.romper = None
comprueba("el siguiente que la pide la vuelve a intentar", {"estado": "enviada", "ya_pedida": False}, pedir(3, 50))
comprueba("y ya esta enviada", "enviada", base.peticiones[(50, "movie")]["estado"])

print("\nCuando llega")
base.catalogo.add((20, "movie"))
asyncio.run(s.repasar())
comprueba("se avisa a las dos cuentas que la esperaban",
          [(1, "Titulo 20 ya se puede ver o descargar", "movie"),
           (2, "Titulo 20 ya se puede ver o descargar", "movie")], sorted(avisos))
comprueba("queda conseguida", "conseguida", base.peticiones[(20, "movie")]["estado"])
avisos.clear()
asyncio.run(s.repasar())
comprueba("la siguiente pasada no vuelve a avisar", [], avisos)
comprueba("la serie con el mismo id sigue esperando", "enviada", base.peticiones[(20, "tv")]["estado"])

print("\nUna serie avisa una vez, no por capitulo")
avisos.clear()
base.catalogo.add((20, "tv"))          # llega el primer capitulo
asyncio.run(s.repasar())
comprueba("al llegar el primer capitulo, un aviso", [(1, "Titulo 20 ya se puede ver o descargar", "series")], avisos)
avisos.clear()
for _ in range(3):                     # van llegando mas capitulos
    asyncio.run(s.repasar())
comprueba("los capitulos siguientes no vuelven a avisar", [], avisos)

print(f"\n{total - len(fallos)} correctas, {len(fallos)} fallidas")
sys.exit(1 if fallos else 0)
