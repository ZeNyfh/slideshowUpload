(() => {
  const durationInput = document.getElementById("duration");
  const saveDuration = document.getElementById("saveDuration");
  const durationStatus = document.getElementById("durationStatus");
  const playbackOrder = document.getElementById("playbackOrder");
  const compatMode = document.getElementById("compatMode");
  let slideshowDirty = false;
  const dropzone = document.getElementById("dropzone");
  const bulkInput = document.getElementById("bulkInput");
  const uploadStatus = document.getElementById("uploadStatus");
  const grid = document.getElementById("grid");
  const count = document.getElementById("count");
  const clearAll = document.getElementById("clearAll");
  const exportZip = document.getElementById("exportZip");
  const logoutBtn = document.getElementById("logoutBtn");
  const transitionMode = document.getElementById("transitionMode");
  const transitionList = document.getElementById("transitionList");
  const saveTransitions = document.getElementById("saveTransitions");
  const transitionStatus = document.getElementById("transitionStatus");

  const qrEnabled = document.getElementById("qrEnabled");
  const qrCorner = document.getElementById("qrCorner");
  const qrTheme = document.getElementById("qrTheme");
  const qrSize = document.getElementById("qrSize");
  const qrSizeOut = document.getElementById("qrSizeOut");
  const qrPageSize = document.getElementById("qrPageSize");
  const qrPageSizeOut = document.getElementById("qrPageSizeOut");
  const qrLabel = document.getElementById("qrLabel");
  const qrBaseUrl = document.getElementById("qrBaseUrl");
  const qrScreen = document.getElementById("qrScreen");
  const qrPreview = document.getElementById("qrPreview");
  const qrLinkText = document.getElementById("qrLinkText");
  const saveQr = document.getElementById("saveQr");
  const qrStatus = document.getElementById("qrStatus");
  let qrDirty = false;
  let qrLoaded = "";
  let qrPreviewTimer = null;

  const GROUP_LABELS = { classic: "Classic", spooky: "Spooky" };
  let availableTransitions = [];
  let transitionsDirty = false;

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
    if (!slideshowDirty) {
      durationInput.value = data.slide_duration;
      if (data.playback_order) playbackOrder.value = data.playback_order;
      if (typeof data.compat_mode === "boolean") compatMode.checked = data.compat_mode;
    }
    renderTransitions(data);
    renderQr(data);
    count.textContent = `(${data.images.length})`;
    grid.innerHTML = "";
    for (const img of data.images) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <img src="${img.url}" alt="" loading="lazy" />
        <button type="button" class="del" title="Delete" data-id="${img.id}">×</button>
        <div class="meta">${img.uploader_name ? img.uploader_name + " · " : ""}${img.source || "user"} · ${new Date(img.created_at).toLocaleString()}</div>
      `;
      grid.appendChild(card);
    }
  }

  function renderTransitions(data) {
    if (transitionsDirty) return;
    if (!availableTransitions.length && Array.isArray(data.available_transitions)) {
      availableTransitions = data.available_transitions;
      transitionList.innerHTML = "";
      for (const group of Object.keys(GROUP_LABELS)) {
        const items = availableTransitions.filter((t) => t.group === group);
        if (!items.length) continue;
        const heading = document.createElement("h3");
        heading.className = "tx-group";
        heading.textContent = GROUP_LABELS[group];
        const grid = document.createElement("div");
        grid.className = "tx-grid";
        for (const t of items) {
          const label = document.createElement("label");
          label.className = "tx-option";
          label.innerHTML = `
            <input type="checkbox" value="${t.name}" data-group="${t.group}" />
            <span><strong>${t.label}</strong><small>${t.name}</small></span>
          `;
          grid.appendChild(label);
        }
        transitionList.append(heading, grid);
      }
    }
    const enabled = new Set(data.transitions || []);
    transitionList.querySelectorAll("input[type=checkbox]").forEach((box) => {
      box.checked = enabled.has(box.value);
    });
    if (data.transition_mode) transitionMode.value = data.transition_mode;
  }

  function renderQr(data) {
    if (!qrTheme.options.length && Array.isArray(data.available_qr_themes)) {
      for (const t of data.available_qr_themes) qrTheme.add(new Option(t.label, t.name));
      if (Array.isArray(data.qr_size_range)) [qrSize.min, qrSize.max] = data.qr_size_range;
      if (Array.isArray(data.qr_page_size_range)) {
        [qrPageSize.min, qrPageSize.max] = data.qr_page_size_range;
      }
    }
    if (qrDirty || !data.qr) return;
    const key = JSON.stringify(data.qr);
    if (key === qrLoaded) return;
    qrLoaded = key;
    qrEnabled.checked = data.qr.enabled;
    qrCorner.value = data.qr.corner;
    qrTheme.value = data.qr.theme;
    qrSize.value = data.qr.size;
    qrPageSize.value = data.qr.page_size ?? 80;
    qrLabel.value = data.qr.label;
    qrBaseUrl.value = data.qr.base_url;
    updateQrPreview();
  }

  function readQrForm() {
    return {
      enabled: qrEnabled.checked,
      corner: qrCorner.value,
      theme: qrTheme.value,
      size: Number(qrSize.value),
      page_size: Number(qrPageSize.value),
      label: qrLabel.value,
      base_url: qrBaseUrl.value.trim(),
    };
  }

  function updateQrPreview() {
    clearTimeout(qrPreviewTimer);
    qrPreviewTimer = setTimeout(async () => {
      const qr = readQrForm();
      qrSizeOut.textContent = `${qr.size}%`;
      qrPageSizeOut.textContent = `${qr.page_size}%`;
      qrScreen.dataset.corner = qr.corner;
      qrScreen.classList.toggle("is-off", !qr.enabled);
      // Display uses vmin of a 16:9 screen, i.e. a share of the preview's height
      qrPreview.style.setProperty("--qr-size", `${(qr.size / 100) * qrScreen.clientHeight}px`);
      const params = new URLSearchParams({ origin: window.location.origin, base_url: qr.base_url });
      try {
        const res = await fetch(`/api/qr-link?${params}`, { cache: "no-store" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Invalid URL");
        window.SlideshowQR.render(qrPreview, { url: data.url, theme: qr.theme, label: qr.label });
        qrLinkText.textContent = data.url;
      } catch (err) {
        qrLinkText.textContent = err.message;
      }
    }, 120);
  }

  [qrEnabled, qrCorner, qrTheme, qrSize, qrPageSize, qrLabel, qrBaseUrl].forEach((el) =>
    el.addEventListener("input", () => {
      qrDirty = true;
      setMsg(qrStatus, "Unsaved changes");
      updateQrPreview();
    })
  );
  window.addEventListener("resize", updateQrPreview);

  saveQr.addEventListener("click", async () => {
    setMsg(qrStatus, "Saving…");
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr: readQrForm() }),
      });
      if (!ensureAuth(res)) return;
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
      qrDirty = false;
      qrLoaded = JSON.stringify(data.qr);
      qrBaseUrl.value = data.qr.base_url;
      setMsg(qrStatus, data.qr.enabled ? "Saved" : "Saved (hidden on slideshow)", "ok");
    } catch (err) {
      setMsg(qrStatus, err.message, "err");
    }
  });

  function markTransitionsDirty() {
    transitionsDirty = true;
    setMsg(transitionStatus, "Unsaved changes");
  }

  transitionList.addEventListener("change", markTransitionsDirty);
  transitionMode.addEventListener("change", markTransitionsDirty);

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-preset");
      transitionList.querySelectorAll("input[type=checkbox]").forEach((box) => {
        box.checked = preset === "all" || box.dataset.group === preset;
      });
      markTransitionsDirty();
    });
  });

  saveTransitions.addEventListener("click", async () => {
    const transitions = [...transitionList.querySelectorAll("input[type=checkbox]:checked")].map((b) => b.value);
    if (!transitions.length) {
      setMsg(transitionStatus, "Pick at least one transition.", "err");
      return;
    }
    setMsg(transitionStatus, "Saving…");
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transitions, transition_mode: transitionMode.value }),
      });
      if (!ensureAuth(res)) return;
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
      transitionsDirty = false;
      setMsg(transitionStatus, `Saved: ${data.transitions.length} enabled`, "ok");
    } catch (err) {
      setMsg(transitionStatus, err.message, "err");
    }
  });

  [durationInput, playbackOrder].forEach((el) =>
    el.addEventListener("input", () => {
      slideshowDirty = true;
      setMsg(durationStatus, "Unsaved changes");
    })
  );
  compatMode.addEventListener("change", () => {
    slideshowDirty = true;
    setMsg(durationStatus, "Unsaved changes");
  });

  saveDuration.addEventListener("click", async () => {
    const slide_duration = Number(durationInput.value);
    setMsg(durationStatus, "Saving…");
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_duration,
          playback_order: playbackOrder.value,
          compat_mode: compatMode.checked,
        }),
      });
      if (!ensureAuth(res)) return;
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
      slideshowDirty = false;
      const orderLabel = playbackOrder.options[playbackOrder.selectedIndex].text.split(" (")[0];
      const compatNote = data.compat_mode ? ", compatibility on" : "";
      setMsg(durationStatus, `Saved: ${data.slide_duration}s, ${orderLabel}${compatNote}`, "ok");
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

  exportZip.addEventListener("click", () => {
    window.location.href = "/api/admin/export";
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
