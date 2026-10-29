# Slideshow Upload

Phone-friendly image upload + fullscreen slideshow for events.

## Endpoints

| Path | Purpose |
|------|---------|
| `/upload` | Guests: one image at a time (file or camera). New uploads jump the queue. |
| `/view` | Display machine: fullscreen slideshow. |
| `/admin` | Bulk upload, delete, set seconds-per-slide. |

Pages are intentionally isolated — no links between them. Point the QR code at `/upload`.

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
