"""Slideshow upload server: /upload, /view, /admin."""

from __future__ import annotations

import io
import json
import os
import random
import secrets
import socket
import sys
import threading
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from PIL import Image, ImageOps
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

UPLOAD_DIR = BASE_DIR / "uploads"
DATA_DIR = BASE_DIR / "data"
STATE_PATH = DATA_DIR / "state.json"

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}
# Accept large camera originals; stored files are compressed under MAX_STORED_BYTES.
MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50 MB upload ceiling
MAX_STORED_BYTES = 5 * 1024 * 1024  # 5 MB after compress
MAX_IMAGE_EDGE = 2560  # initial max width/height for slideshow
DEFAULT_DURATION = 5

# Must match the keys of TRANSITIONS in static/view.js
TRANSITIONS = [
    {"name": "crossfade", "label": "Crossfade", "group": "classic"},
    {"name": "slide", "label": "Slide", "group": "classic"},
    {"name": "drift", "label": "Drift (Ken Burns)", "group": "classic"},
    {"name": "lightning", "label": "Lightning strike", "group": "spooky"},
    {"name": "fog", "label": "Graveyard fog", "group": "spooky"},
    {"name": "ghost", "label": "Ghostly apparition", "group": "spooky"},
    {"name": "possessed", "label": "Possessed glitch", "group": "spooky"},
    {"name": "bleed", "label": "Blood drip", "group": "spooky"},
    {"name": "bats", "label": "Bat swarm", "group": "spooky"},
    {"name": "shatter", "label": "Shattered mirror", "group": "spooky"},
    {"name": "melt", "label": "Melting wax", "group": "spooky"},
    {"name": "haunted-tv", "label": "Haunted TV", "group": "spooky"},
    {"name": "portal", "label": "Witch portal", "group": "spooky"},
    {"name": "snuffed", "label": "Snuffed candle", "group": "spooky"},
    {"name": "spider", "label": "Spider lift", "group": "spooky"},
    {"name": "ashes", "label": "Ashes on the wind", "group": "spooky"},
    {"name": "burn", "label": "Burning page", "group": "spooky"},
    {"name": "ripple", "label": "Cursed reflection", "group": "spooky"},
    {"name": "crypt-doors", "label": "Crypt doors", "group": "spooky"},
    {"name": "spellbook", "label": "Spellbook page", "group": "spooky"},
    {"name": "summoning", "label": "Summoning circle", "group": "spooky"},
    {"name": "blink", "label": "Something blinked", "group": "spooky"},
    {"name": "vines", "label": "Creeping thorns", "group": "spooky"},
    {"name": "tarot", "label": "Tarot reveal", "group": "spooky"},
]
TRANSITION_NAMES = [t["name"] for t in TRANSITIONS]
# Catalogue as of state files saved before "transitions_known" was tracked
_LEGACY_TRANSITIONS = TRANSITION_NAMES[:15]
TRANSITION_MODES = ("random", "sequence")

# Order of the regular rotation; fresh guest uploads always play first regardless
PLAYBACK_ORDERS = ("sequence", "random", "smart")
SMART_NEWEST_BOOST = 2.0  # smart mode: newest photo is (1 + boost)x as likely as the oldest
RECENT_HISTORY = 50

# Must match the keys of THEMES in static/qr.js
QR_THEMES = [
    {"name": "classic", "label": "Classic"},
    {"name": "soft", "label": "Soft dots"},
    {"name": "pumpkin", "label": "Pumpkin patch"},
    {"name": "ghost", "label": "Friendly ghost"},
    {"name": "blood", "label": "Blood drip"},
    {"name": "witch", "label": "Witch's brew"},
    {"name": "neon", "label": "Neon glow"},
    {"name": "bats", "label": "Bat cave"},
]
QR_THEME_NAMES = [t["name"] for t in QR_THEMES]
QR_CORNERS = ("top-left", "top-right", "bottom-left", "bottom-right")
QR_TARGETS = ("upload", "view")
QR_SIZE_RANGE = (8, 40)  # percent of the display's shorter side
QR_DEFAULTS = {
    "enabled": True,
    "corner": "bottom-right",
    "size": 18,
    "theme": "classic",
    "label": "Scan to add your photo",
    "target": "upload",
    "base_url": "",
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


@app.before_request
def _lift_admin_upload_limits():
    # Must run before the body is parsed; guests keep MAX_CONTENT_LENGTH.
    # Flask treats None as "use app config", so use sys.maxsize for "no limit".
    if request.path == "/api/admin/upload" and _is_admin():
        request.max_content_length = sys.maxsize
        request.max_form_parts = sys.maxsize


@app.errorhandler(413)
def request_entity_too_large(_exc):
    return (
        jsonify(
            {
                "ok": False,
                "error": f"Image too large (max {MAX_CONTENT_LENGTH // (1024 * 1024)} MB)",
            }
        ),
        413,
    )

_lock = threading.RLock()


def _admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "").strip()


def _is_admin() -> bool:
    return bool(session.get("admin"))


def require_admin(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not _is_admin():
            if request.path.startswith("/api/"):
                return jsonify({"ok": False, "error": "Unauthorized"}), 401
            return redirect(url_for("admin_login_page"))
        return view(*args, **kwargs)

    return wrapped


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_state() -> dict:
    return {
        "slide_duration": DEFAULT_DURATION,
        "transitions": list(TRANSITION_NAMES),
        "transitions_known": list(TRANSITION_NAMES),
        "transition_mode": "random",
        "playback_order": "sequence",
        "qr": dict(QR_DEFAULTS),
        "images": [],
        "priority_queue": [],
        "rotation": [],
        "cursor": 0,
        "deck": [],
        "recent": [],
    }


def _clean_transitions(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    picked = {str(n) for n in raw}
    return [n for n in TRANSITION_NAMES if n in picked]


def _display_config(state: dict) -> dict:
    return {
        "slide_duration": state["slide_duration"],
        "transitions": state["transitions"],
        "transition_mode": state["transition_mode"],
        "playback_order": state["playback_order"],
        "qr": state["qr"],
    }


def _clean_base_url(raw) -> str:
    """'' or an http(s) URL without trailing slash; raises ValueError otherwise."""
    value = str(raw or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or len(value) > 300:
        raise ValueError("Public URL must start with http:// or https://")
    return value.rstrip("/")


def _validate_qr(raw: dict, current: dict) -> dict:
    """Merge admin-supplied QR settings onto current ones; raises ValueError on bad input."""
    if not isinstance(raw, dict):
        raise ValueError("Invalid QR settings")
    qr = dict(current)
    if "enabled" in raw:
        qr["enabled"] = bool(raw["enabled"])
    if "corner" in raw:
        if raw["corner"] not in QR_CORNERS:
            raise ValueError("Invalid QR corner")
        qr["corner"] = raw["corner"]
    if "size" in raw:
        try:
            size = int(raw["size"])
        except (TypeError, ValueError):
            raise ValueError("Invalid QR size") from None
        lo, hi = QR_SIZE_RANGE
        if not lo <= size <= hi:
            raise ValueError(f"QR size must be {lo}–{hi}%")
        qr["size"] = size
    if "theme" in raw:
        if raw["theme"] not in QR_THEME_NAMES:
            raise ValueError("Invalid QR theme")
        qr["theme"] = raw["theme"]
    if "label" in raw:
        qr["label"] = " ".join(str(raw["label"] or "").split())[:60]
    if "target" in raw:
        if raw["target"] not in QR_TARGETS:
            raise ValueError("Invalid QR link target")
        qr["target"] = raw["target"]
    if "base_url" in raw:
        qr["base_url"] = _clean_base_url(raw["base_url"])
    return qr


def _load_qr(raw) -> dict:
    """Lenient version for state files: drop bad fields instead of failing."""
    qr = dict(QR_DEFAULTS)
    if not isinstance(raw, dict):
        return qr
    for key in QR_DEFAULTS:
        if key in raw:
            try:
                qr = _validate_qr({key: raw[key]}, qr)
            except ValueError:
                pass
    return qr


def _lan_ip() -> str | None:
    # UDP connect sends nothing; it just asks the OS which interface routes outward
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        ip = probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()
    return None if ip.startswith("127.") else ip


def _qr_link(qr: dict, client_origin: str) -> str:
    """Absolute URL the QR code should open on a guest's phone."""
    path = "/upload" if qr["target"] == "upload" else "/view"
    if qr["base_url"]:
        return qr["base_url"] + path
    parsed = urlparse(client_origin or "")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        parsed = urlparse(request.host_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if parsed.hostname in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        ip = _lan_ip()
        if ip:
            origin = f"{parsed.scheme}://{ip}" + (f":{parsed.port}" if parsed.port else "")
    return origin + path


def _load_state() -> dict:
    if not STATE_PATH.exists():
        return _default_state()
    try:
        with STATE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _default_state()
    base = _default_state()
    base.update({k: data.get(k, base[k]) for k in base})
    if not isinstance(base["slide_duration"], (int, float)) or base["slide_duration"] < 1:
        base["slide_duration"] = DEFAULT_DURATION
    base["slide_duration"] = int(base["slide_duration"])
    if "transitions" in data:
        # Newly added transitions start enabled; ones the admin unticked stay off
        known = set(data.get("transitions_known") or _LEGACY_TRANSITIONS)
        saved = _clean_transitions(data["transitions"])
        saved += [n for n in TRANSITION_NAMES if n not in known]
        base["transitions"] = _clean_transitions(saved) or list(TRANSITION_NAMES)
    base["transitions_known"] = list(TRANSITION_NAMES)
    if base["playback_order"] not in PLAYBACK_ORDERS:
        base["playback_order"] = "sequence"
    base["qr"] = _load_qr(data.get("qr"))
    if base["transition_mode"] not in TRANSITION_MODES:
        base["transition_mode"] = "random"
    return base


def _save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    tmp.replace(STATE_PATH)


def _image_by_id(state: dict, image_id: str) -> dict | None:
    for img in state["images"]:
        if img["id"] == image_id:
            return img
    return None


def _prune_missing(state: dict) -> None:
    existing = []
    for img in state["images"]:
        path = UPLOAD_DIR / img["filename"]
        if path.is_file():
            existing.append(img)
    keep = {img["id"] for img in existing}
    state["images"] = existing
    state["priority_queue"] = [i for i in state["priority_queue"] if i in keep]
    state["rotation"] = [i for i in state["rotation"] if i in keep]
    state["deck"] = [i for i in state["deck"] if i in keep]
    state["recent"] = [i for i in state["recent"] if i in keep]
    if state["rotation"]:
        state["cursor"] %= len(state["rotation"])
    else:
        state["cursor"] = 0


def _pick_sequence(state: dict) -> str | None:
    if not state["rotation"]:
        # rebuild rotation from all images, newest first
        state["rotation"] = [img["id"] for img in reversed(state["images"])]
        state["cursor"] = 0
    if not state["rotation"]:
        return None
    if state["cursor"] >= len(state["rotation"]):
        state["cursor"] = 0
    image_id = state["rotation"][state["cursor"]]
    state["cursor"] = (state["cursor"] + 1) % len(state["rotation"])
    return image_id


def _pick_shuffled(state: dict, newest_first: list[str]) -> str:
    """Shuffle bag: every photo plays once per pass, in random order."""
    if not state["deck"]:
        deck = list(newest_first)
        random.shuffle(deck)
        last = state["recent"][-1] if state["recent"] else None
        if len(deck) > 1 and deck[0] == last:
            deck.append(deck.pop(0))
        state["deck"] = deck
    return state["deck"].pop(0)


def _pick_smart(state: dict, newest_first: list[str]) -> str:
    """Weighted random that favours newer photos and skips the last ~third shown."""
    n = len(newest_first)
    avoid = set(state["recent"][-max(1, min(n - 1, n // 3)):]) if n > 1 else set()
    ranked = [(image_id, rank) for rank, image_id in enumerate(newest_first) if image_id not in avoid]
    if not ranked:
        ranked = [(image_id, rank) for rank, image_id in enumerate(newest_first)]
    span = max(1, n - 1)
    weights = [1 + SMART_NEWEST_BOOST * (1 - rank / span) ** 2 for _, rank in ranked]
    return random.choices([image_id for image_id, _ in ranked], weights=weights)[0]


def _pick_regular(state: dict) -> str | None:
    newest_first = [img["id"] for img in reversed(state["images"])]
    if not newest_first:
        return None
    order = state["playback_order"]
    if order == "random":
        return _pick_shuffled(state, newest_first)
    if order == "smart":
        return _pick_smart(state, newest_first)
    return _pick_sequence(state)


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _normalize_uploader_name(raw: str | None) -> str:
    name = " ".join(str(raw or "").split())
    return name[:40]


def _to_rgb(im: Image.Image) -> Image.Image:
    """Flatten alpha onto black and convert to RGB for JPEG output."""
    if im.mode == "RGB":
        return im
    if im.mode == "L":
        return im.convert("RGB")
    if im.mode == "P":
        im = im.convert("RGBA")
    if im.mode in ("RGBA", "LA"):
        rgba = im.convert("RGBA")
        background = Image.new("RGB", rgba.size, (0, 0, 0))
        background.paste(rgba, mask=rgba.split()[-1])
        return background
    return im.convert("RGB")


def _fit_max_edge(im: Image.Image, max_edge: int) -> Image.Image:
    w, h = im.size
    longest = max(w, h)
    if longest <= max_edge:
        return im
    scale = max_edge / longest
    return im.resize(
        (max(1, int(w * scale)), max(1, int(h * scale))),
        Image.Resampling.LANCZOS,
    )


def _compress_to_jpeg(im: Image.Image, dest: Path, max_bytes: int = MAX_STORED_BYTES) -> None:
    """Write JPEG under max_bytes by lowering quality, then shrinking dimensions."""
    working = _fit_max_edge(_to_rgb(im), MAX_IMAGE_EDGE)
    qualities = (85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35)

    for _ in range(10):
        for quality in qualities:
            buf = io.BytesIO()
            working.save(buf, "JPEG", quality=quality, optimize=True)
            data = buf.getvalue()
            if len(data) <= max_bytes:
                dest.write_bytes(data)
                return
        # Still over limit — shrink and retry
        nw = max(1, int(working.width * 0.7))
        nh = max(1, int(working.height * 0.7))
        if nw == working.width and nh == working.height:
            break
        working = working.resize((nw, nh), Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    working.save(buf, "JPEG", quality=30, optimize=True)
    data = buf.getvalue()
    if len(data) > max_bytes:
        raise ValueError(f"Could not compress image under {max_bytes // (1024 * 1024)} MB")
    dest.write_bytes(data)


_pillow_limit_lock = threading.Lock()


def _open_image(path: Path, unlimited: bool) -> Image.Image:
    """Open an image, optionally skipping Pillow's decompression-bomb pixel limit.

    MAX_IMAGE_PIXELS is process-global and only checked inside Image.open, so it is
    swapped under a lock to keep concurrent guest uploads checked.
    """
    with _pillow_limit_lock:
        previous = Image.MAX_IMAGE_PIXELS
        if unlimited:
            Image.MAX_IMAGE_PIXELS = None
        try:
            im = Image.open(path)
        finally:
            Image.MAX_IMAGE_PIXELS = previous
    if im.format == "JPEG":
        # Let libjpeg decode at 1/2, 1/4 or 1/8 scale so huge photos don't exhaust RAM
        w, h = im.size
        scale = MAX_IMAGE_EDGE / max(w, h)
        if scale < 1:
            im.draft(None, (max(1, int(w * scale)), max(1, int(h * scale))))
    return im


def _store_image(
    file_storage,
    source: str,
    priority: bool,
    uploader_name: str = "",
    unlimited_pixels: bool = False,
) -> dict:
    original = secure_filename(file_storage.filename or "upload.jpg")
    image_id = uuid.uuid4().hex
    filename = f"{image_id}.jpg"
    dest = UPLOAD_DIR / filename
    raw_path = UPLOAD_DIR / f"{image_id}.upload"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_storage.save(raw_path)

    # Orient via EXIF, then compress to JPEG under 5 MB for slideshow use
    try:
        with _open_image(raw_path, unlimited=unlimited_pixels) as im:
            im = ImageOps.exif_transpose(im)
            # Load fully before temp file is removed
            im.load()
            _compress_to_jpeg(im, dest)
    except Exception:
        raw_path.unlink(missing_ok=True)
        dest.unlink(missing_ok=True)
        raise
    finally:
        raw_path.unlink(missing_ok=True)

    record = {
        "id": image_id,
        "filename": filename,
        "original_name": original,
        "source": source,
        "uploader_name": _normalize_uploader_name(uploader_name),
        "created_at": _utc_now(),
    }

    with _lock:
        state = _load_state()
        _prune_missing(state)
        state["images"].append(record)
        if priority:
            state["priority_queue"].insert(0, image_id)
        else:
            state["rotation"].append(image_id)
        _save_state(state)

    return record


def _public_image(img: dict) -> dict:
    return {
        "id": img["id"],
        "url": f"/media/{img['filename']}",
        "created_at": img["created_at"],
        "source": img.get("source", "user"),
        "original_name": img.get("original_name", ""),
        "uploader_name": img.get("uploader_name", ""),
    }


@app.get("/")
def root():
    return render_template("upload.html")


@app.get("/upload")
def upload_page():
    return render_template("upload.html")


@app.get("/view")
def view_page():
    return render_template("view.html")


@app.get("/admin/login")
def admin_login_page():
    if _is_admin():
        return redirect(url_for("admin_page"))
    if not _admin_password():
        return (
            "ADMIN_PASSWORD is not set. Add it to .env and restart the server.",
            503,
        )
    return render_template("login.html")


@app.get("/admin")
@require_admin
def admin_page():
    return render_template("admin.html")


@app.post("/api/admin/login")
def api_admin_login():
    expected = _admin_password()
    if not expected:
        return jsonify({"ok": False, "error": "ADMIN_PASSWORD not configured"}), 503
    payload = request.get_json(silent=True) or {}
    password = payload.get("password", request.form.get("password", ""))
    if not isinstance(password, str) or not secrets.compare_digest(password, expected):
        return jsonify({"ok": False, "error": "Wrong password"}), 401
    session.clear()
    session["admin"] = True
    session.permanent = True
    return jsonify({"ok": True})


@app.post("/api/admin/logout")
def api_admin_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/media/<path:filename>")
def media(filename: str):
    safe = secure_filename(filename)
    if safe != filename or ".." in filename:
        abort(404)
    path = UPLOAD_DIR / safe
    if not path.is_file():
        abort(404)
    return send_from_directory(UPLOAD_DIR, safe)


@app.post("/api/upload")
def api_upload():
    """Single-image upload from /upload (priority queue)."""
    if "image" not in request.files:
        return jsonify({"ok": False, "error": "No image provided"}), 400
    f = request.files["image"]
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "Empty file"}), 400
    uploader_name = _normalize_uploader_name(
        request.form.get("uploader_name") or request.form.get("name")
    )
    if not uploader_name:
        return jsonify({"ok": False, "error": "Name is required"}), 400
    if not _allowed(f.filename) and Path(f.filename).suffix:
        # still try; extension check soft for camera blobs named blob
        pass
    try:
        record = _store_image(
            f,
            source="user",
            priority=True,
            uploader_name=uploader_name,
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, "image": _public_image(record)})


@app.post("/api/admin/upload")
@require_admin
def api_admin_upload():
    """Bulk upload from /admin (appended to rotation, no priority jump)."""
    files = request.files.getlist("images") or request.files.getlist("image")
    if not files:
        return jsonify({"ok": False, "error": "No images provided"}), 400

    saved = []
    errors = []
    for f in files:
        if not f or not f.filename:
            continue
        try:
            record = _store_image(f, source="admin", priority=False, unlimited_pixels=True)
            saved.append(_public_image(record))
        except Exception as exc:
            errors.append({"name": f.filename, "error": str(exc)})

    if not saved and errors:
        return jsonify({"ok": False, "errors": errors}), 400
    return jsonify({"ok": True, "images": saved, "errors": errors})


@app.get("/api/images")
@require_admin
def api_images():
    with _lock:
        state = _load_state()
        _prune_missing(state)
        _save_state(state)
        images = [_public_image(img) for img in reversed(state["images"])]
        return jsonify(
            {
                "ok": True,
                **_display_config(state),
                "available_transitions": TRANSITIONS,
                "available_qr_themes": QR_THEMES,
                "qr_size_range": QR_SIZE_RANGE,
                "images": images,
                "priority_pending": len(state["priority_queue"]),
            }
        )


@app.get("/api/slideshow/next")
def api_slideshow_next():
    """Pop next image: priority queue first (newest inserts at front), then rotation."""
    with _lock:
        state = _load_state()
        _prune_missing(state)

        image_id = None
        from_priority = False

        while state["priority_queue"] and image_id is None:
            candidate = state["priority_queue"].pop(0)
            if _image_by_id(state, candidate):
                image_id = candidate
                from_priority = True
                # After a priority play, park it for later loops (not next immediate slot)
                if candidate not in state["rotation"]:
                    state["rotation"].append(candidate)

        if image_id is None:
            image_id = _pick_regular(state)

        if image_id:
            state["recent"] = (state["recent"] + [image_id])[-RECENT_HISTORY:]
        _save_state(state)

        if not image_id:
            return jsonify(
                {
                    "ok": True,
                    "image": None,
                    **_display_config(state),
                    "empty": True,
                }
            )

        img = _image_by_id(state, image_id)
        return jsonify(
            {
                "ok": True,
                "image": _public_image(img) if img else None,
                **_display_config(state),
                "from_priority": from_priority,
                "empty": img is None,
            }
        )


@app.get("/api/config")
def api_config():
    with _lock:
        state = _load_state()
        return jsonify({"ok": True, **_display_config(state)})


@app.get("/api/qr-link")
def api_qr_link():
    """Resolve the URL to encode. target/base_url args let the admin preview unsaved settings."""
    with _lock:
        qr = dict(_load_state()["qr"])
    try:
        qr = _validate_qr(
            {k: request.args[k] for k in ("target", "base_url") if k in request.args}, qr
        )
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, "url": _qr_link(qr, request.args.get("origin", ""))})


@app.post("/api/admin/config")
@require_admin
def api_admin_config():
    payload = request.get_json(silent=True) or {}
    updates = {}

    duration = payload.get("slide_duration", request.form.get("slide_duration"))
    if duration is not None:
        try:
            duration = int(duration)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid duration"}), 400
        if duration < 1 or duration > 3600:
            return jsonify({"ok": False, "error": "Duration must be 1–3600 seconds"}), 400
        updates["slide_duration"] = duration

    if "transitions" in payload:
        transitions = _clean_transitions(payload["transitions"])
        if not transitions:
            return jsonify({"ok": False, "error": "Enable at least one transition"}), 400
        updates["transitions"] = transitions

    if "transition_mode" in payload:
        mode = payload["transition_mode"]
        if mode not in TRANSITION_MODES:
            return jsonify({"ok": False, "error": "Invalid transition mode"}), 400
        updates["transition_mode"] = mode

    if "playback_order" in payload:
        order = payload["playback_order"]
        if order not in PLAYBACK_ORDERS:
            return jsonify({"ok": False, "error": "Invalid photo order"}), 400
        updates["playback_order"] = order
        updates["deck"] = []

    if "qr" in payload:
        with _lock:
            current_qr = _load_state()["qr"]
        try:
            updates["qr"] = _validate_qr(payload["qr"], current_qr)
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    if not updates:
        return jsonify({"ok": False, "error": "Nothing to update"}), 400

    with _lock:
        state = _load_state()
        state.update(updates)
        _save_state(state)
        return jsonify({"ok": True, **_display_config(state)})


@app.delete("/api/admin/images/<image_id>")
@app.post("/api/admin/images/<image_id>/delete")
@require_admin
def api_admin_delete(image_id: str):
    with _lock:
        state = _load_state()
        img = _image_by_id(state, image_id)
        if not img:
            return jsonify({"ok": False, "error": "Not found"}), 404

        path = UPLOAD_DIR / img["filename"]
        if path.is_file():
            path.unlink(missing_ok=True)

        state["images"] = [i for i in state["images"] if i["id"] != image_id]
        state["priority_queue"] = [i for i in state["priority_queue"] if i != image_id]
        state["rotation"] = [i for i in state["rotation"] if i != image_id]
        if state["rotation"]:
            state["cursor"] %= len(state["rotation"])
        else:
            state["cursor"] = 0
        _save_state(state)

    return jsonify({"ok": True})


@app.post("/api/admin/clear")
@require_admin
def api_admin_clear():
    with _lock:
        state = _load_state()
        for img in state["images"]:
            path = UPLOAD_DIR / img["filename"]
            path.unlink(missing_ok=True)
        config = _display_config(state)
        state = _default_state()
        state.update(config)
        _save_state(state)
    return jsonify({"ok": True})


def create_app() -> Flask:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STATE_PATH.exists():
        _save_state(_default_state())
    if not _admin_password():
        print("WARNING: ADMIN_PASSWORD is empty — set it in .env")
    return app


if __name__ == "__main__":
    create_app()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5050"))
    print(f"Slideshow server on http://{host}:{port}")
    print("  /upload  phone upload")
    print("  /view    slideshow display")
    print("  /admin   manage images + duration (password required)")
    try:
        from waitress import serve

        # Waitress caps bodies at 1 GB by default; Flask enforces the guest limit instead
        serve(app, host=host, port=port, max_request_body_size=sys.maxsize)
    except ImportError:
        app.run(host=host, port=port, debug=False)
