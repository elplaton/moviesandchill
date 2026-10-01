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
