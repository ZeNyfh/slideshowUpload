"""Slideshow upload server: /upload, /view, /admin."""

from __future__ import annotations

import json
import os
import secrets
import threading
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

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
MAX_CONTENT_LENGTH = 20 * 1024 * 1024  # 20 MB
DEFAULT_DURATION = 5

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

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
        "images": [],
        "priority_queue": [],
        "rotation": [],
        "cursor": 0,
    }


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
    if state["rotation"]:
        state["cursor"] %= len(state["rotation"])
    else:
        state["cursor"] = 0


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _normalize_uploader_name(raw: str | None) -> str:
    name = " ".join(str(raw or "").split())
    return name[:40]


def _store_image(
    file_storage,
    source: str,
    priority: bool,
    uploader_name: str = "",
) -> dict:
    original = secure_filename(file_storage.filename or "upload.jpg")
    ext = Path(original).suffix.lower()
    if not ext or ext not in ALLOWED_EXTENSIONS:
        ext = ".jpg"

    image_id = uuid.uuid4().hex
    filename = f"{image_id}{ext}"
    dest = UPLOAD_DIR / filename
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_storage.save(dest)

    # Apply EXIF orientation (phone cameras) then bake pixels so /view is upright
    try:
        with Image.open(dest) as im:
            fmt = (im.format or "").upper()
            im = ImageOps.exif_transpose(im)
            needs_jpeg = ext in {".heic", ".heif"} or fmt not in {"JPEG", "PNG", "GIF", "WEBP"}
            if needs_jpeg or im.mode not in ("RGB", "L", "RGBA", "P"):
                if im.mode not in ("RGB", "L"):
                    im = im.convert("RGB")
                filename = f"{image_id}.jpg"
                new_dest = UPLOAD_DIR / filename
                im.save(new_dest, "JPEG", quality=90)
                if new_dest != dest and dest.exists():
                    dest.unlink(missing_ok=True)
            else:
                save_fmt = fmt if fmt in {"JPEG", "PNG", "GIF", "WEBP"} else "JPEG"
                if save_fmt == "JPEG" and im.mode not in ("RGB", "L"):
                    im = im.convert("RGB")
                save_kwargs = {"quality": 90} if save_fmt == "JPEG" else {}
                # Re-save without Orientation tag so browsers don't double-rotate
                im.save(dest, save_fmt, **save_kwargs)
    except Exception:
        # Keep original bytes if Pillow cannot process
        pass

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
            record = _store_image(f, source="admin", priority=False)
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
                "slide_duration": state["slide_duration"],
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
            if not state["rotation"]:
                # rebuild rotation from all images, newest first
                state["rotation"] = [img["id"] for img in reversed(state["images"])]
                state["cursor"] = 0
            if state["rotation"]:
                if state["cursor"] >= len(state["rotation"]):
                    state["cursor"] = 0
                image_id = state["rotation"][state["cursor"]]
                state["cursor"] = (state["cursor"] + 1) % len(state["rotation"])

        _save_state(state)

        if not image_id:
            return jsonify(
                {
                    "ok": True,
                    "image": None,
                    "slide_duration": state["slide_duration"],
                    "empty": True,
                }
            )

        img = _image_by_id(state, image_id)
        return jsonify(
            {
                "ok": True,
                "image": _public_image(img) if img else None,
                "slide_duration": state["slide_duration"],
                "from_priority": from_priority,
                "empty": img is None,
            }
        )


@app.get("/api/config")
def api_config():
    with _lock:
        state = _load_state()
        return jsonify({"ok": True, "slide_duration": state["slide_duration"]})


@app.post("/api/admin/config")
@require_admin
def api_admin_config():
    payload = request.get_json(silent=True) or {}
    duration = payload.get("slide_duration", request.form.get("slide_duration"))
    try:
        duration = int(duration)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid duration"}), 400
    if duration < 1 or duration > 3600:
        return jsonify({"ok": False, "error": "Duration must be 1–3600 seconds"}), 400

    with _lock:
        state = _load_state()
        state["slide_duration"] = duration
        _save_state(state)
    return jsonify({"ok": True, "slide_duration": duration})


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
        duration = state["slide_duration"]
        state = _default_state()
        state["slide_duration"] = duration
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

        serve(app, host=host, port=port)
    except ImportError:
        app.run(host=host, port=port, debug=False)
