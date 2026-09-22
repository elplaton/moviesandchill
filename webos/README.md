# Movies & Chill — App para LG (webOS)

Es **la misma app que `../tizen`**: mismo código, mismas pantallas, mismo mando. Aquí solo vive el empaquetado para webOS (`appinfo.json`, iconos y los scripts que generan e instalan el `.ipk`). Cualquier cambio de interfaz se hace en `tizen/src` y sale en las dos teles.

## Requisitos

- Tele LG con webOS 5 o superior (2020+). Se compila para Chromium 68, el de webOS 5.
- El backend de `moviesandchill` accesible desde la tele por la red local.
- Node instalado. El CLI de webOS (`@webos-tools/cli`) se instala como dependencia de `../tizen` con `npm install`; no hace falta nada global.

## Preparar la tele (una vez)

1. Instala la app **Developer Mode** desde la LG Content Store e inicia sesión con una cuenta de desarrollador de LG (gratuita, en <https://webostv.developer.lge.com>).
2. En Developer Mode: **Dev Mode Status → ON** y **Key Server → ON**. Apunta la IP de la tele y la *passphrase* que enseña.
3. Desde el ordenador: `TV_IP=<ip de la tele> ./deploy.sh --setup` — registra la tele en el CLI y te pide esa passphrase.

> Developer Mode caduca a los 50 días si no se renueva desde la propia app ("Extend").

## Configurar el servidor

Edita `../tizen/.env.webos`:

```
VITE_API_BASE=http://192.168.1.46:8000
```

## Compilar

```bash
./build.sh          # genera webos/MoviesChill.ipk
```

## Instalar y arrancar

```bash
./deploy.sh                      # compila, instala y arranca
TV_IP=192.168.1.50 ./deploy.sh
./deploy.sh --no-launch
```

## Diferencias con Tizen que ya están resueltas en el código

- **Atrás**: `appinfo.json` lleva `disableBackHistoryAPI: true` para que la tecla BACK (código 461) llegue a la app en vez de navegar el historial.
- **Salir**: en webOS se cierra con `window.close()`; en Tizen con `tizen.application.exit()`.
- **Magic Remote**: es un puntero de verdad y se dibuja como cursor CSS, así que no se oculta; pasar por encima de una carátula, botón o tecla la enfoca, igual que con las flechas.
- **`gap` en flex**: webOS 5/6 (Chromium 68/79) no lo soporta; la app usa márgenes (`space-x`/`space-y`).
- **Vídeo**: se reproduce con `<video>` HTML5 (H.264/AAC, que es a lo que convierte el backend). Los MKV los admiten los webOS de 2018 en adelante.
