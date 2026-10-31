# AGENTS.md

## Project

Flask-based slideshow upload server for events. Single-file app (`app.py`) with Jinja2 templates, vanilla JS, and CSS. State persists in `data/state.json`; uploaded images live in `uploads/`.

## Run

```bash
./start.sh          # creates venv, installs deps, launches on port 5050
./start.sh 2100     # custom port
PORT=2100 python app.py  # alternative
```

Copy `.env.example` to `.env` first and set `ADMIN_PASSWORD` (and `SECRET_KEY`).

## Architecture

- **`app.py`** — everything: Flask routes, state management, image processing, queue logic
- **`templates/`** — 5 HTML pages (`upload`, `view`, `admin`, `login`, `qr`)
- **`static/`** — JS (`view.js`, `admin.js`, `upload.js`, `qr.js`, `qr-page.js`, `login.js`) and CSS
- **`data/state.json`** — runtime state (images, queue, rotation, config); created on first run
- **`uploads/`** — stored JPEGs (gitignored)

State is protected by a module-level `threading.RLock` (`_lock`). All reads and writes go through `_load_state()` / `_save_state()`.

## Key Endpoints

| Route | Purpose |
|-------|---------|
| `/`, `/upload` | Guest upload page |
| `/view` | Fullscreen slideshow display |
| `/admin` | Management panel (password required) |
| `/api/upload` | Guest upload API (priority queue) |
| `/api/admin/upload` | Admin bulk upload (rotation, no priority) |
| `/api/slideshow/next` | Pop next image for display |
| `/api/slideshow/peek` | Preview next image without consuming it |
| `/api/config` | Public config (transitions, duration, QR, etc.) |
| `/api/gallery` | Public image list, newest first (guest browsing; 403 if `allow_guest_downloads` off) |
| `/api/export` | Public zip of all photos (guest download; 403 if `allow_guest_downloads` off) |
| `/api/admin/config` | Update slideshow settings (admin) |
| `/api/admin/images` | List all images (admin) |
| `/api/admin/export` | Download all photos as zip (admin) |
| `/api/admin/clear` | Wipe all images and reset (admin) |

## Server

Uses **waitress** in production (handles large bodies); falls back to Flask dev server if waitress is missing. `MAX_CONTENT_LENGTH` is 50 MB but `_lift_upload_limits` overrides it for upload endpoints to allow multi-file batches.

## Conventions

- **New configurable features must be exposed on `/admin`** — see `.cursor/rules/admin-feature-exposure.mdc`. Do not leave settings hardcoded or view-only.
- State changes go through `_load_state()` → modify → `_save_state()` under `_lock`.
- New transitions added to `TRANSITIONS` in `app.py` must also have keys in `static/view.js`.
- QR theme keys must match entries in both `app.py` (`QR_THEMES`) and `static/qr.js`.
- `/view` manual skip just shows the photo and restarts the normal timer (see `showManualImage` / `dropPrepared` in `static/view.js`); only the gallery opens pause the slideshow (`overlayOpen`), served by the public gallery/export API gated by the `allow_guest_downloads` state flag.
- The hidden `/view` toolbar (id `controls`) is revealed on interaction; keep new guest-facing /view features in that toolbar, gated by `allow_guest_downloads`. The gallery overlay (`#galleryOverlay`) selects photos and downloads a zip via `GET /api/export?ids=<id>&ids=<id>…`.
- `/view` has a **local-only** display settings panel (`#settingsPanel`) storing seconds-per-photo in `localStorage` (`slideshow.localDuration`); it must never be serialized to `data/state.json` or the admin config — it deliberately overrides the server duration on that screen only.

## Testing

No test suite exists. Manual verification is the primary method.

## Existing Instruction Files

- `.cursor/rules/admin-feature-exposure.mdc` — convention for wiring new features through the admin panel.
