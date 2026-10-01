#!/usr/bin/env bash
# Empaqueta la app de TV para Fire TV (Fire OS = Android). Compila el mismo
# codigo de ../tizen con el modo "firetv" y genera MoviesChill.apk.
#
# No usa Gradle a proposito: la app es una Activity sin dependencias, asi que
# sale mas rapido y con menos piezas llamando directamente a las herramientas
# del SDK (aapt2, d8, apksigner). Tampoco hace falta Android Studio.
set -euo pipefail
cd "$(dirname "$0")"

# El SDK vive en el disco externo para no llenar el disco interno del Mac.
SDK="${ANDROID_HOME:-/Volumes/Sandisk/android-sdk}"
BUILD_TOOLS="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-30/android.jar"
JDK="${JAVA_HOME:-/Users/elplaton/Library/Java/JavaVirtualMachines/corretto-17.0.16/Contents/Home}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -d "$SDK" ]          || die "no encuentro el Android SDK en $SDK.
     Si el disco externo no esta conectado, conectalo. Para usar otro sitio:
     ANDROID_HOME=/ruta/al/sdk ./build.sh"
[ -d "$BUILD_TOOLS" ]  || die "faltan las build-tools 34.0.0 en $SDK"
[ -f "$PLATFORM" ]     || die "falta la plataforma android-30 en $SDK"
[ -d "$JDK" ]          || die "no encuentro el JDK en $JDK"

export JAVA_HOME="$JDK"
PATH="$JDK/bin:$BUILD_TOOLS:$PATH"

rm -rf .build MoviesChill.apk
mkdir -p .build/assets .build/res .build/classes .build/dex

echo "==> Compilando la interfaz (modo firetv, mismo codigo que tizen/)..."
( cd ../tizen && npm run build -- --mode firetv --outDir ../firetv/.build/assets --emptyOutDir >/dev/null )

echo "==> Compilando recursos..."
aapt2 compile --dir res -o .build/res.zip >/dev/null

echo "==> Enlazando el APK base..."
aapt2 link \
  -o .build/base.apk \
  -I "$PLATFORM" \
  --manifest AndroidManifest.xml \
  -A .build/assets \
  --java .build/gen \
  .build/res.zip >/dev/null
mkdir -p .build/gen

echo "==> Compilando el codigo Java..."
mkdir -p .build/gen
javac -source 8 -target 8 -nowarn \
  -bootclasspath "$PLATFORM" \
  -classpath "$PLATFORM" \
  -d .build/classes \
  $(find src .build/gen -name '*.java') 2>&1 | grep -v "bootstrap class path\|source value 8\|target value 8\|deprecat" || true

echo "==> Generando el dex..."
d8 --lib "$PLATFORM" --min-api 22 --output .build/dex $(find .build/classes -name '*.class') >/dev/null 2>&1

echo "==> Montando el APK..."
cp .build/base.apk .build/unsigned.apk
( cd .build/dex && zip -q ../unsigned.apk classes.dex )

echo "==> Alineando y firmando..."
zipalign -f -p 4 .build/unsigned.apk .build/aligned.apk

# Clave de depuracion propia: un APK sin firmar no se instala. Se guarda para
# que las actualizaciones siguientes mantengan la misma firma; si cambiara,
# el Fire TV obligaria a desinstalar antes de actualizar.
KEY="$HOME/.moviesandchill-firetv.keystore"
if [ ! -f "$KEY" ]; then
  echo "    (generando la clave de firma por primera vez)"
  keytool -genkeypair -v -keystore "$KEY" -alias moviesandchill \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass moviesandchill -keypass moviesandchill \
    -dname "CN=Movies and Chill, OU=TV, O=Casa, L=-, S=-, C=ES" >/dev/null 2>&1
fi
apksigner sign --ks "$KEY" --ks-pass pass:moviesandchill --key-pass pass:moviesandchill \
  --out MoviesChill.apk .build/aligned.apk
apksigner verify MoviesChill.apk >/dev/null

rm -rf .build
echo ""
echo "OK: firetv/MoviesChill.apk  ($(du -h MoviesChill.apk | cut -f1))"
