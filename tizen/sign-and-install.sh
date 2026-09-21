#!/usr/bin/env bash
# Firma e instala la app Tizen en tu Samsung TV.
# Requisitos:
#   - Cuenta de Samsung Developer (free) -> https://account.samsung.com
#   - TV en modo desarrollador con la IP de este ordenador
#   - Tizen Studio CLI instalado (~/tizen-studio)
set -euo pipefail

TIZEN="$HOME/tizen-studio/tools/ide/bin/tizen"
TV_IP="${TV_IP:-192.168.1.44}"       # IP de la TV (cambia con: TV_IP=xxx ./sign-and-install.sh)
DUID="${DUID:-XTCIFS3M7IBOA}"        # DUID de tu TV
PROFILE="MoviesChill"

echo "==> Verificando certificados Samsung..."
CERT_DIR="$HOME/tizen-studio-data/SamsungCertificate/$PROFILE"
AUTHOR_P12="$CERT_DIR/author.p12"
DIST_P12="$CERT_DIR/distributor.p12"
PASSWORD_FILE="$HOME/.samsung-tv-cert-password"

if [ ! -f "$AUTHOR_P12" ] || [ ! -f "$DIST_P12" ]; then
  echo ""
  echo "No hay certificados Samsung. Se abrirá el navegador para que inicies sesión"
  echo "con tu cuenta de Samsung Developer (gratuita)."
  echo ""
  npx --yes samsung-tv-cert --duid "$DUID" --profile "$PROFILE" --name "ElPlaton" --org "MoviesAndChill" || true
fi

PASSWORD="$(cat "$PASSWORD_FILE" 2>/dev/null || echo "")"
if [ -z "$PASSWORD" ]; then
  echo "Error: no se encontró el fichero de contraseña ($PASSWORD_FILE)"
  exit 1
fi

echo "==> Registrando perfil de seguridad..."
"$TIZEN" security-profiles add -n "$PROFILE" -A \
  -a "$AUTHOR_P12" -p "$PASSWORD" \
  -d "$DIST_P12" -dp "$PASSWORD" \
  -dc "$HOME/tizen-studio-data/samsung-ca/vd_tizen_dev_public2.crt" \
  -c  "$HOME/tizen-studio-data/samsung-ca/vd_tizen_dev_author_ca.cer" 2>&1 | tail -5

echo "==> Firma del paquete..."
"$TIZEN" cli-config "profiles.path=$HOME/tizen-studio-data/profile/profiles.xml" 2>&1 | tail -1
"$TIZEN" package -t wgt -s "$PROFILE" -- MoviesChill.wgt 2>&1 | tail -3

echo "==> Conectando a la TV ($TV_IP)..."
"$HOME/tizen-studio/tools/sdb" connect "$TV_IP:26101" 2>&1 | tail -2

echo "==> Instalando en la TV..."
"$TIZEN" install -n MoviesChill.wgt -s "$TV_IP:26101" 2>&1 | tail -20

echo ""
echo "✅ Instalado. Para arrancar la app:"
echo "   $TIZEN run -p MCchill026.MoviesChill -s $TV_IP:26101"
