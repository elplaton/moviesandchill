# Movies & Chill — PWA de móvil

App web progresiva pensada para el teléfono. Se sirve desde el mismo nginx que la web de escritorio, bajo **`/m/`**, y un teléfono que abra la raíz se redirige aquí solo (con `/?desktop=1` se fuerza la web completa).

## Pantallas

- **Inicio**: destacado grande, "Continuar viendo" y los carriles del servidor.
- **Buscar**: teclado del sistema, resultados según se escribe agrupados en series y películas.
- **Ficha** (`/m/t/series/:tmdbId` o `/m/t/movie/:tmdbId`): fondo, datos, temporadas como chips, episodios/versiones con **Descargar / progreso / Ver / Borrar**. Solo quien descargó algo (o un admin) puede borrarlo; si lo bajó otra cuenta se indica y no se puede repetir la descarga.
- **Reproductor**: `<video>` nativo con controles del sistema (en iPhone abre el reproductor de iOS: pantalla completa, AirPlay, PiP). Guarda la posición y reanuda.
- **Descargas**: en curso (con progreso en vivo y pausar/cancelar), pausadas y lo que hay en el servidor, con filtro "Mío" y la barra de cuota.
- **Perfil**: espacio usado, cambiar contraseña, instalar como app, cerrar sesión.
- **Admin** (solo administradores): cuentas y cuotas, descargas de todos, canales de Telegram e interruptores del servidor.

## Instalar como app

- iPhone: Safari → Compartir → **Añadir a pantalla de inicio**.
- Android: Chrome → menú → **Instalar aplicación**.

`manifest.webmanifest` y `sw.js` (cachea el armazón; la API y el vídeo van siempre a la red) están en `public/`.

## Vídeo en iPhone

Safari no reproduce MKV. El backend convierte cada descarga a **MP4 (H.264/AAC)**; lo que ya estaba en MKV se reempaqueta desde *Administración → Descargas → Convertir biblioteca*.

## Desarrollo

```bash
cd mobile && npm install && npm run dev     # http://localhost:5175/m/  (proxy /api → :8000)
npm run build                                # dist/ (lo copia el Dockerfile de frontend a /m)
```

La imagen `frontend` se construye desde la raíz del repo (`docker-compose.yml`) para incluir esta carpeta.
