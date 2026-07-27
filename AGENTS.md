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
- **backend**: Python 3.12 + FastAPI + Telethon. All logic in `app/routers/download.py` (900 line monolith). Session file at `session/user.session`. Downloads go `downloads/` → extract → `movies/`.
- **db**: PostgreSQL 16-alpine. Tables auto-created on startup. No migration framework.

## Key files

| File | Role |
|---|---|
| `backend/main.py` | CLI: `setup`, `serve`, `list-channels`, `add-channel` |
| `backend/app/main.py` | FastAPI app: startup (DB retry 10×, Telegram connect, background indexing), shutdown |
| `backend/app/routers/download.py` | ALL endpoints + WebSocket + download batch engine |
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

Booleans: `"1"`, `"true"`, `"yes"`, `"s"`, `"si"` → true. Spanish-friendly.

Default admin: `admin`/`admin`. Created on startup with salted SHA-256.

## Gotchas

- **Session path**: `_session_path()` searches cwd, then package root, then falls back to `cwd/session/`. Docker mounts `./session:/app/session`. CLSetup sets `session_dir` explicitly to `../session/` (project root). Both must agree.
- **Channel IDs**: stored as positive in DB (`entity.id`), but Telethon needs `-100XXXXXXXXXX`. `_resolve_channel_id()` adds prefix.
- **Multi-part archives**: detected by `storage.py` regex (`\.partN\.rar`, `\.rNN`, `\.7z\.NNN`, `\.\d{3,}$`). Backend's `find_related_parts()` searches all channels for matching base name.
- **Frontend grouping**: `parseTitle()` in Dashboard handles both `"SeriesName 1x01"` and `"1x01 - SeriesName"` formats. Strips `[...]` and applies `cleanTitle()`.
- **DTS→AAC conversion**: `_convert_audio()` in `download.py` detects DTS/AC3/EAC3/TrueHD via `mediainfo`, converts to AAC 256k. Runs in executor (blocking). Writes to temp file first, only replaces on success.
- **TMDB enrichment**: runs in background after indexing. Parallel (5 concurrency). Processes 300 items/batch. `tmdb_valid` flag compares detected type (NxM=series) vs TMDB result.
- **Search fallback**: `/api/search` queries PostgreSQL first. If < page_size results, falls back to live Telegram search. Deduplicates by `(channel_id, message_id)`. Enriches Telegram results with TMDB metadata on-the-fly.
- **Streaming**: `/api/stream` has semaphore (max 3 concurrent). Supports Range requests (206 Partial Content) for proper video playback.
- **WebSocket progress**: broadcasts at most 1/sec. Token passed as `?token=` query param. Auto-reconnects every 5s.
- **Logs endpoint**: `GET /api/logs` calls `journalctl -u telegram-movie`. Works only under systemd, not Docker.
- **Spanish**: all user-facing strings, CLI output, API messages, and logs are in Spanish. Code identifiers mixed Spanish/English. API JSON keys in English.
- **`TMD_TMBD_API_KEY`**: intentional typo in env var name. Both code and .env.example use this spelling.
- **Extraction**: sync/blocking via `run_in_executor`. Auto-flattens single-subfolder nesting (`movies/Name/Name/video.mkv` → `movies/Name/video.mkv`).
- **paused_batches.json**: gitignored. Persists download state across restarts.
- **No tests exist**. No linting/typechecking in CI. No pre-commit hooks.
