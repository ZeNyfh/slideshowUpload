(() => {
  /* Keys must match QR_THEMES in app.py. Finder "pupils" stay dark so scanners lock on. */
  const THEMES = {
    classic: { fg: "#000000", bg: "#ffffff", eye: "#000000", pupil: "#000000", modules: "square", eyes: "square" },
    soft: { fg: "#1c1f26", bg: "#ffffff", eye: "#1c1f26", pupil: "#1c1f26", modules: "dot", eyes: "round" },
    pumpkin: { fg: "#2a1000", bg: "#ff9a2e", eye: "#2a1000", pupil: "#2a1000", modules: "rounded", eyes: "round", icon: "pumpkin" },
    ghost: { fg: "#1b2340", bg: "#f4fbff", eye: "#1b2340", pupil: "#2a3a8c", modules: "dot", eyes: "circle", icon: "ghost" },
    blood: { fg: "#5e000e", bg: "#f3ead8", eye: "#7a0012", pupil: "#8a0014", modules: "rounded", eyes: "round" },
    witch: { fg: "#2b0a4d", bg: "#c9ff72", eye: "#2b0a4d", pupil: "#4a128a", modules: "dot", eyes: "circle", icon: "hat" },
    neon: { fg: "#000000", bg: "#ffffff", eye: "#000000", pupil: "#064d00", modules: "square", eyes: "square" },
    bats: { fg: "#120d1a", bg: "#e9e6ef", eye: "#120d1a", pupil: "#120d1a", modules: "rounded", eyes: "round", icon: "bat" },
  };

  const EYE_RADII = { square: [0, 0, 0], round: [1.6, 1.1, 0.8], circle: [3.5, 2.5, 1.5] };

  /* Icons drawn in a 0..1 box: fg silhouette with bg-coloured details. */
  const ICONS = {
    pumpkin: (fg, bg) => `
      <rect x=".45" y=".08" width=".1" height=".18" rx=".03" fill="${fg}"/>
      <ellipse cx=".5" cy=".57" rx=".45" ry=".36" fill="${fg}"/>
      <path fill="${bg}" d="M.27 .52L.37 .38L.44 .53ZM.73 .52L.63 .38L.56 .53Z"/>
      <path fill="${bg}" d="M.24 .63Q.5 .88 .76 .63L.66 .67L.6 .61L.54 .69L.46 .61L.4 .69L.34 .63Z"/>`,
    ghost: (fg, bg) => `
      <path fill="${fg}" d="M.2 .92V.46A.3 .3 0 0 1 .8 .46V.92L.7 .82L.6 .92L.5 .82L.4 .92L.3 .82Z"/>
      <ellipse cx=".4" cy=".46" rx=".06" ry=".09" fill="${bg}"/>
      <ellipse cx=".6" cy=".46" rx=".06" ry=".09" fill="${bg}"/>
      <ellipse cx=".5" cy=".64" rx=".05" ry=".07" fill="${bg}"/>`,
    hat: (fg, bg) => `
      <path fill="${fg}" d="M.56 .06Q.42 .3 .32 .62L.08 .7Q.5 .9 .92 .7L.68 .62Q.62 .36 .56 .06Z"/>
      <path fill="${bg}" d="M.31 .6Q.5 .68 .69 .6L.67 .52Q.5 .58 .33 .52Z"/>`,
    bat: (fg) => `
      <path fill="${fg}" transform="translate(0 .25) scale(.015625)" d="M32 10C30 6 28 6 27 9C24 6 18 4 12 6C15 8 16 11 15 14C11 12 5 12 0 16C6 17 10 20 12 24C15 21 20 21 23 23C25 20 28 19 32 22C36 19 39 20 41 23C44 21 49 21 52 24C54 20 58 17 64 16C59 12 53 12 49 14C48 11 49 8 52 6C46 4 40 6 37 9C36 6 34 6 32 10Z"/>`,
  };

  function buildSvg(text, themeName) {
    const t = THEMES[themeName] || THEMES.classic;
    const qr = qrcode(0, "H");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 0;
    const size = n + quiet * 2;

    const eyeOrigins = [[0, 0], [0, n - 7], [n - 7, 0]];
    const inEye = (r, c) => eyeOrigins.some(([er, ec]) => r >= er && r < er + 7 && c >= ec && c < ec + 7);

    // Clear a centred square for the icon; level-H error correction absorbs the loss
    let icon = null;
    if (t.icon) {
      let k = Math.round(n * 0.22);
      if ((n - k) % 2) k += 1;
      icon = { start: (n - k) / 2, k };
    }
    const inIcon = (r, c) =>
      icon && r >= icon.start && r < icon.start + icon.k && c >= icon.start && c < icon.start + icon.k;

    let modules = "";
    for (let r = 0; r < n; r++) {
      let run = -1;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && qr.isDark(r, c) && !inEye(r, c) && !inIcon(r, c);
        const x = c + quiet;
        const y = r + quiet;
        if (t.modules === "square") {
          // merge horizontal runs into one rect to keep the SVG small
          if (dark && run < 0) run = x;
          if (!dark && run >= 0) {
            modules += `<rect x="${run}" y="${y}" width="${x - run}" height="1.02"/>`;
            run = -1;
          }
        } else if (dark && t.modules === "dot") {
          modules += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r=".46"/>`;
        } else if (dark) {
          modules += `<rect x="${x + 0.06}" y="${y + 0.06}" width=".88" height=".88" rx=".3"/>`;
        }
      }
    }

    const [ro, ri, rp] = EYE_RADII[t.eyes] || EYE_RADII.square;
    const eyes = eyeOrigins
      .map(([er, ec]) => {
        const x = ec + quiet;
        const y = er + quiet;
        return `<rect x="${x}" y="${y}" width="7" height="7" rx="${ro}" fill="${t.eye}"/>
          <rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="${ri}" fill="${t.bg}"/>
          <rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${rp}" fill="${t.pupil}"/>`;
      })
      .join("");

    let iconSvg = "";
    if (icon) {
      const x = icon.start + quiet;
      const pad = icon.k * 0.12;
      iconSvg = `<rect x="${x}" y="${x}" width="${icon.k}" height="${icon.k}" rx="${icon.k * 0.22}" fill="${t.bg}"/>
        <g transform="translate(${x + pad} ${x + pad}) scale(${icon.k - pad * 2})">${ICONS[t.icon](t.fg, t.bg)}</g>`;
    }

    const rendering = t.modules === "square" ? "crispEdges" : "geometricPrecision";
    return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="${rendering}" role="img" aria-label="QR code">
      <rect width="${size}" height="${size}" fill="${t.bg}"/>
      <g fill="${t.fg}">${modules}</g>${eyes}${iconSvg}</svg>`;
  }

  /** Fill container with a themed QR card linking to url. */
  function render(container, { url, theme, label }) {
    const name = THEMES[theme] ? theme : "classic";
    container.classList.add("qr-card");
    container.classList.forEach((cls) => {
      if (cls.startsWith("qr-theme-")) container.classList.remove(cls);
    });
    container.classList.add(`qr-theme-${name}`);
    container.innerHTML = `<div class="qr-code">${buildSvg(url, name)}</div>`;
    if (label) {
      const caption = document.createElement("div");
      caption.className = "qr-label";
      caption.textContent = label;
      container.appendChild(caption);
    }
  }

  window.SlideshowQR = { themes: Object.keys(THEMES), render };
})();
