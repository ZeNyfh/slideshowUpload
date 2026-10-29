# Slideshow Upload

Phone-friendly image upload + fullscreen slideshow for events.

## Endpoints

| Path | Purpose |
|------|---------|
| `/upload` | Guests: one image at a time (file or camera). New uploads jump the queue. |
| `/view` | Display machine: fullscreen slideshow. |
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
