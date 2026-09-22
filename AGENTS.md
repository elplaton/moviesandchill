# AGENTS.md

## Quick start

```bash
cp .env.example .env   # edit with real TMD_API_ID, TMD_API_HASH, TMD_PHONE
docker compose up -d   # db → backend → frontend (port 80)
```

First login requires interactive Telegram auth. If `session/user.session` doesn't exist:
```bash
cd backend && source ../venv/bin/activate && python main.py setup
```
Then `docker compose restart backend`.

**Dev mode** (no Docker, backend on :8000, frontend on :5173 with proxy):
```bash
# Terminal 1
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# Terminal 2
cd frontend && npm run dev
```

## Architecture

```
Browser :80 → nginx (frontend) → proxy /api/* → :8000 (FastAPI backend)
              ├─ /      web de escritorio (frontend/)
              └─ /m/    PWA de móvil (mobile/), redirigida desde / en teléfonos
                                                    ↓
                                              PostgreSQL :5432
                                              Telegram API
                                              TMDB API
```

- **frontend**: React 18 + Vite 5 + Tailwind 3. SPA served by nginx. La imagen se construye desde la raíz del repo (`context: .`) e incluye también `mobile/` en `/m/`.
- **mobile**: PWA (React + Vite + Tailwind, `base: /m/`), manifest + service worker en `public/`. Pensada para el teléfono: armazón fijo con `<main>` desplazable (la barra de pestañas no se mueve con la de Safari), ficha por ruta (`/m/t/:kind/:tmdbId`), `<video>` nativo que entra en pantalla completa al arrancar y se cierra al salir de ella. **Se actualiza sola**: `scripts/stamp-sw.mjs` marca `dist/sw.js` con la fecha del build; el SW hace `skipWaiting`+`claim` y `main.tsx` recarga una vez en `controllerchange`. Dev Vite proxy sends `/api`→`:8000`, `/ws`→`ws://localhost:8000`.
- **backend**: Python 3.12 + FastAPI + Telethon. Split into `app/routers/*`, `app/services/*`, `app/database/*`; `app/routers/download.py` is now just the wiring (`init_download_router`). Session file at `session/user.session` (gitignored — never commit it). Downloads go `downloads/` → extract → `movies/`.
- **db**: PostgreSQL 16-alpine. Tables auto-created on startup. No migration framework.

## Key files

| File | Role |
|---|---|
| `backend/main.py` | CLI: `setup`, `serve`, `list-channels`, `add-channel` |
| `backend/app/main.py` | FastAPI app: startup (DB retry 10×, Telegram connect, background indexing), shutdown |
| `backend/app/routers/download.py` | Wiring only: guarda `downloader`/`config` e inicializa el resto |
| `backend/app/routers/download_router.py` | Endpoints de descarga + motor de batches |
| `backend/app/tasks.py` | `spawn()`: tareas de fondo que sí registran sus excepciones |
| `backend/app/database/connection.py` | Pool, schema (`users`, `channels`, `media_items`, `tmdb_cache`, `index_progress`), CRUD |
| `backend/app/services/title_parser.py` | **Única** fuente de verdad para interpretar nombres de archivo: `parse_filename()` → tipo, temporada, episodio, título para TMDB, año, `[tmdbid-N]` |
| `backend/app/services/indexer.py` | Channel scanning + TMDB enrichment agrupado por título (semaphore 5); `reclassify_all()` re-parsea todo el catálogo |
| `backend/app/services/tmdb.py` | TMDB client: `search(query, media_type, year)` usa `/search/tv` o `/search/movie` (+año) antes de `/search/multi`; `get_details()` |
| `backend/app/database/browse.py` | Filas de la Home: muestreo aleatorio ponderado a lo reciente, novedades, añadidos recientemente. Solo `tmdb_valid` |
| `backend/app/routers/search_router.py` | `/api/search` y `GET /api/media/{tmdb_id}/files` (archivos de un título; es lo que abren los modales de detalle) |
| `backend/app/services/telegram_client.py` | Telethon wrapper, channel resolution (positive→`-100` prefix), multi-part detection |
| `backend/app/auth/service.py` | JWT + password hashing; una cuenta `active = false` no entra |
| `backend/app/routers/admin_router.py` | `/api/admin/users` (alta, rol, cuota, activar, contraseña, baja), `/api/admin/downloads`, `/api/admin/convert-library` |
| `backend/app/database/downloads.py` | Tabla `downloads`: dueño, carpeta, tamaño y estado de cada descarga; `adopt_orphans()` asigna al admin lo que ya estaba en disco |
| `backend/app/services/compat.py` | `make_compatible()`: todo a MP4 (H.264/HEVC + AAC, `-movflags +faststart`); `convert_library_job()` reempaqueta la biblioteca |
| `frontend/src/pages/Admin.tsx` | Panel de administración (Usuarios · Descargas · Canales · Ajustes · Registros); solo admin, solo web |
| `frontend/src/pages/Dashboard.tsx` | Main UI: search, Biblioteca, Explorar tabs. `parseTitle()`, `cleanTitle()`, grouping logic |
| `frontend/src/services/api.ts` | HTTP client: auto JWT refresh on 401, redirects to `/login` on failure |

## Config

Everything via `.env` with `TMD_` prefix. `.env` search order: cwd → parent of `app/config.py` → dotenv default.

**Critical vars**: `TMD_API_ID`, `TMD_API_HASH`, `TMD_PHONE`, `TMD_JWT_SECRET`, `TMD_DATABASE_URL`, `TMD_TMBD_API_KEY` (note: TMBD typo, not TMDB).

`TMD_JWT_SECRET` es **obligatorio**: el arranque aborta si falta, es uno de los valores de ejemplo, o mide menos de 16 caracteres. Antes había un fallback (`default-secret-change-me`) que permitía a cualquiera firmarse un token de admin.

Otras vars: `TMD_RESCAN_HOURS` (barrido incremental cada N horas, 6 por defecto, 0 desactiva), `TMD_STATE_DIR` (dónde vive `paused_batches.json`), `TMD_CORS_ORIGINS` (coma-separado; con `*` se desactivan las credenciales), `TMD_ADMIN_PASSWORD`, `TMD_LOG_UNIT`.

Booleans: `"1"`, `"true"`, `"yes"`, `"s"`, `"si"` → true. Spanish-friendly.

Default admin: `admin`/`admin` (o `TMD_ADMIN_PASSWORD`). Se crea al arrancar con PBKDF2-HMAC-SHA256 (240k iteraciones). Los hashes antiguos en formato `salt$sha256` se siguen aceptando y se migran a PBKDF2 en el primer login.

## Gotchas

- **Session path**: `_session_path()` searches cwd, then package root, then falls back to `cwd/session/`. Docker mounts `./session:/app/session`. CLSetup sets `session_dir` explicitly to `../session/` (project root). Both must agree.
- **Channel IDs**: stored as positive in DB (`entity.id`), but Telethon needs `-100XXXXXXXXXX`. `_resolve_channel_id()` adds prefix.
- **Multi-part archives**: detected by `storage.py` regex (`\.partN\.rar`, `\.rNN`, `\.7z\.NNN`, `\.\d{3,}$`). Backend's `find_related_parts()` searches all channels for matching base name.
- **Frontend grouping**: `groupSearchResults()` en `utils/search.ts` (web y tizen) agrupa resultados de búsqueda por `tmdb_id` si lo hay, y si no por el nombre de serie que va delante del `1x01`. `parseTitle()` en Dashboard sigue existiendo para la vista antigua.
- **Detalle por tmdb_id**: los modales de película/serie cargan `GET /api/media/{tmdb_id}/files`, nunca `/api/search` con el título. Con `ILIKE` del título en español de TMDB, 2 de cada 3 series salían sin episodios ("Cómo conocí a vuestra madre" vs "How I Met Your Mother 1x01").
- **Clasificación película/serie**: la decide `title_parser.parse_filename()` (`1x01`, `S01E01`, `T01E10`, `[S05.E06]`, `Temporada N`, `episodio N`, `Nombre - 89`, `Nombre_149_...`). El texto que se manda a TMDB es solo el nombre de la serie (lo de delante del marcador), no el título del episodio; antes "Suits La vida útil" emparejaba con la película "La vida me sienta bien". `tmdb_valid` = tipo detectado == tipo TMDB y **solo lo válido sale en la Home**. Tras cambiar el parser: `POST /api/index/reclassify` (botón "Reclasificar catálogo" en Canales) re-parsea y re-busca lo que estaba sin emparejar o con el tipo equivocado.
- **"Descargar" en el modal**: el número que antes salía entre paréntesis eran *partes* del mismo archivo comprimido, no opciones; al pulsar se bajan todas las partes y se extraen. Ahora el botón dice solo "Descargar" y la fila muestra "N partes · tamaño".
- **Conversión de compatibilidad**: `_make_compatible()` en `download_router.py` detecta códecs vía `mediainfo` y transcodifica a H.264/AAC/MKV. Corre en executor (bloqueante). Escribe a un temporal y solo reemplaza si acaba bien. Ojo: `_info()` devuelve `""` si `mediainfo` no está instalado, y una cadena vacía se interpreta como "compatible" (no se convierte).
- **TMDB enrichment**: corre en un único bucle en paralelo al escaneo (`ensure_enrich_worker()`, guardado por `_enrich_running`), no dentro de cada lote: con 250k mensajes esperar a TMDB por lote suponía horas. Concurrencia 10 (`TMDB_CONCURRENCY`), 300 items/batch, agrupando por título (una consulta por serie, no por episodio). El bucle sigue vivo mientras `_active_scans > 0`. `get_media_without_tmdb()` solo devuelve `tmdb_searched = FALSE`: antes re-preguntaba a TMDB por los 11.000 sin resultado en cada pasada.
- **Ids de TMDB**: películas y series tienen espacios de ids **independientes** (`tv/606` = Ed, Edd y Eddy; `movie/606` = Memorias de África). `tmdb_cache` tiene clave `(tmdb_id, media_type)` y `media_items.tmdb_type` guarda el tipo; **todo JOIN con `tmdb_cache` debe ir por las dos columnas**. `GET /api/media/{id}/files?media_type=tv|movie` exige el tipo. Con la clave antigua cada ficha pisaba a la otra y aparecían películas con "199 episodios".
- **Search fallback**: `/api/search` consulta PostgreSQL primero. Ojo con los dos offsets: `offset` son filas a saltar en SQL y `offset_id` es un ID de mensaje de Telegram — no son intercambiables. If < page_size results, falls back to live Telegram search. Deduplicates by `(channel_id, message_id)`. Enriches Telegram results with TMDB metadata on-the-fly.
- **Streaming**: `/api/stream` tiene semáforo (máx. `TMD_STREAM_MAX`, 3 por defecto). Se adquiere antes de construir la respuesta y **se libera en el `finally` del generador**, no al retornar: de lo contrario no limita nada. Lectura con `aiofiles` para no bloquear el event loop. Soporta Range (206).
- **WebSocket progress**: broadcasts como mucho 1/seg. El token va en `?token=` y **se valida**: sin token válido se cierra con código 1008. Reconecta cada 5s.
- **Logs endpoint**: `GET /api/logs` llama a `journalctl -u $TMD_LOG_UNIT` (por defecto `telegram-movie`). Solo bajo systemd; en Docker devuelve un error explicando que uses `docker compose logs`.
- **Spanish**: all user-facing strings, CLI output, API messages, and logs are in Spanish. Code identifiers mixed Spanish/English. API JSON keys in English.
- **`TMD_TMBD_API_KEY`**: intentional typo in env var name. Both code and .env.example use this spelling.
- **Estructura en disco** (`services/layout.py`): series → `<extract>/<Serie>/Temporada N/<N>x<EE>.<ext>`; películas → `<extract>/<Título (Año)>/<Título (Año)>.<ext>`. Los nombres salen de TMDB (`get_media_item()` sobre el catálogo) y, si no hay, del parser. Cada lote baja a una carpeta temporal `.dl_<batch>` dentro de su destino, se extrae/convierte ahí y `finalize_episode()` mueve el vídeo con su nombre final y borra la temporal; al cancelar/fallar se borra y se podan carpetas vacías (`prune_empty_dirs`). `/files` entiende esta estructura y la antigua (`Serie S1/`). Cada parte lleva su `channel_id` y `download_to_folder()` lo usa: **el `message_id` se repite entre canales** y sin él se descargaba el archivo de otro canal.
- **Extraction**: sync/blocking via `run_in_executor`. Auto-flattens single-subfolder nesting (`movies/Name/Name/video.mkv` → `movies/Name/video.mkv`).
- **paused_batches.json**: gitignored. Vive en `TMD_STATE_DIR` (montado como `./state` en Docker) en vez de ser relativo al cwd. Pausar borra **solo** las partes incompletas: las ya descargadas deben sobrevivir o el "reanudar" no sirve de nada.
- **Mensajes nuevos**: se indexan en tiempo real con un handler `events.NewMessage` de Telethon (`watch_new_messages()` → `index_live_message()`); el filtro de canal se evalúa en cada evento, así que los canales añadidos después también cuentan. `run_full_index` ya **no omite** los canales `done`: los escanea desde `last_message_id` (solo lo nuevo), al arrancar y en el barrido periódico (`periodic_rescan`, `TMD_RESCAN_HOURS`).
- **Tareas de fondo**: usa `spawn()` de `app/tasks.py`, no `asyncio.create_task()` a secas. Este último se traga las excepciones y mantiene solo una referencia débil a la tarea; así estuvo roto el indexado al añadir un canal sin que apareciera nada en los logs.
- **App de TV (`tizen/`, y `webos/` para LG)**: un solo código en `tizen/src`; `webos/` solo empaqueta (`appinfo.json`, `build.sh` genera el `.ipk` con `vite --mode webos`, objetivo Chromium 68, y `deploy.sh` instala con el CLI `ares-*` que va como devDependency de `tizen/`). Diferencias por plataforma ya resueltas en código: salida (`tizen.application.exit` / `window.close`), cursor (solo Tizen lo oculta; el Magic Remote de LG enfoca al pasar), nada de `gap` en flex (webOS 5/6 no lo soporta: `space-x`/`space-y`). Interfaz propia, no un calco de la web. Mide 1920×1080 fijos (px absolutos, sin breakpoints; `main.tsx` la escala en desarrollo). Estructura: `components/Rail` (navegación lateral, vive fuera de las rutas), `Screen` (columna de contenido con scroll por transform + `Hero`, el panel que describe la tarjeta enfocada vía `tv/featured.ts`), `Row`/`PosterCard` (carriles), `TitleDetail` (ficha a pantalla completa), `Player` (reproductor sin controles nativos; teclas en `focus/keys.ts` `pushRawHandler`/`pushMediaHandler`), `Keyboard` (teclado en pantalla). Los paneles a pantalla completa se montan por portal en `#overlays` (`components/Overlay`): dentro de la columna con transform, `position: fixed` no funciona. Un solo `DownloadsProvider` para descargas + índice de disco. Reglas de render: solo se animan transform/opacity, nada de backdrop-filter, el foco es una clase CSS. Los tests del motor de foco: `npm test`.
- **Cuentas, cuotas y dueños**: `users.quota_bytes` (NULL = sin límite) y `users.active`. Cada descarga tiene dueño (`downloads.owner_id`); la cuota compara el disco que ocupan sus descargas vivas (`downloading|paused|done`) con `quota_bytes` antes de aceptar otra. **Una descarga la ve todo el mundo, solo la borra su dueño o un admin, y nadie puede volver a bajar lo mismo** (`POST /download` devuelve `already: true` con el dueño). `/files` devuelve `owner` y `can_delete`; `DELETE /files` los comprueba. Lo anterior a esta versión pasó al admin al arrancar.
- **MP4 obligatorio**: iPhone/Safari no reproduce MKV, así que `make_compatible()` deja todo en MP4 (contenedor MKV ya no cuenta como compatible; HEVC se etiqueta `hvc1`; sin subtítulos porque MP4 no admite PGS/ASS). El interruptor sigue llamándose `convert_dts_to_ac3` por compatibilidad con el `.env`.
- **No tests exist** (salvo `tizen/test`). No linting/typechecking in CI. No pre-commit hooks.
