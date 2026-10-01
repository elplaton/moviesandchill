#!/usr/bin/env bash
# Compila, instala y arranca la app en un Fire TV. Un solo comando.
#
#   FIRETV_IP=192.168.1.50 ./deploy.sh
#   ./deploy.sh --no-launch     instala pero no arranca
#   ./deploy.sh --no-build      instala el APK que ya hay
set -euo pipefail
cd "$(dirname "$0")"

FIRETV_IP="${FIRETV_IP:-}"
SDK="${ANDROID_HOME:-/Volumes/Sandisk/android-sdk}"
ADB="$SDK/platform-tools/adb"
APP_ID="com.moviesandchill.tv"

LAUNCH=1
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-launch) LAUNCH=0 ;;
    --no-build) BUILD=0 ;;
    *) echo "Opcion desconocida: $arg"; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

[ -x "$ADB" ] || die "no encuentro adb en $ADB (¿esta conectado el disco externo?)"
[ -n "$FIRETV_IP" ] || die "falta la IP del Fire TV.
     La tienes en Ajustes > Mi Fire TV > Acerca de > Red.
     Uso: FIRETV_IP=192.168.1.50 ./deploy.sh"

# El puerto 5555 solo esta abierto con la depuracion ADB activada. Conviene
# distinguirlo de "no hay nadie en esa IP" para no dar un error opaco.
echo "==> Comprobando el Fire TV en $FIRETV_IP..."
if ! nc -z -G 3 "$FIRETV_IP" 5555 2>/dev/null; then
  if ping -c 1 -W 2000 "$FIRETV_IP" >/dev/null 2>&1; then
    die "el Fire TV responde pero tiene cerrado el puerto 5555.
     Activa Ajustes > Mi Fire TV > Opciones de desarrollador > Depuracion ADB."
  fi
  die "nada responde en $FIRETV_IP. Comprueba la IP (el DHCP la cambia)."
fi

if [ "$BUILD" = "1" ]; then
  ./build.sh
fi
[ -f MoviesChill.apk ] || die "no hay MoviesChill.apk (lanza ./build.sh)"

echo "==> Conectando..."
"$ADB" connect "$FIRETV_IP:5555" | tail -1
"$ADB" devices | grep -q "$FIRETV_IP" \
  || die "adb no consigue conectar. La primera vez el Fire TV pregunta en
     pantalla si autorizas este ordenador: acepta y vuelve a intentarlo."

echo "==> Instalando..."
# -r reinstala conservando los datos (la sesion sigue iniciada).
"$ADB" -s "$FIRETV_IP:5555" install -r MoviesChill.apk 2>&1 | tail -2

if [ "$LAUNCH" = "1" ]; then
  echo "==> Arrancando..."
  "$ADB" -s "$FIRETV_IP:5555" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi

echo ""
echo "OK. App instalada en $FIRETV_IP."
echo "    Sale en Aplicaciones del Fire TV; para fijarla arriba, Menu > Mover."
