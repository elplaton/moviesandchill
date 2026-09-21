#!/usr/bin/env bash
# Compila, firma, instala y arranca la app en la TV. Un solo comando.
#
#   ./deploy.sh                 despliegue completo
#   TV_IP=192.168.1.50 ./deploy.sh
#   ./deploy.sh --no-launch     instala pero no arranca
#   ./deploy.sh --debug         arranca con el inspector y deja el puerto listo
#
set -euo pipefail
cd "$(dirname "$0")"

TV_IP="${TV_IP:-192.168.1.44}"
APP_ID="MCchill026.MoviesChill"
PROFILE="MoviesChill"
TIZEN="$HOME/tizen-studio/tools/ide/bin/tizen"
SDB="$HOME/tizen-studio/tools/sdb"
CERT_DIR="$HOME/tizen-studio-data/SamsungCertificate/$PROFILE"

LAUNCH=1
DEBUG=0
for arg in "$@"; do
  case "$arg" in
    --no-launch) LAUNCH=0 ;;
    --debug) DEBUG=1 ;;
    *) echo "Opcion desconocida: $arg"; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

[ -x "$TIZEN" ] || die "no encuentro el CLI de Tizen en $TIZEN"
[ -f "$CERT_DIR/author.p12" ] || die "faltan los certificados Samsung en $CERT_DIR"

# La TV responde al ping aunque este en reposo, pero entonces tiene cerrado el
# puerto de desarrollo. Conviene distinguirlo para no dar un error opaco.
echo "==> Comprobando la TV en $TV_IP..."
if ! nc -z -G 3 "$TV_IP" 26101 2>/dev/null; then
  if ping -c 1 -W 2000 "$TV_IP" >/dev/null 2>&1; then
    die "la TV responde pero tiene cerrado el puerto 26101.
     Suele significar que esta en reposo: enciendela y vuelve a intentarlo.
     Si esta encendida, revisa Modo Desarrollador y que la IP del PC host
     sea $(ipconfig getifaddr en0 2>/dev/null || echo '<ip de este equipo>')."
  fi
  die "la TV no responde en $TV_IP. Comprueba la IP (el DHCP la cambia)."
fi

BACKEND="$(grep -m1 '^VITE_API_BASE=' .env.tizen 2>/dev/null | cut -d= -f2- || echo '?')"
echo "    backend que se compilara: $BACKEND"
if ! curl -s -m 3 -o /dev/null "$BACKEND/health"; then
  echo "    AVISO: $BACKEND no responde. La app se instalara pero no podra conectar."
fi

echo "==> Compilando..."
npm run build -- --mode tizen >/dev/null

echo "==> Empaquetando..."
rm -rf .wgt-staging MoviesChill.wgt
mkdir -p .wgt-staging
cp -R dist/* .wgt-staging/
cp config.xml .wgt-staging/
cp -R icons .wgt-staging/
( cd .wgt-staging && zip -rq ../MoviesChill.wgt . )
rm -rf .wgt-staging

echo "==> Firmando..."
PASSWORD="$(cat "$HOME/.samsung-tv-cert-password" 2>/dev/null)" \
  || die "no encuentro ~/.samsung-tv-cert-password"
"$TIZEN" security-profiles add -n "$PROFILE" -A \
  -a "$CERT_DIR/author.p12" -p "$PASSWORD" \
  -d "$CERT_DIR/distributor.p12" -dp "$PASSWORD" \
  -dc "$HOME/tizen-studio-data/samsung-ca/vd_tizen_dev_public2.crt" \
  -c  "$HOME/tizen-studio-data/samsung-ca/vd_tizen_dev_author_ca.cer" >/dev/null 2>&1
"$TIZEN" cli-config "profiles.path=$HOME/tizen-studio-data/profile/profiles.xml" >/dev/null
"$TIZEN" package -t wgt -s "$PROFILE" -- MoviesChill.wgt 2>&1 | grep -qi "successfully" \
  || die "la firma del paquete ha fallado"

echo "==> Conectando..."
"$SDB" connect "$TV_IP:26101" >/dev/null 2>&1 || true
"$SDB" devices | grep -q "$TV_IP" \
  || die "sdb no consigue conectar. Revisa Modo Desarrollador y la IP del PC host en la TV."

echo "==> Instalando..."
"$TIZEN" install -n MoviesChill.wgt -s "$TV_IP:26101" 2>&1 | grep -qi "successfully installed" \
  || die "la instalacion ha fallado"

if [ "$DEBUG" = "1" ]; then
  echo "==> Arrancando con el inspector..."
  exec ./tools/tv-debug.py --tv "$TV_IP"
elif [ "$LAUNCH" = "1" ]; then
  echo "==> Arrancando..."
  "$TIZEN" run -p "$APP_ID" -s "$TV_IP:26101" 2>&1 | grep -qi "successfully launched" \
    || die "la app no ha arrancado"
fi

echo "OK. App desplegada en $TV_IP."
