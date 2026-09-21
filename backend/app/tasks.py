import asyncio
import logging

logger = logging.getLogger("tmd")

# asyncio solo guarda referencias debiles a las tareas: sin esto el recolector
# de basura puede cancelar una indexacion a medias.
_pending: set[asyncio.Task] = set()


def spawn(coro, name: str) -> asyncio.Task:
    """Lanza una tarea de fondo registrando cualquier excepcion.

    asyncio.create_task() a secas se traga los errores hasta que el recolector
    de basura avisa, lo que ocultaba fallos de indexacion durante horas.
    """
    task = asyncio.create_task(coro, name=name)
    _pending.add(task)

    def _done(t: asyncio.Task):
        _pending.discard(t)
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.error("Tarea de fondo '%s' fallo: %s", name, exc, exc_info=exc)

    task.add_done_callback(_done)
    return task
