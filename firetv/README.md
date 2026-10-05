# Movies&Chill para Fire TV

Fire OS es Android, así que aquí la app es un APK. Como en `webos/`, esto es
**solo el empaquetado**: el código de la interfaz vive en `tizen/src` y es
exactamente el mismo que corre en los televisores Samsung y LG. Lo que hay en
esta carpeta es una `Activity` con un `WebView` a pantalla completa y los
scripts para construir e instalar.

## Construir

```bash
./build.sh            # genera MoviesChill.apk
```

Necesita el Android SDK. Vive en el disco externo (`/Volumes/Sandisk/android-sdk`)
para no ocupar el disco del Mac; si lo tienes en otro sitio:

```bash
ANDROID_HOME=/ruta/al/sdk ./build.sh
```

No usa Gradle a propósito. La app no tiene dependencias, así que sale más
rápido y con menos piezas llamando directamente a `aapt2`, `javac`, `d8` y
`apksigner`. Tampoco hace falta Android Studio.

## Instalar en el Fire TV

En el Fire TV, una vez: **Ajustes → Mi Fire TV → Opciones de desarrollador →
Depuración ADB: Activada**. Apunta la IP en *Ajustes → Mi Fire TV → Acerca de
→ Red*.

```bash
FIRETV_IP=192.168.1.50 ./deploy.sh
```

La primera vez el Fire TV pregunta en pantalla si autoriza este ordenador:
hay que aceptar con el mando.

## Cosas que conviene saber

- **A qué servidor habla**: `tizen/.env.firetv`. Apunta a la IP local y no al
  dominio público porque una película son varios GB y no tiene sentido
  sacarlos a internet para devolverlos a la misma casa. Por eso el manifest
  lleva `usesCleartextTraffic`: sin él Android bloquea el `http`.
- **El botón Atrás** del mando no llega al WebView como un `keydown`: se lo
  queda la Activity. Se reenvía a la web con `window.__tvBack()`, que ya sabe
  si toca cerrar un panel, retroceder o salir.
- **Salir de la app** no lo puede hacer la web sola: `window.close()` no cierra
  una Activity. Se expone el puente `AndroidTV.exit()`, que llama a `finish()`.
- **La firma** se guarda en `~/.moviesandchill-firetv.keystore`. Conviene no
  perderla: si cambia, el Fire TV obliga a desinstalar antes de actualizar, y
  con ello se pierde la sesión iniciada.
- **`LEANBACK_LAUNCHER`** en el manifest es lo que hace que la app salga en la
  fila de aplicaciones del Fire TV; sin él se instala pero no aparece. Y
  `touchscreen required="false"` porque un Fire Stick no tiene pantalla táctil.
- **Objetivo de compilación**: Chromium 68, igual que webOS. Los Fire TV Stick
  anteriores a 2023 (Fire OS 7) montan un WebView por Chromium 70.
- **La interfaz no se carga con `file://`.** Vite empaqueta el bundle como
  módulo ES, y un módulo se descarga con las reglas de CORS: desde `file://`
  (origen opaco) el WebView bloquea su propio script y la pantalla se queda en
  negro sin ningún error. `MainActivity` sirve los assets del APK bajo
  `http://appassets.androidplatform.net` interceptando las peticiones. Si se
  toca eso, cuidado con el MIME: un `.js` que no llegue como `text/javascript`
  no se ejecuta como módulo.
- **Los iconos van con calificador de densidad.** Un PNG en `res/drawable/` a
  secas cuenta como mdpi y en los 320 dpi del Stick se escala al doble, con lo
  que el lanzador solo enseña una esquina. Las originales están en `art/` y las
  versiones por densidad se regeneran con `sips` (banner 320×180 en xhdpi,
  icono 96×96).

## Depurar

`adb screencap` **siempre sale negro**: el WebView de Amazon compone sobre un
SurfaceView y la captura solo recoge el fondo de la ventana. No es señal de que
la app esté en blanco.

La app deja activada la depuración remota, así que se puede hablar con ella por
el protocolo de Chrome:

```bash
SDK=/Volumes/Sandisk/android-sdk
PID=$("$SDK/platform-tools/adb" -s 192.168.1.42:5555 shell pidof com.moviesandchill.tv | tr -d '\r')
"$SDK/platform-tools/adb" -s 192.168.1.42:5555 forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s http://localhost:9222/json     # URL y socket de la página
```

Con eso se abre `chrome://inspect` desde el Mac, o se evalúa JavaScript y se
saca una captura de verdad (`Page.captureScreenshot`). Los `console.log` de la
interfaz salen además en logcat:

```bash
adb -s 192.168.1.42:5555 logcat -s MoviesChill:V
```
