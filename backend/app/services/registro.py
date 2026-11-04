"""Las ultimas lineas del log, en memoria, para Admin -> Registros.

`/api/logs` leia de `journalctl`, que solo existe con systemd. En Docker (o
sea, en Coolify, que es donde vive el servidor) no hay, y la seccion
Registros salia vacia siempre: el log solo se podia ver entrando por SSH con
`docker logs`. Asi que, ademas de por la salida de siempre, cada linea se
guarda aqui: las ultimas `LINEAS`, que se pierden al reiniciar (para lo de
antes sigue estando `docker logs`).
"""
import collections
import logging

LINEAS = 3000

_lineas: collections.deque = collections.deque(maxlen=LINEAS)


class _EnMemoria(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            _lineas.append(self.format(record))
        except Exception:
            pass


def instalar(formato: logging.Formatter) -> None:
    """Engancha el registro en memoria al logger raiz, con el mismo formato
    que la salida normal."""
    h = _EnMemoria()
    h.setFormatter(formato)
    logging.getLogger().addHandler(h)


def ultimas(n: int) -> list[str]:
    return list(_lineas)[-max(1, n):]
