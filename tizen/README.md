# Movies & Chill — App Tizen (Samsung TV)

App para Samsung TV que usa el backend de `moviesandchill` como servidor de streaming.

> Este mismo código se empaqueta también para **LG (webOS)** desde `../webos` (`./deploy.sh` allí). Los cambios de interfaz se hacen aquí una sola vez.

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

- La app es un cliente web (Preact) que habla con el backend por HTTP.
- El backend descarga de Telegram, extrae, y **transcodea a H.264/AAC/MKV** (`_make_compatible` en `download_router.py`) para que todo se reproduzca en la TV.
- La TV solo reproduce por streaming (`/api/stream`), no descarga nada.

## Pantallas

La interfaz está pensada para verse a tres metros y manejarse solo con el mando. Mide 1920×1080 fijos (en un navegador de escritorio se escala entera para poder revisarla).

- **Rail izquierdo**: Buscar · Inicio · Películas · Series · Descargas · Ajustes. Plegado enseña iconos; al enfocarlo se despliega con etiquetas. Desde la primera tarjeta de un carril, ◀ entra en el rail.
- **Inicio / Películas / Series**: panel de información arriba (fondo, título, año, nota, géneros y sinopsis de la tarjeta enfocada) y carriles debajo. Las tarjetas no llevan texto encima. "Continuar viendo" aparece cuando hay algo a medias.
- **Ficha** (OK sobre una tarjeta): a pantalla completa. Series: temporadas como chips y lista de episodios con nombre de TMDB, calidad, tamaño y estado. Películas: lista de versiones. OK sobre una fila reproduce si está en disco, descarga si no, y si está bajando ofrece pausar o cancelar. Con varias versiones de un episodio se elige en un cuadro.
- **Reproductor**: sin controles nativos. OK pausa, ◀ ▶ saltan 10 s (seguidos: 30, 60, 120), ▲ ▼ enseñan la barra, Atrás sale. Responde a las teclas de reproducción del mando. Guarda la posición y reanuda donde se dejó.
- **Buscar**: teclado en pantalla a la izquierda y resultados a la derecha según se escribe.
- **Descargas**: lo que hay en disco, lo que está bajando (con progreso) y lo pausado.
- **Ajustes**: usuario, servidor, espacio libre, cerrar sesión y salir. Todo lo de administración (canales, configuración, reclasificar) se hace desde la web.

## Navegación

- **Flechas** → mover el foco
- **OK/Enter** → abrir, reproducir o descargar
- **Volver** (Return/Back) → cerrar la ficha o el reproductor; en cualquier pantalla vuelve a Inicio; en Inicio cierra la app

## Notas

- La IP `192.168.1.100` es provisional: cámbiala y recompila cuando sepas la real.
- `dist/`, `node_modules/` y `MoviesChill.wgt` están gitignored.
- Para revisar la interfaz sin tele: `npm run dev` y abrir `http://localhost:5173` (proxy al backend en `:8000`). Las flechas y Enter/Escape del teclado hacen de mando.
