# Slideshow Upload

Phone-friendly image upload + fullscreen slideshow for events.

## Endpoints

| Path | Purpose |
|------|---------|
| `/upload` | Guests: any number of images at once (file or camera). New uploads jump the queue. |
| `/view` | Display machine: fullscreen slideshow. Hidden toolbar (mouse/touch/keyboard) lets you browse photos, download the current one or the whole set as a zip, and toggle fullscreen. |
| `/admin` | Bulk upload, delete, set seconds-per-slide (password required). |

Pages are intentionally isolated — no links between them. `/view` shows a QR code pointing guests at the site root (which serves the upload page; see below).

Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` (and preferably `SECRET_KEY`).

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Server listens on `http://0.0.0.0:5050`. Override with `./start.sh 2100` or `PORT=2100`.

## Queue behaviour

- Guest uploads (`/upload`) go into a **priority queue** (newest first) and are shown next on `/view`.
- After a priority image is shown once, it joins the regular rotation.
- Admin bulk uploads append to the normal rotation (no jump).
- Slide duration is controlled in `/admin` (default 5 seconds).
- **Photo order** (set in `/admin`) controls the regular rotation; new guest uploads still always play next:
  - *In order*: newest to oldest, then loop (default).
  - *Shuffle*: random, but every photo plays once before any repeats.
  - *Smart*: weighted random that favours newer photos (the newest is about 2–3× as likely as the oldest) and skips roughly the last third shown, so nothing repeats too soon.

## QR code

`/view` overlays a QR code (bottom-right by default). In `/admin` you can toggle it, pick the corner, size (8–40% of screen height), label and theme (classic, soft, pumpkin, ghost, blood, witch, neon, bats).

The code opens the site root (e.g. `http://192.168.1.70:8123/`), built from the address the display uses. If the display is opened as `localhost`, the server's LAN IP is used instead so phones can reach it. Set **Public URL** in `/admin` when guests should use a different address (e.g. a domain or tunnel).

## Transitions

24 transitions: 3 classic (crossfade, slide, drift) and 21 spooky (lightning, fog, ghost, possessed, bleed, bats, shatter, melt, haunted-tv, portal, snuffed, spider, ashes, burn, ripple, crypt-doors, spellbook, summoning, blink, vines, tarot). Newly added transitions start enabled. Pick which are enabled and random vs in-order playback in `/admin`. Preview one on the display with `/view?transition=<name>`.

## Browsing & downloading on /view

Move the mouse (or touch / press a key) and a small toolbar appears in a top corner of the slideshow — it fades back after ~3.5s so the display stays clean:

- **‹ / ›** browse photos manually; the slideshow pauses while browsing and auto-resumes after ~30s (or tap the play button).
- **Download current** photo (slideshow copy, original filename if known).
- **Gallery (grid icon)** opens a full-screen gallery of every photo. Tap the ✓ on photos to select them and hit **Download selected (n)** for a zip of just those, or use **Select all / Deselect all**. Click a photo to view it full-size and download it directly. **Download all** grabs everything as `slideshow-photos.zip`.
- **Fullscreen** toggle (also `F`). Arrow keys and left/right swipes browse too.

This feature is optional: uncheck *Let guests download and browse photos from the slideshow* in `/admin`. When off, the toolbar (except fullscreen) is hidden and the public endpoints `GET /api/export` and `GET /api/gallery` return 403. `GET /api/export` streams a zip of every photo (or just those named by repeated `?ids=<photo-id>` params for selected downloads); `GET /api/gallery` lists them newest-first for the gallery and browsing.
