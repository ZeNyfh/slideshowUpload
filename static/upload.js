(() => {
  const NAME_KEY = "slideshowUpload.uploaderName";
  const NAME_TTL_MS = 24 * 60 * 60 * 1000;

  const nameInput = document.getElementById("nameInput");
  const saveNameBtn = document.getElementById("saveNameBtn");
  const nameStatus = document.getElementById("nameStatus");
  const uploadArea = document.getElementById("uploadArea");
  const gateMsg = document.getElementById("gateMsg");
  const greeting = document.getElementById("greeting");
  const cameraBtn = document.getElementById("cameraBtn");
  const fileBtn = document.getElementById("fileBtn");
  const sendBtn = document.getElementById("sendBtn");
  const cameraInput = document.getElementById("cameraInput");
  const fileInput = document.getElementById("fileInput");
  const preview = document.getElementById("preview");
  const previewImg = document.getElementById("previewImg");
  const status = document.getElementById("status");

  let selectedFile = null;
  let busy = false;
  let uploaderName = "";

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

  function applyNameGate() {
    const ready = Boolean(uploaderName);
    uploadArea.hidden = !ready;
    uploadArea.classList.toggle("is-locked", !ready);
    gateMsg.hidden = ready;
    cameraBtn.disabled = !ready || busy;
    fileBtn.disabled = !ready || busy;
    if (ready) {
      greeting.textContent = `Uploading as ${uploaderName}`;
      saveNameBtn.textContent = "Update name";
    } else {
      greeting.textContent = "";
      saveNameBtn.textContent = "Save name";
      resetSelection();
    }
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
    setNameStatus("Name saved!", "ok");
    applyNameGate();
  }

  function resetSelection() {
    selectedFile = null;
    preview.classList.remove("visible");
    previewImg.removeAttribute("src");
    sendBtn.hidden = true;
    cameraInput.value = "";
    fileInput.value = "";
  }

  function onPicked(file) {
    if (!uploaderName) {
      setStatus("Save your name first.", "err");
      return;
    }
    if (!file || !file.type.startsWith("image/")) {
      setStatus("Please choose an image.", "err");
      return;
    }
    selectedFile = file;
    const url = URL.createObjectURL(file);
    previewImg.onload = () => URL.revokeObjectURL(url);
    previewImg.src = url;
    preview.classList.add("visible");
    sendBtn.hidden = false;
    setStatus("Ready to send.", "");
  }

  saveNameBtn.addEventListener("click", saveName);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    }
  });

  cameraBtn.addEventListener("click", () => {
    if (busy || !uploaderName) return;
    cameraInput.click();
  });

  fileBtn.addEventListener("click", () => {
    if (busy || !uploaderName) return;
    fileInput.click();
  });

  cameraInput.addEventListener("change", () => {
    const file = cameraInput.files && cameraInput.files[0];
    onPicked(file);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    onPicked(file);
  });

  sendBtn.addEventListener("click", async () => {
    if (!selectedFile || busy) return;
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
    setStatus("Uploading…", "");

    const body = new FormData();
    body.append("image", selectedFile, selectedFile.name || "photo.jpg");
    body.append("uploader_name", name);

    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setStatus("Sent! It will show up soon.", "ok");
      resetSelection();
    } catch (err) {
      setStatus(err.message || "Upload failed", "err");
    } finally {
      busy = false;
      applyNameGate();
      sendBtn.disabled = false;
    }
  });

  uploaderName = readCachedName();
  if (uploaderName) {
    nameInput.value = uploaderName;
    setNameStatus("Welcome back — name remembered for 24 hours.", "ok");
  }
  applyNameGate();
})();
