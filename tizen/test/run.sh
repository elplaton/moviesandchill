#!/bin/sh
# Pruebas sin navegador: se compila el modulo a probar con esbuild y se ejecuta
# con node (el motor de foco contra elementos simulados, la deteccion de
# plataforma contra los user agents de cada aparato).
set -e
cd "$(dirname "$0")/.."
npx esbuild src/focus/engine.ts --bundle --format=esm --outfile=test/engine.mjs --log-level=error
node test/focus.test.mjs
rm -f test/engine.mjs

npx esbuild src/tv/platform.ts --bundle --format=esm --outfile=test/platform.mjs --log-level=error
node test/platform.test.mjs
rm -f test/platform.mjs
