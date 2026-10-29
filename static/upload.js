(() => {
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

  function setStatus(msg, kind) {
    status.textContent = msg || "";
    status.className = "status" + (kind ? ` ${kind}` : "");
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

  cameraBtn.addEventListener("click", () => {
    if (busy) return;
    cameraInput.click();
  });

  fileBtn.addEventListener("click", () => {
    if (busy) return;
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
    busy = true;
    cameraBtn.disabled = true;
    fileBtn.disabled = true;
    sendBtn.disabled = true;
    setStatus("Uploading…", "");

    const body = new FormData();
    body.append("image", selectedFile, selectedFile.name || "photo.jpg");

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
      cameraBtn.disabled = false;
      fileBtn.disabled = false;
      sendBtn.disabled = false;
    }
  });
})();
