/**
 * Lo que le falta al WebKit de la PlayStation 4.
 *
 * El objetivo de compilacion (`safari11` en el modo ps4) arregla la sintaxis,
 * pero no añade metodos: esbuild transpila `?.` y no inventa `flatMap`, que
 * llego en Safari 12. La biblioteca lo usa para juntar los nombres de los
 * episodios, y sin esto la pantalla de Descargas se queda en blanco con un
 * TypeError en la consola de la consola, donde nadie va a mirar.
 *
 * Van siempre, no solo en el paquete de la PS4: en un navegador que ya los
 * trae esto no toca nada, y asi no hay un paquete distinto por aparato.
 */
type Fn = (valor: unknown, indice: number, lista: unknown[]) => unknown;

function aplanar(lista: unknown[], profundidad: number): unknown[] {
  const salida: unknown[] = [];
  for (let i = 0; i < lista.length; i++) {
    const v = lista[i];
    if (profundidad > 0 && Array.isArray(v)) {
      const dentro = aplanar(v as unknown[], profundidad - 1);
      for (let j = 0; j < dentro.length; j++) salida.push(dentro[j]);
    } else {
      salida.push(v);
    }
  }
  return salida;
}

const proto = Array.prototype as unknown as Record<string, unknown>;

if (typeof proto.flat !== 'function') {
  proto.flat = function flat(this: unknown[], profundidad = 1): unknown[] {
    return aplanar(this, profundidad);
  };
}

if (typeof proto.flatMap !== 'function') {
  proto.flatMap = function flatMap(this: unknown[], fn: Fn, thisArg?: unknown): unknown[] {
    return aplanar(this.map(fn, thisArg), 1);
  };
}

export {};
