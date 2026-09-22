#!/usr/bin/env bash
# Compila, instala y arranca la app en una tele LG (webOS). Un solo comando.
#
#   ./deploy.sh                  despliegue completo
#   TV_IP=192.168.1.50 ./deploy.sh
#   ./deploy.sh --no-launch      instala pero no arranca
#   ./deploy.sh --setup          registra la tele en el CLI (pide la clave de Developer Mode)
#
# Requisitos en la tele: app "Developer Mode" de LG instalada, sesion iniciada
# con la cuenta de desarrollador de LG, Dev Mode ON y "Key Server" ON.
set -euo pipefail
cd "$(dirname "$0")"

TV_IP="${TV_IP:-192.168.1.47}"
TV_NAME="lgtv"
APP_ID="com.moviesandchill.tv"
ARES="npx --prefix ../tizen"

LAUNCH=1
SETUP=0
for arg in "$@"; do
  case "$arg" in
    --no-launch) LAUNCH=0 ;;
    --setup) SETUP=1 ;;
    *) echo "Opcion desconocida: $arg"; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

[ -d ../tizen/node_modules/@webos-tools ] || die "falta el CLI de webOS: cd ../tizen && npm install"

echo "==> Comprobando la TV en $TV_IP..."
if ! nc -z -G 3 "$TV_IP" 9922 2>/dev/null; then
  if ping -c 1 -W 2000 "$TV_IP" >/dev/null 2>&1; then
    die "la TV responde pero tiene cerrado el puerto 9922 (SSH de Developer Mode).
     Abre la app Developer Mode en la tele y comprueba que Dev Mode y Key Server estan ON."
  fi
  die "la TV no responde en $TV_IP. Comprueba la IP (el DHCP la cambia)."
fi

if [ "$SETUP" = "1" ] || ! $ARES ares-setup-device --list 2>/dev/null | grep -q "$TV_NAME"; then
  echo "==> Registrando la TV como '$TV_NAME' (te pedira la passphrase de la app Developer Mode)..."
  $ARES ares-setup-device --add "$TV_NAME" --info "{\"host\":\"$TV_IP\",\"port\":\"9922\",\"username\":\"prisoner\"}" >/dev/null
  $ARES ares-novacom --device "$TV_NAME" --getkey
fi

BACKEND="$(grep -m1 '^VITE_API_BASE=' ../tizen/.env.webos 2>/dev/null | cut -d= -f2- || echo '?')"
echo "    backend que se compilara: $BACKEND"
if ! curl -s -m 3 -o /dev/null "$BACKEND/health"; then
  echo "    AVISO: $BACKEND no responde. La app se instalara pero no podra conectar."
fi

./build.sh

echo "==> Instalando..."
$ARES ares-install --device "$TV_NAME" MoviesChill.ipk

if [ "$LAUNCH" = "1" ]; then
  echo "==> Arrancando..."
  $ARES ares-launch --device "$TV_NAME" "$APP_ID"
fi

echo "OK. App desplegada en $TV_IP."
