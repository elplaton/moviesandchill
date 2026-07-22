# Telegram Movie Downloader v2

Un servidor web autoalojado para buscar y descargar películas y series desde canales de Telegram. Diseñado para Raspberry Pi, funciona en cualquier Linux.

## Características

- **Búsqueda multicanal** — busca en varios canales de Telegram a la vez
- **Descarga paralela** — hasta 5 descargas simultáneas configurables
- **Extracción automática** — RAR, ZIP, 7z, TAR (incluyendo archivos multiparte `.part1.rar`, `.zip.001`, `.7z.001`)
- **Conversión de audio** — Detecta DTS y convierte a AC3 automáticamente (requiere `ffmpeg` + `mediainfo`)
- **Nombrado inteligente** — Las carpetas se nombran por serie y temporada (`Cape Fear S1`, `Rick y Morty S2`)
- **Pausa y reanudación** — Pausa descargas y reanúdalas más tarde, incluso tras reiniciar el servidor
- **Streaming de vídeo** — Reproduce archivos `.mkv`, `.mp4` directamente desde el navegador o VLC en iPhone
- **Interfaz web** — Panel responsive con tema oscuro, búsqueda, progreso en tiempo real, gestión de archivos
- **Modo desarrollador** — Página de logs en tiempo real vía `journalctl`
- **Configuración web** — Página `/settings` para editar toda la configuración desde el navegador
- **Soporte `.env`** — Variables de entorno para secretos y overrides
- **Paginación real** — Búsqueda paginada contra Telegram, sin límite de resultados
- **Filtro por canal** — Chips de selección de canal en los resultados de búsqueda
- **Gestión visual de canales** — Página `/channels` que lista todos tus canales/grupos de Telegram y permite seleccionarlos
- **Tailscale Funnel** — Acceso remoto desde internet sin abrir puertos

---

## Requisitos

### Sistema (Raspberry Pi / Linux)

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv unrar mediainfo ffmpeg p7zip-full
```

### Python

- Python 3.11+
- Paquetes en `requirements.txt`

### Telegram

- API ID y API Hash de [my.telegram.org/apps](https://my.telegram.org/apps)
- Canal(es) de Telegram donde buscar contenido

---

## Instalación

```bash
# Clonar el repositorio
cd ~
git clone <url-del-repo> telegram-movie-downloader
cd telegram-movie-downloader

# Crear entorno virtual
python3 -m venv venv
source venv/bin/activate

# Instalar dependencias Python
pip install -r requirements.txt

# (Opcional) Configurar variables de entorno
cp .env.example .env
nano .env
```

---

## Configuración

### Método 1: Asistente interactivo

```bash
python main.py setup
```

El asistente te guiará paso a paso:
1. API ID y API Hash de Telegram
2. Número de teléfono asociado a la cuenta
3. Canales de Telegram (puedes añadir varios con nombre descriptivo)
4. Rutas de descarga y extracción
5. Host y puerto del servidor web

### Método 2: Configuración web

Una vez el servidor en marcha, accede a `/settings` para editar toda la configuración desde el navegador. Los cambios se guardan en `config.json` y/o `.env` según corresponda.

### Método 3: Archivo `.env`

Copia `.env.example` a `.env` y edita las variables. Las variables de entorno tienen prioridad sobre `config.json`.

### Estructura de `config.json`

```json
{
  "api_id": 12345678,
  "api_hash": "tu_api_hash",
  "phone": "+34123456789",
  "channels": [
    {"id": -1002229558644, "name": "Películas"},
    {"id": -1001234567890, "name": "Series"}
  ],
  "download_path": "/mnt/usb1/torrent-complete",
  "extract_path": "/mnt/usb1/torrent-complete",
  "server_host": "0.0.0.0",
  "server_port": 8000,
  "delete_archives_after_extract": true,
  "download_parallel": 5,
  "convert_dts_to_ac3": true
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `api_id` | int | API ID de Telegram |
| `api_hash` | string | API Hash de Telegram |
| `phone` | string | Teléfono con prefijo internacional |
| `channels` | array | Lista de `{id, name}` de canales |
| `download_path` | string | Ruta de descarga temporal |
| `extract_path` | string | Ruta de destino final |
| `server_host` | string | IP de escucha (`0.0.0.0` para todas) |
| `server_port` | int | Puerto del servidor web |
| `delete_archives_after_extract` | bool | Borrar ZIPs/RARs tras extraer |
| `download_parallel` | int | Descargas simultáneas (1-8) |
| `convert_dts_to_ac3` | bool | Convertir audio DTS a AC3 |

---

## Uso

### Arrancar el servidor

```bash
source venv/bin/activate
python main.py serve
```

El servidor estará disponible en `http://<ip-raspberry>:8000`.

### Servicio systemd (recomendado para producción)

```bash
sudo tee /etc/systemd/system/telegram-movie.service << 'EOF'
[Unit]
Description=Telegram Movie Downloader
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=adrygll
WorkingDirectory=/home/adrygll/telegram-movie-downloader
ExecStart=/home/adrygll/telegram-movie-downloader/venv/bin/python main.py serve
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable telegram-movie
sudo systemctl start telegram-movie
```

### Acceso remoto con Tailscale Funnel

```bash
# Instalar Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Exponer puerto 8000 a internet
sudo tee /etc/systemd/system/tailscale-funnel.service << 'EOF'
[Unit]
Description=Tailscale Funnel
After=network-online.target
[Service]
ExecStart=/usr/bin/tailscale funnel 8000
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now tailscale-funnel
```

Tu app será accesible en `https://<hostname>.tail<id>.ts.net`.

---

## Uso de la interfaz web

### Página principal (`/`)

1. **Buscar** — Escribe el nombre de una película o serie y pulsa Enter
2. **Filtrar por canal** — Usa los chips `[Todos] [Películas] [Series]` para acotar la búsqueda
3. **Ordenar** — Pulsa "Fecha ▲/▼" para invertir el orden cronológico
4. **Descargar** — Pulsa el botón azul junto al resultado deseado
5. **Progreso** — La barra de progreso se actualiza en tiempo real vía WebSocket
6. **Pausar / Cancelar** — Botones disponibles en cada descarga activa

### Archivos descargados

- Haz clic en una **carpeta** para expandir y ver su contenido
- Archivos de **vídeo** (`.mkv`, `.mp4`): botón ▶ para reproducir en el navegador
- En **iPhone**: los `.mkv` abren VLC automáticamente; los `.mp4` se reproducen en Safari
- Botón **Borrar** para eliminar archivos o carpetas

### Configuración (`/settings`)

- Edita credenciales Telegram, canales, rutas, puerto y comportamiento
- Los campos con badge `.env` se guardan en el archivo `.env`
- El resto se guarda en `config.json`

### Logs (`/dev`)

- Terminal oscura con logs del servicio `telegram-movie`
- Filtro por texto, pausa/reanudar, selector de líneas
- Se actualiza cada 3 segundos

### Canales disponibles (`/channels`)

- Lista **todos** los canales y grupos de tu cuenta de Telegram en tiempo real
- Filtra automáticamente chats privados y bots — solo muestra canales y grupos
- Badges de color: `[Canal]` azul, `[Megagrupo]` morado, `[Grupo]` naranja
- Barra de búsqueda para filtrar por nombre entre cientos de diálogos
- Checkboxes ☑/☐ para activar/desactivar canales
- Los canales activos aparecen en una sección superior fija para confirmar la selección
- Botón "💾 Guardar selección" persiste en `config.json` y `.env`
- Accesible desde Configuración → "Gestionar canales desde Telegram →"

---

## Flujo de descarga

```
Búsqueda → Selección → Descarga (1-5 partes en paralelo)
    │
    ├── Archivo comprimido (.rar/.zip/.7z)
    │   └── Extracción automática → Conversión DTS→AC3 (si aplica)
    │
    └── Archivo de vídeo (.mkv/.mp4)
        └── Conversión DTS→AC3 (si aplica)
             │
             └── Archivo listo en extract_path
```

---

## API REST

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/` | Interfaz web principal |
| `GET` | `/settings` | Página de configuración |
| `GET` | `/dev` | Página de logs |
| `POST` | `/api/search` | Buscar mensajes en canales |
| `POST` | `/api/download` | Iniciar descarga |
| `POST` | `/api/cancel` | Cancelar descarga |
| `POST` | `/api/pause` | Pausar descarga |
| `POST` | `/api/resume` | Reanudar descarga pausada |
| `GET` | `/api/resumable` | Listar descargas pausadas |
| `GET` | `/api/status` | Estado de descargas activas |
| `GET` | `/api/files` | Listar archivos descargados |
| `DELETE` | `/api/files` | Eliminar archivo/carpeta |
| `GET` | `/api/stream` | Streaming de vídeo |
| `GET` | `/api/channels` | Listar canales configurados |
| `GET` | `/api/config` | Leer configuración |
| `POST` | `/api/config` | Guardar configuración |
| `GET` | `/api/logs` | Logs del servicio |
| `GET` | `/api/files?subpath=...` | Listar contenido de subcarpeta |
| `WS` | `/ws/progress` | WebSocket de progreso en tiempo real |

---

## Reproducir en iPhone

La app detecta automáticamente si estás en un dispositivo iOS:

| Formato | Comportamiento |
|---|---|
| `.mp4`, `.mov`, `.m4v` | Se reproduce en Safari |
| `.mkv`, `.avi`, `.ts` | Abre VLC for iOS (debe estar instalado) |
| Escritorio / Android | Todos los formatos se reproducen en el navegador |

**Requisito iPhone:** instalar [VLC for Mobile](https://apps.apple.com/app/vlc-for-mobile/id650377962) desde la App Store.

---

## Docker (opcional)

```bash
docker build -t telegram-movie .
docker run -d \
  --name telegram-movie \
  -p 8000:8000 \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/session:/app/session \
  -v /mnt/usb1/torrent-complete:/mnt/usb1/torrent-complete \
  telegram-movie
```

---

## Solución de problemas

### "No se encontró el mensaje"
El mensaje fue eliminado del canal o el ID cambió. Busca de nuevo.

### Error Bad7zFile en archivos 7z
Asegúrate de tener `p7zip-full` instalado: `sudo apt install p7zip-full`

### Los logs no muestran nada
El servicio debe llamarse `telegram-movie` en systemd. Si usas otro nombre, edita el endpoint en `web_server.py`.

### El streaming no funciona en iPhone con .mkv
Instala VLC for Mobile. El botón ▶ usa el URL scheme `vlc-x-callback://`.

### La Pi se satura con streams
El semáforo de streams (configurable vía `TMD_STREAM_MAX`) limita las reproducciones simultáneas a 3 por defecto.

---

## Licencia

MIT
