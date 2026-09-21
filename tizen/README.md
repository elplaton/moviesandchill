# Movies & Chill — App Tizen (Samsung TV)

App para Samsung TV que usa el backend de `moviesandchill` como servidor de streaming.

## Requisitos

- Samsung TV con Tizen (2018+ recomendado)
- El Docker de `moviesandchill` corriendo en un ordenador en la misma red local
- `sdb` (Samsung Device Bridge) instalado en tu ordenador

## Instalar sdb (solo la primera vez)

En macOS Apple Silicon, el binario standalone es la opción más simple (sin Tizen Studio completo):

```bash
curl -sL -o /opt/homebrew/bin/sdb "https://github.com/PatrickSt1991/tizen-sdb/releases/download/v1.1.3/TizenSdb_v1.1.3_macos-arm64"
chmod +x /opt/homebrew/bin/sdb
```

Verifica:

```bash
sdb
```

> Este es un cliente ligero: los comandos llevan la IP de la TV como argumento (`sdb install <IP_TV> <app.wgt>`), a diferencia del `sdb` oficial de Samsung.

## Configurar la IP del servidor

Edita `.env.tizen` y pon la IP real del ordenador donde corre el Docker:

```
VITE_API_BASE=http://192.168.1.100:80
```

La TV debe poder llegar a esa IP por la red local (misma wifi/cable).

## Compilar

```bash
./build.sh
```

Genera `MoviesChill.wgt`.

## Instalar en la TV

1. En la TV: **Configuración → Apps → Modo desarrollador** → activar y poner la IP de **tu ordenador** (el que corre `sdb`).
2. Reinicia la TV y anota su IP (Ajustes → Red → Estado de red).
3. Desde el ordenador:

   ```bash
   # conectar
   sdb connect <IP_DE_LA_TV>

   # instalar la app
   sdb install <IP_DE_LA_TV> MoviesChill.wgt

   # arrancar la app (id = org.moviesandchill.tv)
   sdb launch <IP_DE_LA_TV> org.moviesandchill.tv
   ```

4. La app aparece en el menú de Apps de la TV.

## Cómo funciona

- La app es un cliente web (React) que habla con el backend por HTTP.
- El backend descarga de Telegram, extrae, y **transcodea a H.264/AAC/MKV** (`_make_compatible` en `download_router.py`) para que todo se reproduzca en la TV.
- La TV solo reproduce por streaming (`/api/stream`), no descarga nada.

## Navegación

Usa el mando de la TV:
- **Flechas** → mover el foco entre tarjetas/filas
- **OK/Enter** → abrir detalle o reproducir
- **Volver** (Return/Back) → cerrar modales/reproductor

## Notas

- La IP `192.168.1.100` es provisional: cámbiala y recompila cuando sepas la real.
- `dist/`, `node_modules/` y `MoviesChill.wgt` están gitignored.
