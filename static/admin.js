(() => {
  const durationInput = document.getElementById("duration");
  const saveDuration = document.getElementById("saveDuration");
  const durationStatus = document.getElementById("durationStatus");
  const dropzone = document.getElementById("dropzone");
  const bulkInput = document.getElementById("bulkInput");
  const uploadStatus = document.getElementById("uploadStatus");
  const grid = document.getElementById("grid");
  const count = document.getElementById("count");
  const clearAll = document.getElementById("clearAll");
  const logoutBtn = document.getElementById("logoutBtn");

  function setMsg(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "status" + (kind ? ` ${kind}` : "");
  }

  function ensureAuth(res) {
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return false;
    }
    return true;
  }

  async function load() {
    const res = await fetch("/api/images", { cache: "no-store" });
    if (!ensureAuth(res)) return;
    const data = await res.json();
    if (!data.ok) return;
    durationInput.value = data.slide_duration;
    count.textContent = `(${data.images.length})`;
    grid.innerHTML = "";
    for (const img of data.images) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <img src="${img.url}" alt="" loading="lazy" />
        <button type="button" class="del" title="Delete" data-id="${img.id}">×</button>
        <div class="meta">${img.source || "user"} · ${new Date(img.created_at).toLocaleString()}</div>
      `;
      grid.appendChild(card);
    }
  }

  saveDuration.addEventListener("click", async () => {
    const slide_duration = Number(durationInput.value);
    setMsg(durationStatus, "Saving…");
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slide_duration }),
      });
      if (!ensureAuth(res)) return;
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
      setMsg(durationStatus, `Saved: ${data.slide_duration}s`, "ok");
    } catch (err) {
      setMsg(durationStatus, err.message, "err");
    }
  });

  async function uploadFiles(files) {
    if (!files || !files.length) return;
    setMsg(uploadStatus, `Uploading ${files.length}…`);
    const body = new FormData();
    for (const f of files) body.append("images", f);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body });
      if (!ensureAuth(res)) return;
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
      const n = (data.images || []).length;
      setMsg(uploadStatus, `Added ${n} image${n === 1 ? "" : "s"}.`, "ok");
      await load();
    } catch (err) {
      setMsg(uploadStatus, err.message, "err");
    }
  }

  dropzone.addEventListener("click", () => bulkInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      bulkInput.click();
    }
  });

  bulkInput.addEventListener("change", () => {
    uploadFiles(bulkInput.files);
    bulkInput.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    uploadFiles(files);
  });

  grid.addEventListener("click", async (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    if (!confirm("Delete this photo?")) return;
    const res = await fetch(`/api/admin/images/${id}/delete`, { method: "POST" });
    if (!ensureAuth(res)) return;
    const data = await res.json();
    if (res.ok && data.ok) await load();
  });

  clearAll.addEventListener("click", async () => {
    if (!confirm("Delete ALL photos?")) return;
    const res = await fetch("/api/admin/clear", { method: "POST" });
    if (!ensureAuth(res)) return;
    const data = await res.json();
    if (res.ok && data.ok) {
      setMsg(uploadStatus, "All photos deleted.", "ok");
      await load();
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  });

  load();
  setInterval(load, 8000);
})();
