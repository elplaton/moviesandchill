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
                                                    ↓
                                              PostgreSQL :5432
                                              Telegram API
                                              TMDB API
```

- **frontend**: React 18 + Vite 5 + Tailwind 3. SPA served by nginx. Dev Vite proxy sends `/api`→`:8000`, `/ws`→`ws://localhost:8000`.
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
| `backend/app/services/indexer.py` | Channel scanning + parallel TMDB enrichment (semaphore 5) |
| `backend/app/services/tmdb.py` | TMDB client: `clean_title()`, `search()`, `get_details()`, `batch_search()` |
| `backend/app/services/telegram_client.py` | Telethon wrapper, channel resolution (positive→`-100` prefix), multi-part detection |
| `backend/app/auth/service.py` | JWT + password hashing |
| `frontend/src/pages/Dashboard.tsx` | Main UI: search, Biblioteca, Explorar tabs. `parseTitle()`, `cleanTitle()`, grouping logic |
| `frontend/src/services/api.ts` | HTTP client: auto JWT refresh on 401, redirects to `/login` on failure |

## Config

Everything via `.env` with `TMD_` prefix. `.env` search order: cwd → parent of `app/config.py` → dotenv default.

**Critical vars**: `TMD_API_ID`, `TMD_API_HASH`, `TMD_PHONE`, `TMD_JWT_SECRET`, `TMD_DATABASE_URL`, `TMD_TMBD_API_KEY` (note: TMBD typo, not TMDB).

`TMD_JWT_SECRET` es **obligatorio**: el arranque aborta si falta, es uno de los valores de ejemplo, o mide menos de 16 caracteres. Antes había un fallback (`default-secret-change-me`) que permitía a cualquiera firmarse un token de admin.

Otras vars: `TMD_STATE_DIR` (dónde vive `paused_batches.json`), `TMD_CORS_ORIGINS` (coma-separado; con `*` se desactivan las credenciales), `TMD_ADMIN_PASSWORD`, `TMD_LOG_UNIT`.

Booleans: `"1"`, `"true"`, `"yes"`, `"s"`, `"si"` → true. Spanish-friendly.

Default admin: `admin`/`admin` (o `TMD_ADMIN_PASSWORD`). Se crea al arrancar con PBKDF2-HMAC-SHA256 (240k iteraciones). Los hashes antiguos en formato `salt$sha256` se siguen aceptando y se migran a PBKDF2 en el primer login.

## Gotchas

- **Session path**: `_session_path()` searches cwd, then package root, then falls back to `cwd/session/`. Docker mounts `./session:/app/session`. CLSetup sets `session_dir` explicitly to `../session/` (project root). Both must agree.
- **Channel IDs**: stored as positive in DB (`entity.id`), but Telethon needs `-100XXXXXXXXXX`. `_resolve_channel_id()` adds prefix.
- **Multi-part archives**: detected by `storage.py` regex (`\.partN\.rar`, `\.rNN`, `\.7z\.NNN`, `\.\d{3,}$`). Backend's `find_related_parts()` searches all channels for matching base name.
- **Frontend grouping**: `parseTitle()` in Dashboard handles both `"SeriesName 1x01"` and `"1x01 - SeriesName"` formats. Strips `[...]` and applies `cleanTitle()`.
- **Conversión de compatibilidad**: `_make_compatible()` en `download_router.py` detecta códecs vía `mediainfo` y transcodifica a H.264/AAC/MKV. Corre en executor (bloqueante). Escribe a un temporal y solo reemplaza si acaba bien. Ojo: `_info()` devuelve `""` si `mediainfo` no está instalado, y una cadena vacía se interpreta como "compatible" (no se convierte).
- **TMDB enrichment**: runs in background after indexing. Parallel (5 concurrency). Processes 300 items/batch. `tmdb_valid` flag compares detected type (NxM=series) vs TMDB result.
- **Search fallback**: `/api/search` consulta PostgreSQL primero. Ojo con los dos offsets: `offset` son filas a saltar en SQL y `offset_id` es un ID de mensaje de Telegram — no son intercambiables. If < page_size results, falls back to live Telegram search. Deduplicates by `(channel_id, message_id)`. Enriches Telegram results with TMDB metadata on-the-fly.
- **Streaming**: `/api/stream` tiene semáforo (máx. `TMD_STREAM_MAX`, 3 por defecto). Se adquiere antes de construir la respuesta y **se libera en el `finally` del generador**, no al retornar: de lo contrario no limita nada. Lectura con `aiofiles` para no bloquear el event loop. Soporta Range (206).
- **WebSocket progress**: broadcasts como mucho 1/seg. El token va en `?token=` y **se valida**: sin token válido se cierra con código 1008. Reconecta cada 5s.
- **Logs endpoint**: `GET /api/logs` llama a `journalctl -u $TMD_LOG_UNIT` (por defecto `telegram-movie`). Solo bajo systemd; en Docker devuelve un error explicando que uses `docker compose logs`.
- **Spanish**: all user-facing strings, CLI output, API messages, and logs are in Spanish. Code identifiers mixed Spanish/English. API JSON keys in English.
- **`TMD_TMBD_API_KEY`**: intentional typo in env var name. Both code and .env.example use this spelling.
- **Extraction**: sync/blocking via `run_in_executor`. Auto-flattens single-subfolder nesting (`movies/Name/Name/video.mkv` → `movies/Name/video.mkv`).
- **paused_batches.json**: gitignored. Vive en `TMD_STATE_DIR` (montado como `./state` en Docker) en vez de ser relativo al cwd. Pausar borra **solo** las partes incompletas: las ya descargadas deben sobrevivir o el "reanudar" no sirve de nada.
- **Tareas de fondo**: usa `spawn()` de `app/tasks.py`, no `asyncio.create_task()` a secas. Este último se traga las excepciones y mantiene solo una referencia débil a la tarea; así estuvo roto el indexado al añadir un canal sin que apareciera nada en los logs.
- **No tests exist**. No linting/typechecking in CI. No pre-commit hooks.
