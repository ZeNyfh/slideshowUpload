(() => {
  const root = document.getElementById("qrRoot");
  let lastKey = "";

  function applySize(pageSize) {
    const pct = Math.max(10, Math.min(100, Number(pageSize) || 80)) / 100;
    // 100% = fill the shorter viewport side (with a tiny inset so edges don't clip)
    const side = Math.min(window.innerWidth, window.innerHeight) * pct * 0.98;
    root.style.setProperty("--qr-size", `${side}px`);
  }

  async function refresh() {
    try {
      const [cfgRes, linkRes] = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch(`/api/qr-link?origin=${encodeURIComponent(window.location.origin)}`, {
          cache: "no-store",
        }),
      ]);
      const cfg = await cfgRes.json();
      const link = await linkRes.json();
      if (!cfg.ok || !cfg.qr || !link.ok) return;

      const qr = cfg.qr;
      applySize(qr.page_size);
      const key = JSON.stringify({
        url: link.url,
        theme: qr.theme,
        label: qr.label,
        page_size: qr.page_size,
      });
      if (key === lastKey) return;
      lastKey = key;
      window.SlideshowQR.render(root, {
        url: link.url,
        theme: qr.theme,
        label: qr.label,
      });
    } catch (_) {
      /* keep last good QR */
    }
  }

  window.addEventListener("resize", () => {
    // Re-apply size without rebuilding SVG unless needed
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.ok && cfg.qr) applySize(cfg.qr.page_size);
      })
      .catch(() => {});
  });

  refresh();
  setInterval(refresh, 4000);
})();
