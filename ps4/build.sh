#!/usr/bin/env bash
# Compila la app de TV para el navegador de la PlayStation 4.
#
# No genera ningun paquete porque en una PlayStation no se puede instalar nada:
# la app se sirve por web (nginx la publica en /ps4/) y la consola la abre con
# su navegador. Esto es solo para verla sin levantar Docker.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Compilando (modo ps4, mismo codigo que tizen/, objetivo WebKit)..."
( cd ../tizen && npm run build:ps4 >/dev/null )

echo ""
echo "OK: ps4/dist"
echo ""
echo "Para probarlo en la consola sin Docker, desde esta carpeta:"
echo "  python3 -m http.server 8080 --directory dist"
echo "y en el navegador de la PS4: http://<ip-de-este-equipo>:8080/"
echo ""
echo "Ojo: servido asi, la API no esta en el mismo origen que la pagina."
echo "Compila con VITE_API_BASE=http://<ip-del-servidor> y añade ese origen a"
echo "TMD_CORS_ORIGINS, o prueba contra el nginx de verdad (/ps4/)."
