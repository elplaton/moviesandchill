"""Entrar en la tele con el movil: el codigo que enseña la tele y su aprobacion.

Teclear usuario y contraseña con las flechas del mando es lo mas tedioso de
toda la app, y en una tele se hace a menudo: cada aparato nuevo, cada vez que
caduca la sesion y cada vez que la interfaz cambia de origen. Asi que la tele
pide un codigo, lo enseña como QR y el movil —donde la sesion ya esta abierta,
y donde el gestor de contraseñas teclea por ti— lo aprueba. Es el mismo baile
que hacen Netflix o YouTube en una tele.

Hay **dos codigos** y no son intercambiables:

- `codigo` es el que se ve: seis letras en el QR y escritas debajo, para quien
  prefiera teclearlo en la app del movil. Es corto a proposito y por eso
  **no da acceso a nada**: con el solo se puede *aprobar* desde una cuenta ya
  abierta, y aprobar el de otro solo sirve para meterle a el en tu cuenta.
- `secreto` solo lo conoce la tele, y es con lo que pregunta si ya la han
  aprobado. Es el que recibe los tokens, asi que es largo y no se enseña.

Los tokens se entregan **una sola vez**: la primera pregunta despues de
aprobar se los lleva y el codigo se olvida. Todo caduca a los cinco minutos.

Vive en memoria y no en la base de datos: es efimero por definicion, el
backend corre en un solo proceso y, si se reinicia a mitad, lo peor que pasa
es que la tele pide un codigo nuevo (lo hace sola al ver que ha caducado).
"""
import secrets
import time
from dataclasses import dataclass

DURACION_S = 5 * 60
# Sin letras que se confundan al leerlas en la tele (0/O, 1/I/L).
ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LARGO_CODIGO = 6
# Tope de codigos vivos: pedir uno no exige sesion, asi que sin limite
# cualquiera podria llenar la memoria pidiendo codigos en bucle.
MAX_PENDIENTES = 200


@dataclass
class Pendiente:
    codigo: str
    secreto: str
    aparato: str
    caduca: float
    usuario: str | None = None
    rechazado: bool = False


_por_secreto: dict[str, Pendiente] = {}
_por_codigo: dict[str, Pendiente] = {}


def _ahora() -> float:
    return time.monotonic()


def _podar(ahora: float) -> None:
    for p in [p for p in _por_secreto.values() if p.caduca <= ahora]:
        _olvidar(p)


def _olvidar(p: Pendiente) -> None:
    _por_secreto.pop(p.secreto, None)
    _por_codigo.pop(p.codigo, None)


def normalizar(codigo: str) -> str:
    """Lo que se teclea en el movil: sin espacios ni guiones, en mayusculas."""
    return "".join(c for c in (codigo or "").upper() if c.isalnum())


def crear(aparato: str, ahora: float | None = None) -> Pendiente | None:
    """Un codigo nuevo para una tele. None si ya hay demasiados vivos."""
    ahora = _ahora() if ahora is None else ahora
    _podar(ahora)
    if len(_por_secreto) >= MAX_PENDIENTES:
        return None
    while True:
        codigo = "".join(secrets.choice(ALFABETO) for _ in range(LARGO_CODIGO))
        if codigo not in _por_codigo:
            break
    p = Pendiente(codigo=codigo, secreto=secrets.token_urlsafe(32),
                  aparato=(aparato or "una tele")[:40], caduca=ahora + DURACION_S)
    _por_secreto[p.secreto] = p
    _por_codigo[p.codigo] = p
    return p


def buscar(codigo: str, ahora: float | None = None) -> Pendiente | None:
    """El pendiente de un codigo que se ha escaneado o tecleado, si sigue vivo."""
    ahora = _ahora() if ahora is None else ahora
    _podar(ahora)
    p = _por_codigo.get(normalizar(codigo))
    if not p or p.usuario or p.rechazado:
        return None
    return p


def aprobar(codigo: str, usuario: str, ahora: float | None = None) -> bool:
    p = buscar(codigo, ahora)
    if not p:
        return False
    p.usuario = usuario
    return True


def rechazar(codigo: str, ahora: float | None = None) -> bool:
    p = buscar(codigo, ahora)
    if not p:
        return False
    p.rechazado = True
    return True


def consultar(secreto: str, ahora: float | None = None) -> tuple[str, str | None]:
    """Lo que pregunta la tele: ("pendiente"|"aprobado"|"rechazado"|"caducado", usuario).

    Aprobado o rechazado se contesta **una sola vez**: el pendiente se olvida
    en la misma consulta, asi que los tokens no se pueden recoger dos veces.
    """
    ahora = _ahora() if ahora is None else ahora
    _podar(ahora)
    p = _por_secreto.get(secreto or "")
    if not p:
        return "caducado", None
    if p.usuario:
        _olvidar(p)
        return "aprobado", p.usuario
    if p.rechazado:
        _olvidar(p)
        return "rechazado", None
    return "pendiente", None


def segundos_restantes(p: Pendiente, ahora: float | None = None) -> int:
    ahora = _ahora() if ahora is None else ahora
    return max(0, int(p.caduca - ahora))
