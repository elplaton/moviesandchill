#!/usr/bin/env bash
# Empaqueta la app de TV para LG (webOS). Compila el mismo codigo de ../tizen
# con el modo "webos" y genera MoviesChill.ipk listo para ares-install.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Compilando (modo webos, mismo codigo que tizen/)..."
( cd ../tizen && npm run build -- --mode webos --outDir ../webos/dist --emptyOutDir >/dev/null )

echo "==> Añadiendo appinfo.json e iconos..."
cp appinfo.json dist/
cp icons/icon.png icons/largeIcon.png dist/

echo "==> Empaquetando .ipk..."
rm -f MoviesChill.ipk com.moviesandchill.tv_*.ipk
( cd ../tizen && npx ares-package ../webos/dist -o ../webos >/dev/null )
mv com.moviesandchill.tv_*.ipk MoviesChill.ipk

echo ""
echo "OK: webos/MoviesChill.ipk"
