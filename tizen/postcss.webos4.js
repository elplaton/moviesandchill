/**
 * Lo que necesita el CSS para las LG con webOS 4 (2018-2019, Chromium 53).
 *
 * Solo lo usan los modos `webos` y `tv-webos` (ver vite.config.ts); el resto
 * de compilaciones siguen con postcss.config.js tal cual.
 *
 * Un navegador que no entiende un valor **descarta la declaración entera**, y
 * uno que no entiende un selector descarta **la regla entera**, así que no se
 * ve "un poco peor": se quedan sin fondo, sin borde y sin el anillo del foco,
 * y los botones con el gris por defecto del navegador.
 *
 * - `rgb(20 20 20 / var(--tw-bg-opacity, 1))`, la sintaxis de color con
 *   espacios (Chrome 65), pasa a `rgba(20, 20, 20, ...)`. Va en casi todos
 *   los colores de Tailwind. esbuild sabe bajarla, pero no cuando lleva un
 *   `var()` dentro ni dentro de una variable CSS, que es justo como la escribe
 *   Tailwind.
 * - `#0000`, el hex de cuatro cifras (Chrome 62), pasa a `transparent`. Es el
 *   valor por defecto de `--tw-ring-*` y `--tw-shadow`, y con él inválido se
 *   cae todo el `box-shadow`, que es como se pinta el foco.
 * - `:where(X)` (Chrome 88) se queda en `X`. Solo sale en el reset de
 *   Tailwind, y el de los botones es el que les quita el fondo gris.
 * - **No hay CSS Grid** (Chrome 57): `display: grid` se descarta y cada hijo
 *   ocupa una fila entera, así que el teclado en pantalla salía como una
 *   columna de 37 teclas. Se rehace con flex y márgenes (tampoco hay `gap` en
 *   flex). Las rejillas son dos: el teclado (6 columnas) y el onboarding (5 u 8).
 */
import postcss from 'postcss';

const COLOR_ESPACIOS = /rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*(var\([^()]*\)|[^()\s]+)\s*\)/g;
const HEX_4_TRANSPARENTE = /#0000(?![0-9a-fA-F])/g;
// Un nivel de paréntesis dentro: `:where(:not([hidden=until-found]))`.
const WHERE = /:where\(((?:[^()]|\([^()]*\))*)\)/g;

const REJILLA_CON_FLEX = `
.grid { display: flex; flex-wrap: wrap; align-items: flex-start; }
.gap-\\[8px\\] { --rejilla-x: 8px; --rejilla-y: 8px; }
.gap-x-6 { --rejilla-x: 24px; }
.gap-y-6 { --rejilla-y: 24px; }
.grid-cols-5 > *, .grid-cols-6 > *, .grid-cols-8 > * {
  margin-right: var(--rejilla-x, 0px);
  margin-bottom: var(--rejilla-y, 0px);
}
.grid-cols-5 > * { width: calc((100% - 4 * var(--rejilla-x, 0px)) / 5); }
.grid-cols-6 > * { width: calc((100% - 5 * var(--rejilla-x, 0px)) / 6); }
.grid-cols-8 > * { width: calc((100% - 7 * var(--rejilla-x, 0px)) / 8); }
.grid-cols-5 > :nth-child(5n), .grid-cols-6 > :nth-child(6n), .grid-cols-8 > :nth-child(8n) {
  margin-right: 0;
}
`;

export default function webos4() {
  return {
    postcssPlugin: 'webos4',
    Declaration(decl) {
      const v = decl.value
        .replace(COLOR_ESPACIOS, 'rgba($1, $2, $3, $4)')
        .replace(HEX_4_TRANSPARENTE, 'transparent');
      if (v !== decl.value) decl.value = v;
    },
    Rule(rule) {
      if (rule.selector.includes(':where(')) rule.selector = rule.selector.replace(WHERE, '$1');
    },
    // Al final de la hoja, para ganar a las utilidades de Tailwind (misma
    // especificidad). Solo donde no hay rejilla: una LG con webOS 5 o más
    // sigue usando la de verdad.
    OnceExit(root) {
      if (!root.source?.input.file?.endsWith('index.css')) return;
      const bloque = postcss.atRule({ name: 'supports', params: 'not (display: grid)' });
      bloque.append(postcss.parse(REJILLA_CON_FLEX).nodes);
      root.append(bloque);
    },
  };
}
webos4.postcss = true;
