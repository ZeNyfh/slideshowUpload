(() => {
  const NAME_KEY = "slideshowUpload.uploaderName";
  const NAME_TTL_MS = 24 * 60 * 60 * 1000;

  const nameInput = document.getElementById("nameInput");
  const saveNameBtn = document.getElementById("saveNameBtn");
  const nameStatus = document.getElementById("nameStatus");
  const uploadArea = document.getElementById("uploadArea");
  const uploadActions = document.getElementById("uploadActions");
  const gateMsg = document.getElementById("gateMsg");
  const greetingName = document.getElementById("greetingName");
  const changeNameBtn = document.getElementById("changeNameBtn");
  const cameraBtn = document.getElementById("cameraBtn");
  const fileBtn = document.getElementById("fileBtn");
  const sendBtn = document.getElementById("sendBtn");
  const cameraInput = document.getElementById("cameraInput");
  const fileInput = document.getElementById("fileInput");
  const preview = document.getElementById("preview");
  const previewGrid = document.getElementById("previewGrid");
  const status = document.getElementById("status");
  const webcamPanel = document.getElementById("webcamPanel");
  const webcamVideo = document.getElementById("webcamVideo");
  const webcamCaptureBtn = document.getElementById("webcamCaptureBtn");
  const webcamCancelBtn = document.getElementById("webcamCancelBtn");

  let selectedFiles = []; // { file, url } for each photo queued to send
  let busy = false;
  let uploaderName = "";
  let webcamStream = null;
  let editingName = false;
  let hasSent = false;

  /** True for phones/tablets; false for PC/laptop (macOS, Windows, Linux). */
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
      return true;
    }
    if (/iPad/i.test(ua)) return true;
    // iPadOS 13+ reports as Macintosh with touch
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
      return true;
    }
    return false;
  }

  const useLiveWebcam =
    !isMobileDevice() &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function";

  function setStatus(msg, kind) {
    status.textContent = msg || "";
    status.className = "status" + (kind ? ` ${kind}` : "");
  }

  function setNameStatus(msg, kind) {
    nameStatus.textContent = msg || "";
    nameStatus.className = "status" + (kind ? ` ${kind}` : "");
  }

  function normalizeName(raw) {
    return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 40);
  }

  function readCachedName() {
    try {
      const raw = localStorage.getItem(NAME_KEY);
      if (!raw) return "";
      const data = JSON.parse(raw);
      if (!data || typeof data.name !== "string" || typeof data.expires !== "number") {
        localStorage.removeItem(NAME_KEY);
        return "";
      }
      if (Date.now() > data.expires) {
        localStorage.removeItem(NAME_KEY);
        return "";
      }
      return normalizeName(data.name);
    } catch (_) {
      localStorage.removeItem(NAME_KEY);
      return "";
    }
  }

  function writeCachedName(name) {
    const payload = {
      name,
      expires: Date.now() + NAME_TTL_MS,
    };
    localStorage.setItem(NAME_KEY, JSON.stringify(payload));
  }

  function stopWebcam() {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      webcamStream = null;
    }
    webcamVideo.srcObject = null;
    webcamPanel.hidden = true;
    uploadActions.hidden = false;
    if (selectedFiles.length) {
      preview.classList.add("visible");
      sendBtn.hidden = false;
    }
    updateLayout();
  }

  async function openWebcam() {
    if (busy || !uploaderName) return;
    stopWebcam();
    setStatus("Requesting camera…", "");
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      webcamVideo.srcObject = webcamStream;
      await webcamVideo.play().catch(() => {});
      preview.classList.remove("visible");
      sendBtn.hidden = true;
      uploadActions.hidden = true;
      webcamPanel.hidden = false;
      updateLayout();
      setStatus("Look at the camera, then Capture.", "");
    } catch (err) {
      stopWebcam();
      const denied =
        err && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      setStatus(
        denied
          ? "Camera permission denied. Allow access or use Upload images."
          : "Could not open webcam. Use Upload images instead.",
        "err"
      );
    }
  }

  function captureWebcam() {
    if (!webcamStream || busy) return;
    const w = webcamVideo.videoWidth || 1280;
    const h = webcamVideo.videoHeight || 720;
    if (!w || !h) {
      setStatus("Camera not ready yet.", "err");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // Match mirrored preview so the saved photo looks like what the user saw
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(webcamVideo, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        stopWebcam();
        if (!blob) {
          setStatus("Could not capture photo.", "err");
          return;
        }
        const file = new File([blob], "webcam.jpg", { type: "image/jpeg" });
        onFilesPicked([file]);
      },
      "image/jpeg",
      0.92
    );
  }

  /** Once a photo is picked/sent, drop the name card + intro so everything fits on screen. */
  function updateLayout() {
    const count = selectedFiles.length;
    const hasPhoto = count > 0;
    const compact = Boolean(uploaderName) && !editingName && (hasPhoto || hasSent || Boolean(webcamStream));
    document.body.classList.toggle("is-compact", compact);
    uploadActions.classList.toggle("has-photo", hasPhoto);
    cameraBtn.textContent = hasPhoto ? "Take another" : "Take a picture";
    fileBtn.textContent = hasPhoto ? "Choose more" : "Upload images";
    sendBtn.textContent = count > 1 ? `Send ${count} photos to slideshow` : "Send to slideshow";
  }

  function applyNameGate() {
    const ready = Boolean(uploaderName);
    uploadArea.hidden = !ready;
    uploadArea.classList.toggle("is-locked", !ready);
    gateMsg.hidden = ready;
    cameraBtn.disabled = !ready || busy;
    fileBtn.disabled = !ready || busy;
    if (ready) {
      greetingName.textContent = uploaderName;
      saveNameBtn.textContent = "Update name";
    } else {
      greetingName.textContent = "";
      saveNameBtn.textContent = "Save name";
      stopWebcam();
      resetSelection();
    }
    updateLayout();
  }

  function saveName() {
    const name = normalizeName(nameInput.value);
    if (name.length < 1) {
      setNameStatus("Please enter your name.", "err");
      uploaderName = "";
      applyNameGate();
      return;
    }
    uploaderName = name;
    nameInput.value = name;
    writeCachedName(name);
    editingName = false;
    setNameStatus("Name saved!", "ok");
    applyNameGate();
  }

  function revokeSelection() {
    selectedFiles.forEach((item) => URL.revokeObjectURL(item.url));
    selectedFiles = [];
  }

  function resetSelection() {
    revokeSelection();
    previewGrid.replaceChildren();
    preview.classList.remove("visible", "single", "multiple");
    preview.style.removeProperty("--photo-ratio");
    sendBtn.hidden = true;
    cameraInput.value = "";
    fileInput.value = "";
    updateLayout();
  }

  function readyMessage() {
    const count = selectedFiles.length;
    return count > 1 ? `Ready to send ${count} photos.` : "Ready to send.";
  }

  function renderPreview() {
    previewGrid.replaceChildren();
    preview.classList.toggle("single", selectedFiles.length === 1);
    preview.classList.toggle("multiple", selectedFiles.length > 1);

    selectedFiles.forEach((item, index) => {
      const tile = document.createElement("div");
      tile.className = "preview-tile";

      const img = document.createElement("img");
      img.src = item.url;
      img.alt = `Selected photo ${index + 1}`;
      img.loading = "lazy";
      if (index === 0) {
        img.addEventListener("load", () => {
          if (selectedFiles.length === 1 && selectedFiles[0].url === item.url) {
            if (img.naturalWidth && img.naturalHeight) {
              preview.style.setProperty(
                "--photo-ratio",
                `${img.naturalWidth} / ${img.naturalHeight}`
              );
            }
          }
        });
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "preview-remove";
      removeBtn.setAttribute("aria-label", `Remove photo ${index + 1}`);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => removeFile(index));

      tile.append(img, removeBtn);
      previewGrid.append(tile);
    });
  }

  function removeFile(index) {
    const [removed] = selectedFiles.splice(index, 1);
    if (removed) URL.revokeObjectURL(removed.url);
    if (!selectedFiles.length) {
      resetSelection();
      setStatus("", "");
      return;
    }
    renderPreview();
    setStatus(readyMessage(), "");
    updateLayout();
  }

  function onFilesPicked(files) {
    if (!uploaderName) {
      setStatus("Save your name first.", "err");
      return;
    }
    const picked = Array.from(files || []).filter(
      (file) => file && file.type && file.type.startsWith("image/")
    );
    if (!picked.length) {
      setStatus("Please choose an image.", "err");
      return;
    }

    selectedFiles.push(
      ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))
    );
    renderPreview();
    preview.classList.add("visible");
    sendBtn.hidden = false;
    setStatus(readyMessage(), "");
    updateLayout();
  }

  saveNameBtn.addEventListener("click", saveName);
  changeNameBtn.addEventListener("click", () => {
    editingName = true;
    setNameStatus("", "");
    updateLayout();
    nameInput.focus();
    nameInput.select();
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    }
  });

  cameraBtn.addEventListener("click", () => {
    if (busy || !uploaderName) return;
    if (useLiveWebcam) {
      openWebcam();
    } else {
      cameraInput.click();
    }
  });

  fileBtn.addEventListener("click", () => {
    if (busy || !uploaderName) return;
    stopWebcam();
    fileInput.click();
  });

  webcamCaptureBtn.addEventListener("click", captureWebcam);
  webcamCancelBtn.addEventListener("click", () => {
    stopWebcam();
    setStatus(selectedFiles.length ? readyMessage() : "", "");
  });

  cameraInput.addEventListener("change", () => {
    const files = cameraInput.files ? Array.from(cameraInput.files) : [];
    cameraInput.value = "";
    if (files.length) onFilesPicked(files);
  });

  fileInput.addEventListener("change", () => {
    const files = fileInput.files ? Array.from(fileInput.files) : [];
    fileInput.value = "";
    if (files.length) onFilesPicked(files);
  });

  sendBtn.addEventListener("click", async () => {
    if (!selectedFiles.length || busy) return;
    const name = normalizeName(nameInput.value) || uploaderName;
    if (!name) {
      setStatus("Save your name first.", "err");
      applyNameGate();
      return;
    }
    uploaderName = name;
    writeCachedName(name);

    busy = true;
    cameraBtn.disabled = true;
    fileBtn.disabled = true;
    sendBtn.disabled = true;
    const total = selectedFiles.length;
    setStatus(total > 1 ? `Uploading ${total} photos…` : "Uploading…", "");

    const body = new FormData();
    selectedFiles.forEach(({ file }) => {
      body.append("images", file, file.name || "photo.jpg");
    });
    body.append("uploader_name", name);

    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const firstError = data.errors && data.errors[0] && data.errors[0].error;
        throw new Error(firstError || data.error || "Upload failed");
      }
      const saved = Array.isArray(data.images)
        ? data.images
        : data.image
        ? [data.image]
        : [];
      const failed = Array.isArray(data.errors) ? data.errors.length : 0;
      const count = saved.length;
      const label = count === 1 ? "photo" : "photos";
      if (failed) {
        setStatus(
          `Sent ${count} ${label}. ${failed} could not be uploaded.`,
          count ? "ok" : "err"
        );
      } else {
        setStatus(
          count === 1
            ? "Sent 1 photo! It will show up soon."
            : `Sent ${count} photos! They will show up soon.`,
          "ok"
        );
      }
      hasSent = true;
      resetSelection();
    } catch (err) {
      setStatus(err.message || "Upload failed", "err");
    } finally {
      busy = false;
      applyNameGate();
      sendBtn.disabled = false;
    }
  });

  window.addEventListener("pagehide", stopWebcam);
  window.addEventListener("beforeunload", stopWebcam);

  uploaderName = readCachedName();
  if (uploaderName) {
    nameInput.value = uploaderName;
    setNameStatus("Welcome back!", "ok");
  }
  applyNameGate();
})();
