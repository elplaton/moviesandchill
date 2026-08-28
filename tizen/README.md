# Movies & Chill — App Tizen (Samsung TV)

App para Samsung TV que usa el backend de `moviesandchill` como servidor de streaming.

## Requisitos

- Samsung TV con Tizen (2018+ recomendado)
- El Docker de `moviesandchill` corriendo en un ordenador en la misma red local
- [Tizen Studio](https://developer.tizen.org/) instalado (para el `sdb`)

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

1. En la TV: **Configuración → Apps → Modo desarrollador** → activar y anotar la IP de la TV.
2. Desde el ordenador:
   ```bash
   sdb connect <IP_DE_LA_TV>
   sdb install MoviesChill.wgt
   ```
3. La app aparece en el menú de Apps de la TV.

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
