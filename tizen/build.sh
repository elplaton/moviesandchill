#!/usr/bin/env bash
# Build para app Tizen (Samsung TV)
# Genera MoviesChill.wgt listo para instalar con sdb en modo desarrollador.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Compilando frontend (modo tizen)..."
npm run build -- --mode tizen

echo "==> Preparando paquete .wgt..."
rm -rf .wgt-staging MoviesChill.wgt
mkdir -p .wgt-staging

# Copia el build y los archivos Tizen a la raíz del paquete
cp -R dist/* .wgt-staging/
cp config.xml .wgt-staging/
cp -R icons .wgt-staging/

echo "==> Empaquetando..."
(
  cd .wgt-staging
  zip -r ../MoviesChill.wgt . > /dev/null
)

rm -rf .wgt-staging

echo ""
echo "✅ Generado MoviesChill.wgt"
echo ""
echo "Instalación en la TV:"
echo "  1. Activa Modo Desarrollador en la TV (Apps -> Configuración -> Modo desarrollador)"
echo "  2. sdb connect <IP_DE_LA_TV>"
echo "  3. sdb install MoviesChill.wgt"
