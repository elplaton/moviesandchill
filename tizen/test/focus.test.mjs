import * as E from './engine.mjs';

// Elemento falso: al motor solo le hace falta classList y comparar posiciones.
let order = 0;
const mk = () => {
  const classes = new Set();
  const pos = order++;
  return {
    _pos: pos,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    compareDocumentPosition(other) { return other._pos > pos ? 4 : 2; },
  };
};
globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 };

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLO'} ${label}${ok ? '' : `  (esperado ${want}, recibido ${got})`}`);
};

// --- 3 filas de 4 tarjetas, como el Home -----------------------------------
E.registerContainer({ id: 'root', parentId: null, orientation: 'vertical' });
E.pushRoot('root');
for (let r = 0; r < 3; r++) {
  E.registerContainer({ id: `row${r}`, parentId: 'root', index: r, orientation: 'horizontal', el: mk() });
  for (let c = 0; c < 4; c++) {
    E.registerItem({ id: `c${r}-${c}`, parentId: `row${r}`, index: c, el: mk() });
  }
}
E.setFocus('c0-0');

console.log('\nNavegacion en parrilla de filas:');
E.move('right'); check('derecha dentro de la fila', E.getCurrentFocusId(), 'c0-1');
E.move('right'); E.move('right');
check('hasta el final de la fila', E.getCurrentFocusId(), 'c0-3');
E.move('right'); check('tope derecho no se pasa', E.getCurrentFocusId(), 'c0-3');
E.move('down');  check('baja de fila conservando columna', E.getCurrentFocusId(), 'c1-3');
E.move('left'); E.move('left');
check('izquierda en la fila 1', E.getCurrentFocusId(), 'c1-1');
E.move('up');    check('memoria de fila al subir', E.getCurrentFocusId(), 'c0-3');
E.move('down');  check('memoria de fila al bajar', E.getCurrentFocusId(), 'c1-1');
E.move('up'); E.move('up');
check('tope superior no se pasa', E.getCurrentFocusId(), 'c0-3');

console.log('\nClase en el DOM (el foco no pasa por React):');
const el = (id) => E.getElement(id);
check('el enfocado la tiene', el('c0-3').classList.contains('is-focused'), true);
check('el anterior no', el('c1-1').classList.contains('is-focused'), false);

console.log('\nEnter:');
let pulsado = null;
E.registerItem({ id: 'c0-3', parentId: 'row0', index: 3, el: el('c0-3'), onEnter: () => { pulsado = 'c0-3'; } });
E.enter(); check('ejecuta la accion del enfocado', pulsado, 'c0-3');

console.log('\nModal que atrapa el foco:');
E.registerContainer({ id: 'modal', parentId: null, orientation: 'vertical' });
E.registerItem({ id: 'm-close', parentId: 'modal', index: 0, el: mk() });
E.registerItem({ id: 'm-ok', parentId: 'modal', index: 1, el: mk() });
E.pushRoot('modal');
E.setFocus('m-close');
E.move('down'); check('se mueve dentro del modal', E.getCurrentFocusId(), 'm-ok');
E.move('down'); check('no se escapa por abajo', E.getCurrentFocusId(), 'm-ok');
E.move('up'); E.move('up');
check('no se escapa por arriba', E.getCurrentFocusId(), 'm-close');
E.popRoot('modal');
check('al cerrar vuelve donde estaba', E.getCurrentFocusId(), 'c0-3');

console.log('\nRejilla (teclado en pantalla, 6 columnas):');
E.registerContainer({ id: 'kb', parentId: null, orientation: 'grid', columns: 6 });
for (let i = 0; i < 36; i++) E.registerItem({ id: `k${i}`, parentId: 'kb', index: i, el: mk() });
E.pushRoot('kb');
E.setFocus('k0');
E.move('right'); check('A -> B', E.getCurrentFocusId(), 'k1');
E.move('down');  check('B -> H (una fila abajo)', E.getCurrentFocusId(), 'k7');
E.move('up');    check('H -> B', E.getCurrentFocusId(), 'k1');
E.move('left');  check('B -> A', E.getCurrentFocusId(), 'k0');
E.move('left');  check('borde izquierdo', E.getCurrentFocusId(), 'k0');

console.log('\nDesmontar lo enfocado (virtualizacion):');
E.setFocus('k35');
E.unregister('k35');
check('reubica el foco en algo vivo', E.getCurrentFocusId() !== null && E.getCurrentFocusId() !== 'k35', true);

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
