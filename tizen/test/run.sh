#!/bin/sh
# Prueba el motor de foco sin navegador: se compila engine.ts a un modulo y se
# ejecuta con node contra elementos simulados.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/focus/engine.ts --bundle --format=esm --outfile=test/engine.mjs --log-level=error
node test/focus.test.mjs
rm -f test/engine.mjs
