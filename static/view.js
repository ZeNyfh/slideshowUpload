(() => {
  const stage = document.getElementById("stage");
  const fx = document.getElementById("fx");
  const empty = document.getElementById("empty");
  const badge = document.getElementById("badge");
  const qrBox = document.getElementById("qr");

  // ?transition=bats forces one transition (handy for testing on the display)
  const forcedTransition = new URLSearchParams(window.location.search).get("transition");

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const toPoints = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  function play(el, keyframes, options) {
    return el.animate(keyframes, { fill: "both", ...options }).finished.catch(() => {});
  }

  function fxEl(className, html) {
    const el = document.createElement("div");
    el.className = className;
    if (html) el.innerHTML = html;
    fx.appendChild(el);
    return el;
  }

  function stageSize() {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    return { w, h, r: Math.hypot(w, h) / 2 + 40 };
  }

  /** Clipped copies of a slide, appended hidden; splitSlide reveals them. */
  async function makePieces(slide, cols, rows) {
    const pieces = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const el = slide.cloneNode(true);
        el.classList.add("piece");
        el.style.visibility = "hidden";
        el.style.zIndex = slide.style.zIndex && slide.style.zIndex !== "0" ? slide.style.zIndex : "1";
        const top = Math.max(0, (row / rows) * 100 - 0.1);
        const bottom = Math.max(0, 100 - ((row + 1) / rows) * 100 - 0.1);
        const left = Math.max(0, (col / cols) * 100 - 0.1);
        const right = Math.max(0, 100 - ((col + 1) / cols) * 100 - 0.1);
        el.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
        const cx = (col + 0.5) / cols;
        const cy = (row + 0.5) / rows;
        el.style.transformOrigin = `${cx * 100}% ${cy * 100}%`;
        stage.appendChild(el);
        pieces.push({ el, cx, cy, col, row });
      }
    }
    await Promise.all(
      pieces.map((p) => {
        const img = p.el.querySelector("img");
        return img ? img.decode().catch(() => {}) : null;
      })
    );
    return { pieces, cols, rows };
  }

  /** Cut a slide into clipped copies stacked above everything else. */
  async function splitSlide(slide, cols, rows, hideSource = true, ready = null) {
    const set = ready && ready.cols === cols && ready.rows === rows ? ready : await makePieces(slide, cols, rows);
    for (const p of set.pieces) p.el.style.visibility = "";
    if (hideSource) slide.style.visibility = "hidden";
    return set.pieces;
  }

  let compatOn = false;
  const compat = () => compatOn;

  /** A prepare() result is only usable if the screen size / compat mode haven't changed since. */
  function fresh(prepared) {
    if (!prepared) return null;
    const { w, h } = stageSize();
    if (prepared.w !== w || prepared.h !== h) return null;
    if (prepared.dpr && prepared.dpr !== canvasDpr()) return null;
    if (prepared.compat != null && prepared.compat !== compat()) return null;
    return prepared;
  }

  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
  // Canvas effects lower their resolution on slow displays, tuned by how fast the last one ran.
  // Remembered per browser so a slow projector starts at the right level after a reload.
  const QUALITY_KEY = "slideshow.canvasQuality";
  let canvasQuality = Math.min(1, Math.max(0.5, Number(localStorage.getItem(QUALITY_KEY)) || 1));
  const canvasDpr = () => Math.min(window.devicePixelRatio || 1, 2) * canvasQuality;

  function tuneCanvasQuality(avgFrameMs) {
    const TARGET_MS = 30;
    if (avgFrameMs > TARGET_MS * 1.3 || (avgFrameMs < TARGET_MS * 0.6 && canvasQuality < 1)) {
      // Frame cost scales with pixel count, i.e. with quality squared
      const scaled = canvasQuality * Math.sqrt(TARGET_MS / Math.max(1, avgFrameMs));
      canvasQuality = Math.round(Math.min(1, Math.max(0.5, scaled)) * 100) / 100;
      try {
        localStorage.setItem(QUALITY_KEY, String(canvasQuality));
      } catch (_) {
        // Private mode / storage disabled: just don't remember
      }
    }
  }

  /** Drive a canvas effect: draw(progress 0..1, elapsedMs) once per frame. */
  function animateFrames(duration, draw) {
    return new Promise((resolve) => {
      const start = performance.now();
      let frames = 0;
      const step = (now) => {
        const elapsed = Math.max(0, now - start);
        const p = Math.min(1, elapsed / duration);
        draw(p, elapsed);
        frames += 1;
        if (p < 1) requestAnimationFrame(step);
        else {
          tuneCanvasQuality(elapsed / frames);
          resolve();
        }
      };
      step(start);
    });
  }

  /** Full-stage canvas in the fx layer, sized in device pixels. */
  function fxCanvas(w, h, dpr) {
    const canvas = document.createElement("canvas");
    canvas.className = "fx-canvas";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    fx.appendChild(canvas);
    return { canvas, ctx: canvas.getContext("2d") };
  }

  /** Rasterise a slide (photo + caption) exactly as it currently appears on stage. */
  function renderSlide(el, w, h, dpr) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const origin = stage.getBoundingClientRect();
    const img = el.querySelector("img");
    if (img && img.naturalWidth) {
      const r = img.getBoundingClientRect();
      ctx.drawImage(img, r.left - origin.left, r.top - origin.top, r.width, r.height);
    }
    const meta = el.querySelector(".slide-meta");
    if (meta && meta.textContent) {
      const cs = getComputedStyle(meta);
      const r = meta.getBoundingClientRect();
      const size = parseFloat(cs.fontSize) || 20;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#fff";
      const x = r.left - origin.left;
      const y = r.top - origin.top + size * 0.95;
      ctx.strokeText(meta.textContent, x, y);
      ctx.fillText(meta.textContent, x, y);
    }
    return canvas;
  }

  /** Smooth value noise on a cols×rows grid, roughly 0..1. */
  function valueNoise(cols, rows, cell) {
    const gw = Math.ceil(cols / cell) + 2;
    const gh = Math.ceil(rows / cell) + 2;
    const grid = Float32Array.from({ length: gw * gh }, Math.random);
    const out = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const fy = (gy - y0) * (gy - y0) * (3 - 2 * (gy - y0));
      for (let x = 0; x < cols; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const fxv = (gx - x0) * (gx - x0) * (3 - 2 * (gx - x0));
        const a = grid[y0 * gw + x0];
        const b = grid[y0 * gw + x0 + 1];
        const c = grid[(y0 + 1) * gw + x0];
        const d = grid[(y0 + 1) * gw + x0 + 1];
        out[y * cols + x] = (a + (b - a) * fxv) * (1 - fy) + (c + (d - c) * fxv) * fy;
      }
    }
    return out;
  }

  /** Catmull-Rom spline through points as an SVG path. */
  function smoothPath(pts) {
    const f = (n) => n.toFixed(1);
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d;
  }

  const EMBERS = ["#ffd27a", "#ffab40", "#ff7b1a", "#ff4d00", "#c22a00"];
  const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";

  const TAROT_SVG = `<svg viewBox="0 0 60 100" preserveAspectRatio="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="57" height="97" rx="4" fill="#1a0b2e" stroke="#d4af37" stroke-width="1.5"/>
    <rect x="5" y="5" width="50" height="90" rx="2.5" fill="none" stroke="#d4af37" stroke-width=".6"/>
    <path d="M30 13a7 7 0 1 0 6 11a5.5 5.5 0 1 1-6-11z" fill="#d4af37"/>
    <circle cx="30" cy="54" r="17" fill="none" stroke="#d4af37" stroke-width=".6"/>
    <g stroke="#d4af37" stroke-width=".5">
      <path d="M30 33v-3M30 75v3M9 54h3M48 54h3M15 39l2 2M43 67l2 2M45 39l-2 2M17 67l-2 2"/>
    </g>
    <path d="M17 54Q30 42 43 54Q30 66 17 54z" fill="none" stroke="#d4af37" stroke-width=".9"/>
    <circle cx="30" cy="54" r="5" fill="#d4af37"/><circle cx="30" cy="54" r="2" fill="#1a0b2e"/>
    <g fill="#d4af37"><circle cx="11" cy="11" r=".9"/><circle cx="49" cy="11" r=".9"/><circle cx="11" cy="89" r=".9"/><circle cx="49" cy="89" r=".9"/></g>
    <path d="M24 86h12M26 89h8" stroke="#d4af37" stroke-width=".5"/>
  </svg>`;

  function sendUnder(newEl) {
    newEl.style.zIndex = "0";
  }

  const BAT_SVG = `<svg viewBox="0 0 64 32" aria-hidden="true"><path d="M32 10C30 6 28 6 27 9C24 6 18 4 12 6C15 8 16 11 15 14C11 12 5 12 0 16C6 17 10 20 12 24C15 21 20 21 23 23C25 20 28 19 32 22C36 19 39 20 41 23C44 21 49 21 52 24C54 20 58 17 64 16C59 12 53 12 49 14C48 11 49 8 52 6C46 4 40 6 37 9C36 6 34 6 32 10Z"/></svg>`;

  const SPIDER_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <g class="legs" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M38 45L20 30L10 38"/><path d="M37 52L15 48L5 58"/><path d="M37 60L16 66L8 80"/><path d="M40 67L24 82L20 96"/>
      <path d="M62 45L80 30L90 38"/><path d="M63 52L85 48L95 58"/><path d="M63 60L84 66L92 80"/><path d="M60 67L76 82L80 96"/>
    </g>
    <ellipse cx="50" cy="56" rx="14" ry="18" fill="currentColor"/>
    <circle cx="50" cy="34" r="9" fill="currentColor"/>
    <circle cx="46" cy="33" r="2.2" fill="#ff2a2a"/><circle cx="54" cy="33" r="2.2" fill="#ff2a2a"/>
  </svg>`;

  function boltSvg(w, h) {
    const main = [];
    let x = rand(0.25, 0.75) * w;
    const endY = rand(0.7, 1) * h;
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      main.push([x, (endY * i) / steps]);
      x += rand(-0.05, 0.05) * w;
    }
    const branch = [main[5]];
    let [bx, by] = main[5];
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 6; i++) {
      bx += dir * rand(0.02, 0.06) * w;
      by += rand(0.03, 0.06) * h;
      branch.push([bx, by]);
    }
    const lines = [main, branch]
      .map(
        (pts) =>
          `<polyline class="glow" points="${toPoints(pts)}"/><polyline class="core" points="${toPoints(pts)}"/>`
      )
      .join("");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${lines}</svg>`;
  }

  function cracksSvg(w, h, ix, iy) {
    let lines = "";
    const rays = 13;
    for (let i = 0; i < rays; i++) {
      const angle = (i / rays) * Math.PI * 2 + rand(-0.2, 0.2);
      const len = rand(0.3, 0.75) * Math.max(w, h);
      const pts = [[ix * w, iy * h]];
      for (let k = 1; k <= 6; k++) {
        const a = angle + rand(-0.15, 0.15);
        const dist = (len * k) / 6;
        pts.push([ix * w + Math.cos(a) * dist, iy * h + Math.sin(a) * dist]);
      }
      lines += `<polyline points="${toPoints(pts)}"/>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${lines}</svg>`;
  }

  /** Pre-bake a few noise frames so haunted-tv never regenerates static per paint. */
  function makeStaticFrames(w, h, count = 5) {
    const frames = [];
    for (let f = 0; f < count; f++) {
      const frame = new ImageData(w, h);
      const buf = new Uint32Array(frame.data.buffer);
      for (let i = 0; i < buf.length; i++) {
        const v = (Math.random() * 255) | 0;
        buf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      }
      frames.push(frame);
    }
    return frames;
  }

  /** Cycle pre-baked frames at ~12fps instead of filling ImageData every rAF. */
  function startStatic(canvas, frames) {
    const ctx = canvas.getContext("2d", { alpha: false });
    let i = 0;
    let last = 0;
    const INTERVAL = 80;
    const tick = (now) => {
      if (!canvas.isConnected) return;
      if (now - last >= INTERVAL) {
        last = now;
        ctx.putImageData(frames[i % frames.length], 0, 0);
        i += 1;
      }
      requestAnimationFrame(tick);
    };
    ctx.putImageData(frames[0], 0, 0);
    requestAnimationFrame(tick);
  }

  /** Build vine SVG + thorn markup off the critical path (no getPointAtLength). */
  function buildVines(w, h) {
    const light = compat();
    // Compat keeps enough vines to read as a thicket; full density is for normal mode
    const count = light ? (w < 700 ? 9 : 12) : w < 700 ? 11 : 18;
    const vines = [];
    let vineMarkup = "";
    let thornMarkup = "";
    for (let i = 0; i < count; i++) {
      const side = i % 4;
      const start = [
        [rand(0, w), -20],
        [w + 20, rand(0, h)],
        [rand(0, w), h + 20],
        [-20, rand(0, h)],
      ][side];
      const target = [w * rand(0.25, 0.75), h * rand(0.25, 0.75)];
      const nx = -(target[1] - start[1]);
      const ny = target[0] - start[0];
      const len = Math.hypot(nx, ny) || 1;
      const wobble = rand(40, 110);
      const phase = rand(0, Math.PI * 2);
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const sway = Math.sin(t * 4 + phase) * wobble * (1 - t * 0.4);
        pts.push([
          start[0] + (target[0] - start[0]) * t + (nx / len) * sway,
          start[1] + (target[1] - start[1]) * t + (ny / len) * sway,
        ]);
      }
      const [ex, ey] = pts[pts.length - 1];
      const curl = rand(0, Math.PI * 2);
      for (let k = 1; k <= 4; k++) {
        const a = curl + k * 1.4;
        const rad = 42 - k * 9;
        pts.push([ex + Math.cos(a) * rad, ey + Math.sin(a) * rad]);
      }
      const width = rand(9, 24);
      const delay = rand(0, 350);
      vines.push({ delay });
      vineMarkup += `<path class="vine" d="${smoothPath(pts)}" stroke-width="${width.toFixed(1)}" pathLength="1"/>`;

      const seglen = [];
      let total = 0;
      for (let s = 1; s < pts.length; s++) {
        const L = Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]);
        seglen.push(L);
        total += L;
      }
      let flip = 1;
      const thornStep = light ? () => rand(40, 70) : () => rand(30, 55);
      for (let d = light ? 36 : 30; d < total - 20; d += thornStep()) {
        let acc = 0;
        for (let s = 0; s < seglen.length; s++) {
          if (acc + seglen[s] < d) {
            acc += seglen[s];
            continue;
          }
          const t = (d - acc) / seglen[s];
          const x = pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t;
          const y = pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t;
          const angle = (Math.atan2(pts[s + 1][1] - pts[s][1], pts[s + 1][0] - pts[s][0]) * 180) / Math.PI;
          const sz = width * 0.55;
          const appear = delay + 1100 * (d / total);
          thornMarkup += `<path d="M${(-sz).toFixed(1)} 0L${(sz * 0.4).toFixed(1)} 0L${(sz * 1.3).toFixed(1)} ${(flip * (width / 2 + sz * 1.3)).toFixed(1)}Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)})" data-appear="${appear.toFixed(0)}"/>`;
          flip = -flip;
          break;
        }
      }
    }
    return {
      w,
      h,
      compat: light,
      vines,
      html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${vineMarkup}<g class="thorns">${thornMarkup}</g></svg>`,
    };
  }

  function buildSummoning(w, h) {
    const light = compat();
    const S = Math.min(w, h) * 0.85;
    const c = S / 2;
    const R1 = S * 0.47;
    const R2 = S * 0.4;
    const RR = S * 0.435;
    const star = [0, 1, 2, 3, 4]
      .map((k) => {
        const a = ((-90 + k * 144) * Math.PI) / 180;
        return `${(c + R2 * Math.cos(a)).toFixed(1)} ${(c + R2 * Math.sin(a)).toFixed(1)}`;
      })
      .join(" L");
    const fontSize = light ? S * 0.042 : S * 0.034;
    let count = Math.floor((2 * Math.PI * RR) / (fontSize * (light ? 1.4 : 1.15)));
    if (light) count = Math.min(18, Math.max(10, count));
    let runes = "";
    for (let i = 0; i < count; i++) runes += RUNES[i % RUNES.length];
    const id = `rune-${Math.random().toString(36).slice(2, 9)}`;
    return {
      w,
      h,
      compat: light,
      r: Math.hypot(w, h) / 2 + 40,
      S,
      html: `<svg viewBox="0 0 ${S} ${S}" aria-hidden="true">
        <defs><path id="${id}" d="M${c} ${c - RR}a${RR} ${RR} 0 1 1 0 ${2 * RR}a${RR} ${RR} 0 1 1 0 ${-2 * RR}"/></defs>
        <circle class="draw" cx="${c}" cy="${c}" r="${R1}" pathLength="1"/>
        <circle class="draw" cx="${c}" cy="${c}" r="${R2}" pathLength="1"/>
        <path class="draw" d="M${star} Z" pathLength="1"/>
        <text class="runes" font-size="${fontSize}"><textPath href="#${id}">${runes}</textPath></text>
      </svg>`,
    };
  }

  function meltCols(w) {
    return Math.max(16, Math.round(w / 45));
  }

  function glitchFrames(count) {
    const frames = [];
    for (let i = 0; i < count; i++) {
      const top = rand(0, 75);
      const bottom = rand(0, 100 - top - 8);
      frames.push({
        clipPath: `inset(${top}% 0 ${bottom}% 0)`,
        transform: `translate(${rand(-9, 9)}%, ${rand(-2, 2)}%) skewX(${rand(-12, 12)}deg)`,
        filter: `hue-rotate(${rand(0, 360)}deg) saturate(4) contrast(1.7)`,
        opacity: 1,
        easing: "steps(1, end)",
      });
    }
    return frames;
  }

  function rgbSplitFrames(count) {
    const frames = [];
    for (let i = 0; i < count; i++) {
      const d = rand(4, 16);
      frames.push({
        filter: `drop-shadow(${d}px 0 0 rgba(255,0,70,.85)) drop-shadow(${-d}px 0 0 rgba(0,255,230,.85))`,
        easing: "steps(1, end)",
      });
    }
    return frames;
  }

  function candleRadii(fractions, r) {
    return fractions.map((f) => ({ clipPath: `circle(${Math.round(f * r)}px at 50% 55%)` }));
  }

  /* Each transition animates oldEl out and newEl in, then resolves. */
  const TRANSITIONS = {
    crossfade: {
      ms: 1200,
      run: ({ newEl }) =>
        play(newEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 1200, easing: "ease-in-out" }),
    },

    slide: {
      ms: 950,
      run: ({ oldEl, newEl }) => {
        const [dx, dy] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        const opts = { duration: 950, easing: "cubic-bezier(.65,0,.35,1)" };
        return Promise.all([
          play(newEl, [{ transform: `translate(${dx * 100}%, ${dy * 100}%)` }, { transform: "none" }], opts),
          play(
            oldEl,
            [
              { transform: "none", filter: "brightness(1)" },
              { transform: `translate(${-dx * 35}%, ${-dy * 35}%) scale(.88)`, filter: "brightness(.25)" },
            ],
            opts
          ),
        ]);
      },
    },

    drift: {
      ms: 1700,
      run: ({ oldEl, newEl }) => {
        const opts = { duration: 1700, easing: "cubic-bezier(.2,.7,.2,1)" };
        return Promise.all([
          play(
            newEl,
            [
              { opacity: 0, transform: `scale(1.3) translate(${rand(-4, 4)}%, ${rand(-4, 4)}%)` },
              { opacity: 1, transform: "none" },
            ],
            opts
          ),
          play(oldEl, [{ transform: "none" }, { transform: "scale(1.12)" }], opts),
        ]);
      },
    },

    lightning: {
      ms: 1500,
      run: ({ oldEl, newEl }) => {
        const { w, h } = stageSize();
        const flash = fxEl("fx-flash");
        const bolt = fxEl("fx-bolt", boltSvg(w, h));
        const duration = 1500;
        return Promise.all([
          play(
            flash,
            [
              { opacity: 0 },
              { opacity: 1, offset: 0.06 },
              { opacity: 0.15, offset: 0.12 },
              { opacity: 0.95, offset: 0.18 },
              { opacity: 0, offset: 0.36 },
              { opacity: 0.45, offset: 0.43 },
              { opacity: 0, offset: 0.6 },
              { opacity: 0 },
            ],
            { duration, easing: "linear" }
          ),
          play(
            bolt,
            [
              { opacity: 0 },
              { opacity: 1, offset: 0.05 },
              { opacity: 0, offset: 0.13 },
              { opacity: 1, offset: 0.17 },
              { opacity: 0, offset: 0.33 },
              { opacity: 0 },
            ],
            { duration, easing: "linear" }
          ),
          play(oldEl, [{ filter: "brightness(1)" }, { filter: "brightness(.35) saturate(.4)" }], {
            duration: duration * 0.17,
          }),
          play(
            newEl,
            [
              { opacity: 0, transform: "none", filter: "none" },
              { opacity: 0, offset: 0.17 },
              {
                opacity: 1,
                offset: 0.18,
                transform: "translate(-1.2%, .8%)",
                filter: "grayscale(1) brightness(3) contrast(1.5)",
              },
              { transform: "translate(1%, -.6%)", offset: 0.24 },
              { transform: "translate(-.6%, .4%)", offset: 0.3 },
              { transform: "none", offset: 0.38 },
              { opacity: 1, transform: "none", filter: "none" },
            ],
            { duration, easing: "linear" }
          ),
        ]);
      },
    },

    fog: {
      ms: 2600,
      run: ({ oldEl, newEl }) => {
        const duration = 2600;
        const light = compat();
        const veil = fxEl("fx-veil");
        const bankCount = light ? 1 : 4;
        const banks = Array.from({ length: bankCount }, (_, i) => {
          const bank = fxEl("fx-fog");
          bank.style.top = `${rand(-25, 45)}%`;
          const dir = i % 2 ? 1 : -1;
          return play(
            bank,
            [
              { opacity: 0, transform: `translateX(${dir * -45}%) scale(1)` },
              { opacity: 0.95, offset: 0.4 },
              { opacity: 0.9, offset: 0.62 },
              { opacity: 0, transform: `translateX(${dir * 35}%) scale(1.3)` },
            ],
            { duration, delay: i * 90, easing: "ease-in-out" }
          );
        });
        // Full-slide blur is the expensive part on weak GPUs — opacity only in compat
        if (light) {
          return Promise.all([
            ...banks,
            play(veil, [{ opacity: 0 }, { opacity: 0.75, offset: 0.45 }, { opacity: 0 }], {
              duration,
              easing: "ease-in-out",
            }),
            play(oldEl, [{ opacity: 1 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], { duration }),
            play(newEl, [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], {
              duration,
              easing: "ease-out",
            }),
          ]);
        }
        return Promise.all([
          ...banks,
          play(veil, [{ opacity: 0 }, { opacity: 0.65, offset: 0.45 }, { opacity: 0 }], {
            duration,
            easing: "ease-in-out",
          }),
          play(oldEl, [{ filter: "blur(0)", opacity: 1 }, { filter: "blur(16px)", opacity: 0, offset: 0.6 }, { opacity: 0 }], {
            duration,
          }),
          play(
            newEl,
            [
              { opacity: 0, filter: "blur(18px) brightness(1.4)" },
              { opacity: 0, offset: 0.4 },
              { opacity: 1, filter: "none" },
            ],
            { duration, easing: "ease-out" }
          ),
        ]);
      },
    },

    ghost: {
      ms: 2200,
      run: ({ oldEl, newEl }) => {
        const duration = 2200;
        const light = compat();
        const chill = fxEl("fx-chill");
        // Full-slide clones + blur + mix-blend are the expensive part; skip in compat
        const trails = light
          ? []
          : [-1, 1].map((dir) => {
              const trail = oldEl.cloneNode(true);
              trail.classList.add("piece", "ghost-trail");
              stage.appendChild(trail);
              return play(
                trail,
                [
                  { opacity: 0, transform: "none", filter: "grayscale(1) blur(2px)" },
                  { opacity: 0.5, offset: 0.25 },
                  {
                    opacity: 0,
                    transform: `translate(${dir * 8}%, -18%) scale(1.2)`,
                    filter: "grayscale(1) brightness(1.8) blur(10px)",
                    offset: 0.65,
                  },
                  { opacity: 0 },
                ],
                { duration, easing: "ease-out" }
              );
            });
        const oldOut = light
          ? [
              { opacity: 1, transform: "none", filter: "none" },
              { opacity: 0.75, offset: 0.3, filter: "grayscale(.8) brightness(1.3)" },
              { opacity: 0, transform: "translateY(-12%) scale(1.15)", filter: "grayscale(1) brightness(1.7)", offset: 0.7 },
              { opacity: 0 },
            ]
          : [
              { opacity: 1, transform: "none", filter: "none" },
              { opacity: 0.75, offset: 0.3, filter: "grayscale(.8) brightness(1.3)" },
              { opacity: 0, transform: "translateY(-12%) scale(1.15)", filter: "grayscale(1) brightness(1.7) blur(9px)", offset: 0.7 },
              { opacity: 0 },
            ];
        const newIn = light
          ? [
              { opacity: 0, transform: "scale(.94) translateY(4%)", filter: "grayscale(1) brightness(1.5)" },
              { opacity: 0, offset: 0.35 },
              { opacity: 0.4, offset: 0.45 },
              { opacity: 0.1, offset: 0.5 },
              { opacity: 0.65, offset: 0.6 },
              { opacity: 0.3, offset: 0.66 },
              { opacity: 1, offset: 0.82, filter: "grayscale(.3) brightness(1.1)" },
              { opacity: 1, transform: "none", filter: "none" },
            ]
          : [
              { opacity: 0, transform: "scale(.94) translateY(4%)", filter: "grayscale(1) brightness(1.9) blur(12px)" },
              { opacity: 0, offset: 0.35 },
              { opacity: 0.4, offset: 0.45 },
              { opacity: 0.1, offset: 0.5 },
              { opacity: 0.65, offset: 0.6 },
              { opacity: 0.3, offset: 0.66 },
              { opacity: 1, offset: 0.82, filter: "grayscale(.3) brightness(1.1) blur(1px)" },
              { opacity: 1, transform: "none", filter: "none" },
            ];
        return Promise.all([
          ...trails,
          play(chill, [{ opacity: 0 }, { opacity: 0.85, offset: 0.4 }, { opacity: 0 }], { duration }),
          play(oldEl, oldOut, { duration, easing: "ease-in" }),
          play(newEl, newIn, { duration, easing: "ease-out" }),
        ]);
      },
    },

    possessed: {
      ms: 1500,
      run: ({ oldEl, newEl }) => {
        // Same path with or without compat — full glitch runs fine on the slow display
        const oldImg = oldEl.querySelector("img");
        const newImg = newEl.querySelector("img");
        const clean = { clipPath: "inset(0% 0 0% 0)", transform: "none", filter: "none", opacity: 1 };
        const scan = fxEl("fx-scanlines");
        const jobs = [
          play(scan, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], {
            duration: 1500,
          }),
          play(oldEl, [{ ...clean, easing: "steps(1, end)" }, ...glitchFrames(9), { ...clean, opacity: 0 }], {
            duration: 700,
          }),
          play(newEl, [{ opacity: 0, easing: "steps(1, end)" }, ...glitchFrames(11), clean], {
            duration: 1000,
            delay: 450,
          }),
        ];
        if (oldImg) jobs.push(play(oldImg, [...rgbSplitFrames(8), { filter: "none" }], { duration: 700 }));
        if (newImg) jobs.push(play(newImg, [...rgbSplitFrames(10), { filter: "none" }], { duration: 1000, delay: 450 }));
        return Promise.all(jobs);
      },
    },

    bleed: {
      ms: 2700,
      run: async ({ newEl }) => {
        const { w } = stageSize();
        const curtain = fxEl("fx-blood");
        const count = compat() ? Math.max(7, Math.round(w / 110)) : Math.max(14, Math.round(w / 55));
        let longest = 0;
        for (let i = 0; i < count; i++) {
          const drip = document.createElement("div");
          drip.className = "drip";
          drip.style.left = `${(i / count) * 100}%`;
          drip.style.width = `${100 / count + 0.8}%`;
          curtain.appendChild(drip);
          const delay = rand(0, 450) + Math.abs(Math.sin(i * 1.7)) * 200;
          const duration = rand(900, 1250);
          longest = Math.max(longest, delay + duration);
          drip.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
            duration,
            delay,
            easing: "cubic-bezier(.55,0,.75,.3)",
            fill: "both",
          });
        }
        const total = longest + 950;
        const swapAt = (longest + 30) / total;
        await Promise.all([
          play(newEl, [{ opacity: 0 }, { opacity: 0, offset: swapAt }, { opacity: 1, offset: Math.min(1, swapAt + 0.001) }, { opacity: 1 }], {
            duration: total,
          }),
          play(curtain, [{ transform: "translateY(0)" }, { transform: "translateY(115%)" }], {
            duration: 850,
            delay: longest + 80,
            easing: "cubic-bezier(.6,0,.9,.4)",
          }),
        ]);
      },
    },

    bats: {
      ms: 2800,
      run: ({ oldEl, newEl }) => {
        const { w, h } = stageSize();
        const light = compat();
        const dusk = fxEl("fx-dusk");
        // Compat: fewer, bigger bats — reads as a swarm without DOM/filter overload
        const count = light ? (w < 700 ? 12 : 16) : w < 700 ? 26 : 46;
        const flights = [];
        for (let i = 0; i < count; i++) {
          const bat = fxEl("fx-bat", BAT_SVG);
          const size = light ? rand(90, 200) : rand(36, 150);
          bat.style.width = `${size}px`;
          const sx = -size - rand(0, w * 0.3);
          const sy = rand(0.35, 1.1) * h;
          const ex = w + size + rand(0, w * 0.2);
          const ey = sy - rand(0.45, 1.05) * h;
          const mx = (sx + ex) / 2;
          const my = (sy + ey) / 2 + rand(-0.15, 0.15) * h;
          bat.firstElementChild.animate(
            [{ transform: "scaleY(1)" }, { transform: "scaleY(.25)" }, { transform: "scaleY(1)" }],
            { duration: light ? rand(240, 380) : rand(130, 220), iterations: Infinity }
          );
          flights.push(
            play(
              bat,
              [
                { transform: `translate(${sx}px, ${sy}px) rotate(${rand(-20, 10)}deg)` },
                { transform: `translate(${mx}px, ${my}px) rotate(${rand(-25, 25)}deg)` },
                { transform: `translate(${ex}px, ${ey}px) rotate(${rand(-30, 0)}deg)` },
              ],
              { duration: rand(1300, 2100), delay: rand(0, 650), easing: "ease-in-out" }
            )
          );
        }
        return Promise.all([
          ...flights,
          play(dusk, [{ opacity: 0 }, { opacity: 0.7, offset: 0.4 }, { opacity: 0 }], { duration: 2800 }),
          play(oldEl, [{ filter: "none" }, { filter: "brightness(.5) sepia(.4)" }], { duration: 1100 }),
          play(newEl, [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], {
            duration: 2800,
          }),
        ]);
      },
    },

    shatter: {
      ms: 2100,
      prepare: async ({ oldEl }) => {
        const cols = compat() ? 5 : 7;
        const rows = compat() ? 3 : 5;
        return { ...stageSize(), compat: compat(), cols, rows, set: await makePieces(oldEl, cols, rows) };
      },
      run: async ({ oldEl, newEl, prepared }) => {
        const { w, h } = stageSize();
        sendUnder(newEl);
        const ix = rand(0.3, 0.7);
        const iy = rand(0.3, 0.7);
        const cols = fresh(prepared)?.cols || (compat() ? 5 : 7);
        const rows = fresh(prepared)?.rows || (compat() ? 3 : 5);
        const pieces = await splitSlide(oldEl, cols, rows, true, fresh(prepared)?.set);
        const cracks = fxEl("fx-cracks", cracksSvg(w, h, ix, iy));
        const flash = fxEl("fx-flash");
        const jobs = [
          play(flash, [{ opacity: 0 }, { opacity: 0.7, offset: 0.2 }, { opacity: 0 }], { duration: 260 }),
          play(cracks, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], {
            duration: 700,
          }),
          play(newEl, [{ filter: "brightness(.15)" }, { filter: "none" }], { duration: 1500, delay: 400 }),
        ];
        for (const p of pieces) {
          const dist = Math.hypot(p.cx - ix, p.cy - iy);
          jobs.push(
            play(
              p.el,
              [
                { transform: "none", opacity: 1 },
                {
                  transform: `translate(${(p.cx - ix) * rand(30, 80)}vw, ${rand(70, 130)}vh) rotate(${rand(-80, 80)}deg) scale(${rand(0.6, 1)})`,
                  opacity: 0.3,
                },
              ],
              { duration: rand(850, 1250), delay: 280 + dist * 500 + rand(0, 120), easing: "cubic-bezier(.5,0,.9,.5)" }
            )
          );
        }
        await Promise.all(jobs);
      },
    },

    melt: {
      ms: 2400,
      prepare: async ({ oldEl }) => {
        if (compat()) return { ...stageSize(), compat: true };
        const size = stageSize();
        const cols = meltCols(size.w);
        return { ...size, compat: false, cols, set: await makePieces(oldEl, cols, 1) };
      },
      run: async ({ oldEl, newEl, prepared }) => {
        sendUnder(newEl);
        // Compat: one element drip — cloning ~16 full slides is what stalls weak CPUs
        if (compat()) {
          oldEl.style.transformOrigin = "50% 0";
          return Promise.all([
            play(
              oldEl,
              [
                { transform: "none", opacity: 1 },
                { transform: "translateY(10%) scaleY(1.08)", opacity: 0.85, offset: 0.35 },
                { transform: "translateY(118%) scaleY(1.55)", opacity: 0 },
              ],
              { duration: 1600, easing: "cubic-bezier(.5,0,.85,.4)" }
            ),
            play(newEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 1400, delay: 350 }),
          ]);
        }
        const { w } = stageSize();
        const cols = fresh(prepared)?.cols || meltCols(w);
        const strips = await splitSlide(oldEl, cols, 1, true, fresh(prepared)?.set);
        const phase = rand(0, Math.PI * 2);
        const jobs = [play(newEl, [{ filter: "brightness(.2)" }, { filter: "none" }], { duration: 1800, delay: 400 })];
        for (const s of strips) {
          s.el.style.transformOrigin = "50% 0";
          jobs.push(
            play(
              s.el,
              [
                { transform: "none", filter: "none" },
                { transform: "translateY(12%) scaleY(1.1)", filter: "saturate(1.6) hue-rotate(-15deg) brightness(.85)", offset: 0.35 },
                { transform: "translateY(115%) scaleY(1.6)", filter: "saturate(2) brightness(.35)" },
              ],
              {
                duration: rand(1100, 1450),
                delay: 380 + 320 * Math.sin(s.col * 0.55 + phase) + rand(0, 140),
                easing: "cubic-bezier(.5,0,.85,.4)",
              }
            )
          );
        }
        await Promise.all(jobs);
      },
    },

    "haunted-tv": {
      ms: 1900,
      prepare: () => {
        const size = stageSize();
        const cw = compat() ? 96 : 160;
        const ch = compat() ? 54 : 90;
        return { ...size, compat: compat(), cw, ch, frames: makeStaticFrames(cw, ch, 5) };
      },
      run: ({ oldEl, newEl, prepared }) => {
        const light = compat();
        const ready = fresh(prepared) || TRANSITIONS["haunted-tv"].prepare();
        const canvas = document.createElement("canvas");
        canvas.width = ready.cw;
        canvas.height = ready.ch;
        canvas.className = "fx-static";
        fx.appendChild(canvas);
        startStatic(canvas, ready.frames);
        const label = fxEl("fx-nosignal");
        label.textContent = "NO SIGNAL";
        const scan = fxEl("fx-scanlines");
        const oldFrames = light
          ? [
              { transform: "scale(1, 1)", opacity: 1 },
              { transform: "scale(1, .006)", opacity: 1, offset: 0.65 },
              { transform: "scale(0, .006)", opacity: 0.4 },
            ]
          : [
              { transform: "scale(1, 1)", filter: "brightness(1)" },
              { transform: "scale(1, .006)", filter: "brightness(4)", offset: 0.65 },
              { transform: "scale(0, .006)", filter: "brightness(8)" },
            ];
        const newFrames = light
          ? [
              { transform: "scale(0, .006)", opacity: 0.5 },
              { transform: "scale(1, .006)", opacity: 1, offset: 0.35 },
              { transform: "scale(1, 1.04)", opacity: 1, offset: 0.75 },
              { transform: "scale(1, 1)", opacity: 1 },
            ]
          : [
              { transform: "scale(0, .006)", filter: "brightness(8)" },
              { transform: "scale(1, .006)", filter: "brightness(4)", offset: 0.35 },
              { transform: "scale(1, 1.04)", filter: "brightness(1.4) contrast(1.3)", offset: 0.75 },
              { transform: "scale(1, 1)", filter: "none" },
            ];
        return Promise.all([
          play(oldEl, oldFrames, { duration: 600, easing: "ease-in" }),
          play(canvas, [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 0.85, offset: 0.36 }, { opacity: 0.7, offset: 0.6 }, { opacity: 0, offset: 0.68 }, { opacity: 0 }], {
            duration: 1900,
          }),
          play(
            label,
            [
              { opacity: 0 },
              { opacity: 0, offset: 0.36 },
              { opacity: 1, offset: 0.4 },
              { opacity: 0.2, offset: 0.45 },
              { opacity: 1, offset: 0.5 },
              { opacity: 0, offset: 0.62 },
              { opacity: 0 },
            ].map((f) => ({ ...f, easing: "steps(1, end)" })),
            { duration: 1900 }
          ),
          play(scan, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], {
            duration: 1900,
          }),
          play(newEl, newFrames, { duration: 700, delay: 1200, easing: "ease-out" }),
        ]);
      },
    },

    portal: {
      ms: 1700,
      run: ({ oldEl, newEl }) => {
        const { r } = stageSize();
        const ring = fxEl("fx-portal");
        const newImg = newEl.querySelector("img");
        const opts = { duration: 1600, easing: "cubic-bezier(.7,0,.3,1)" };
        // Compat: dramatic scale + glowing ring, but no clipPath / spin (those dropped frames)
        if (compat()) {
          const span = Math.min(r * 1.85, 1500);
          return Promise.all([
            play(
              oldEl,
              [
                { opacity: 1, transform: "scale(1)" },
                { opacity: 0, transform: "scale(0.72)" },
              ],
              { duration: 1100, easing: "ease-in" }
            ),
            play(
              newEl,
              [
                { opacity: 0, transform: "scale(0.28)" },
                { opacity: 0, offset: 0.3 },
                { opacity: 1, transform: "none" },
              ],
              { duration: 1300, easing: "cubic-bezier(.7,0,.3,1)" }
            ),
            play(
              ring,
              [
                { width: "0px", height: "0px", opacity: 1, transform: "translate(-50%, -50%)" },
                { width: `${span * 0.55}px`, height: `${span * 0.55}px`, opacity: 1, offset: 0.45, transform: "translate(-50%, -50%)" },
                { width: `${span}px`, height: `${span}px`, opacity: 0, transform: "translate(-50%, -50%)" },
              ],
              { duration: 1400, easing: "cubic-bezier(.7,0,.3,1)" }
            ),
          ]);
        }
        const jobs = [
          play(newEl, [{ clipPath: "circle(0px at 50% 50%)" }, { clipPath: `circle(${r}px at 50% 50%)` }], opts),
          play(
            ring,
            [
              { width: "0px", height: "0px", opacity: 1, transform: "translate(-50%, -50%) rotate(0deg)" },
              { opacity: 1, offset: 0.85 },
              { width: `${r * 2}px`, height: `${r * 2}px`, opacity: 0, transform: "translate(-50%, -50%) rotate(270deg)" },
            ],
            opts
          ),
          play(oldEl, [{ transform: "none", filter: "none" }, { transform: "rotate(25deg) scale(.6)", filter: "brightness(.25) hue-rotate(90deg)" }], opts),
        ];
        if (newImg) {
          jobs.push(play(newImg, [{ transform: "rotate(-40deg) scale(1.5)" }, { transform: "none" }], opts));
        }
        return Promise.all(jobs);
      },
    },

    snuffed: {
      ms: 2700,
      run: ({ oldEl, newEl }) => {
        const { r } = stageSize();
        const flame = fxEl("fx-flame");
        const smoke = fxEl("fx-smoke");
        const base = "translate(-50%, -100%)";
        flame.animate(
          [
            { transform: `${base} scale(1) rotate(-2deg)` },
            { transform: `${base} scale(.92, 1.08) rotate(3deg)` },
            { transform: `${base} scale(1.05, .95) rotate(-1deg)` },
          ],
          { duration: 260, iterations: Infinity, direction: "alternate" }
        );
        const open = [0, 0.12, 0.08, 0.35, 0.3, 0.62, 0.56, 0.88, 1];
        const openFrames = candleRadii(open, r).map((f, i) => ({
          ...f,
          filter: i === open.length - 1 ? "none" : `sepia(${0.8 * (1 - i / open.length)}) brightness(${0.7 + (0.3 * i) / open.length})`,
        }));
        return Promise.all([
          play(oldEl, candleRadii([1, 0.78, 0.84, 0.55, 0.62, 0.3, 0.36, 0.1, 0], r), { duration: 1100, easing: "ease-in" }),
          play(flame, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 650 }),
          play(flame, [{ opacity: 1, transform: `${base} scale(1)` }, { opacity: 0, transform: `${base} scale(.2, 0)` }], {
            duration: 220,
            delay: 1500,
            easing: "ease-in",
            fill: "forwards",
          }),
          play(
            smoke,
            [
              { opacity: 0, transform: `${base} scale(.5)` },
              { opacity: 0.75, offset: 0.2 },
              { opacity: 0, transform: "translate(-30%, -420%) scale(2.6)" },
            ],
            { duration: 1100, delay: 1560, easing: "ease-out" }
          ),
          play(newEl, openFrames, { duration: 950, delay: 1750, easing: "ease-out" }),
        ]);
      },
    },

    spider: {
      ms: 2900,
      run: ({ oldEl, newEl }) => {
        sendUnder(newEl);
        const thread = fxEl("fx-spider", `<div class="spider">${SPIDER_SVG}</div>`);
        const spider = thread.firstElementChild;
        const legs = spider.querySelector(".legs");
        if (legs) {
          legs.animate([{ transform: "rotate(-4deg)" }, { transform: "rotate(4deg)" }], {
            duration: 180,
            iterations: Infinity,
            direction: "alternate",
          });
        }
        const tilt = rand(-4, 4);
        const lift = { duration: 1400, delay: 1350, easing: "cubic-bezier(.55,0,.35,1)" };
        return Promise.all([
          play(thread, [{ transform: "translateY(0)" }, { transform: "translateY(58vh)" }], {
            duration: 1000,
            easing: "cubic-bezier(.3,1.4,.5,1)",
          }),
          play(spider, [{ transform: "rotate(0)" }, { transform: "rotate(9deg)" }, { transform: "rotate(-7deg)" }, { transform: "rotate(0)" }], {
            duration: 450,
            delay: 950,
          }),
          play(thread, [{ transform: "translateY(58vh)" }, { transform: "translateY(-60vh)" }], { ...lift, fill: "forwards" }),
          play(oldEl, [{ transform: "none" }, { transform: `translateY(-118vh) rotate(${tilt}deg)` }], {
            ...lift,
            delay: lift.delay + 60,
          }),
          play(newEl, [{ filter: "brightness(.3)" }, { filter: "none" }], { duration: 1500, delay: 1350 }),
        ]);
      },
    },

    ashes: {
      ms: 2800,
      prepare: ({ oldEl }) => {
        const { w, h } = stageSize();
        if (compat()) {
          const src = renderSlide(oldEl, w, h, 1);
          return { src, w, h, compat: true };
        }
        const src = renderSlide(oldEl, w, h, 1);
        const pixels = src.getContext("2d").getImageData(0, 0, src.width, src.height).data;
        return { src, pixels, w, h, compat: false };
      },
      run: async ({ oldEl, newEl, prepared }) => {
        const { w, h } = stageSize();
        const ready = fresh(prepared) || TRANSITIONS.ashes.prepare({ oldEl });
        const { src } = ready;
        const { ctx } = fxCanvas(w, h, 1);
        ctx.drawImage(src, 0, 0);
        oldEl.style.visibility = "hidden";

        // Compat: wind wipe + a handful of motes — full particle grids stall the main thread
        if (compat() || !ready.pixels) {
          const motes = [];
          for (let i = 0; i < 48; i++) {
            motes.push({
              x: rand(0, w),
              y: rand(0, h),
              vx: rand(80, 260),
              vy: rand(-200, -40),
              s: rand(4, 14),
              ember: pick(EMBERS),
            });
          }
          play(newEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 1500, delay: 250 });
          await animateFrames(1800, (p) => {
            const wipe = p * (w + 80);
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(src, 0, 0);
            ctx.clearRect(0, 0, wipe, h);
            ctx.globalAlpha = Math.max(0, 1 - p * 1.15);
            ctx.fillStyle = "#ffab40";
            for (const m of motes) {
              if (m.x > wipe + 40) continue;
              const sec = p * 1.8;
              ctx.fillStyle = m.ember;
              ctx.fillRect(m.x + m.vx * sec * 0.35, m.y + m.vy * sec * 0.35, m.s * (1 - p * 0.7), m.s * (1 - p * 0.7));
            }
          });
          return;
        }

        const { pixels } = ready;
        const size = Math.max(5, Math.round(Math.sqrt((w * h) / 8000)));
        const life = 1150;
        const parts = [];
        let lastStart = 0;
        for (let y = 0; y < h; y += size) {
          for (let x = 0; x < w; x += size) {
            const px = Math.min(src.width - 1, x + (size >> 1));
            const py = Math.min(src.height - 1, y + (size >> 1));
            const i = (py * src.width + px) * 4;
            const sum = pixels[i] + pixels[i + 1] + pixels[i + 2];
            const delay = (x / w) * 1000 + (1 - y / h) * 150 + rand(0, 380);
            lastStart = Math.max(lastStart, delay);
            parts.push({
              x,
              y,
              delay,
              visible: sum > 24,
              color: `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})`,
              ember: pick(EMBERS),
              vx: rand(60, 220),
              vy: rand(-220, -50),
            });
          }
        }
        play(newEl, [{ filter: "brightness(.25)" }, { filter: "none" }], { duration: 1800, delay: 300 });
        await animateFrames(lastStart + life, (_p, t) => {
          ctx.globalAlpha = 1;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(src, 0, 0);
          for (const q of parts) if (t >= q.delay) ctx.clearRect(q.x, q.y, size, size);
          for (const q of parts) {
            const lt = t - q.delay;
            if (lt < 0 || !q.visible || lt >= life) continue;
            const k = lt / life;
            const sec = lt / 1000;
            const s = size * (1 - k * 0.8);
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = k < 0.18 ? q.color : q.ember;
            ctx.fillRect(q.x + q.vx * sec + 140 * sec * sec, q.y + q.vy * sec - 80 * sec * sec, s, s);
          }
        });
      },
    },

    burn: {
      ms: 2500,
      prepare: ({ oldEl }) => {
        const { w, h } = stageSize();
        const dpr = canvasDpr();
        const src = renderSlide(oldEl, w, h, dpr);
        const cols = compat() ? 64 : 120;
        const rows = Math.max(2, Math.round((cols * h) / w));
        const n1 = valueNoise(cols, rows, 14);
        const n2 = valueNoise(cols, rows, 5);
        const ox = rand(0.2, 0.8) * cols;
        const oy = rand(0.2, 0.8) * rows;
        const field = new Float32Array(cols * rows);
        let lo = Infinity;
        let hi = -Infinity;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const dist = Math.hypot(x - ox, (y - oy) * 1.2) / cols;
            field[i] = dist * 0.6 + n1[i] * 0.3 + n2[i] * 0.1;
            lo = Math.min(lo, field[i]);
            hi = Math.max(hi, field[i]);
          }
        }
        for (let i = 0; i < field.length; i++) field[i] = (field[i] - lo) / (hi - lo);
        return { src, field, cols, rows, w, h, dpr, compat: compat() };
      },
      run: async ({ oldEl, prepared }) => {
        const { src, field, cols, rows, w, h, dpr } = fresh(prepared) || TRANSITIONS.burn.prepare({ oldEl });
        const { canvas, ctx } = fxCanvas(w, h, dpr);
        ctx.drawImage(src, 0, 0);
        oldEl.style.visibility = "hidden";

        const mask = document.createElement("canvas");
        mask.width = cols;
        mask.height = rows;
        const mctx = mask.getContext("2d");
        const mimg = mctx.createImageData(cols, rows);
        // The glow is low-res anyway, so let the compositor stretch it instead of redrawing it full-size
        const edge = document.createElement("canvas");
        edge.className = "fx-canvas";
        edge.width = cols;
        edge.height = rows;
        fx.appendChild(edge);
        const ectx = edge.getContext("2d");
        const eimg = ectx.createImageData(cols, rows);

        await animateFrames(2400, (p) => {
          const T = -0.08 + 1.2 * easeInOut(p);
          const m = mimg.data;
          const e = eimg.data;
          for (let i = 0; i < field.length; i++) {
            const d = field[i] - T;
            const o = i * 4;
            m[o + 3] = d >= 0 ? 255 : 0;
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            if (d >= -0.035 && d < 0) {
              r = 255; g = 150; b = 40; a = 255 * (1 + d / 0.035);
            } else if (d >= 0 && d < 0.018) {
              r = 255; g = 235; b = 160; a = 255;
            } else if (d >= 0.018 && d < 0.075) {
              const t = (d - 0.018) / 0.057;
              r = 255 - 215 * t; g = 110 - 95 * t; b = 20 - 15 * t; a = 245 * (1 - t * 0.6);
            }
            e[o] = r;
            e[o + 1] = g;
            e[o + 2] = b;
            e[o + 3] = a;
          }
          mctx.putImageData(mimg, 0, 0);
          ectx.putImageData(eimg, 0, 0);
          // Burnt areas never come back, so cutting the previous frame again is enough
          ctx.imageSmoothingEnabled = true;
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
        });
      },
    },

    ripple: {
      ms: 2100,
      prepare: ({ oldEl, newEl }) => {
        const { w, h } = stageSize();
        const dpr = canvasDpr();
        const a = renderSlide(oldEl, w, h, dpr);
        const b = renderSlide(newEl, w, h, dpr);
        return { a, b, w, h, dpr };
      },
      run: async ({ oldEl, newEl, prepared }) => {
        const { a, b, w, h, dpr } = fresh(prepared) || TRANSITIONS.ripple.prepare({ oldEl, newEl });
        const { canvas, ctx } = fxCanvas(w, h, dpr);
        const tint = fxEl("fx-reflection");
        oldEl.style.visibility = "hidden";
        play(tint, [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 2000 });
        const slice = Math.max(1, Math.round(3 * dpr));
        await animateFrames(2000, (p, t) => {
          const amp = Math.sin(Math.PI * p) * w * 0.05 * dpr;
          const mix = smoothstep(0.3, 0.7, p);
          const sec = t / 1000;
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          for (let y = 0; y < canvas.height; y += slice) {
            const yy = y / dpr;
            const off = amp * Math.sin(yy * 0.022 + sec * 7) + amp * 0.45 * Math.sin(yy * 0.071 - sec * 11);
            if (mix < 1) {
              ctx.globalAlpha = 1;
              ctx.drawImage(a, 0, y, a.width, slice, off, y, a.width, slice);
            }
            if (mix > 0) {
              ctx.globalAlpha = mix;
              ctx.drawImage(b, 0, y, b.width, slice, -off * 0.8, y, b.width, slice);
            }
          }
        });
      },
    },

    "crypt-doors": {
      ms: 2400,
      prepare: async ({ oldEl }) => ({ ...stageSize(), set: await makePieces(oldEl, 2, 1) }),
      run: async ({ oldEl, newEl, prepared }) => {
        sendUnder(newEl);
        stage.style.perspective = "1600px";
        const [left, right] = await splitSlide(oldEl, 2, 1, true, fresh(prepared)?.set);
        const faces = [];
        for (const [piece, side] of [[left, "left"], [right, "right"]]) {
          piece.el.style.transformOrigin = side === "left" ? "0% 50%" : "100% 50%";
          piece.el.style.backfaceVisibility = "hidden";
          const face = document.createElement("div");
          face.className = `door-face door-${side}`;
          piece.el.appendChild(face);
          faces.push(face);
        }
        const light = fxEl("fx-cryptlight");
        const swing = (dir) => [
          { transform: "rotateY(0deg)" },
          { transform: `rotateY(${dir * 2}deg)`, offset: 0.06 },
          { transform: "rotateY(0deg)", offset: 0.1 },
          { transform: `rotateY(${dir * 3.5}deg)`, offset: 0.17 },
          { transform: "rotateY(0deg)", offset: 0.24 },
          { transform: "rotateY(0deg)", offset: 0.3, easing: "cubic-bezier(.55,0,.25,1)" },
          { transform: `rotateY(${dir * 100}deg)` },
        ];
        const duration = 2400;
        return Promise.all([
          play(left.el, swing(1), { duration }),
          play(right.el, swing(-1), { duration }),
          ...faces.map((f) => play(f, [{ opacity: 0.5 }, { opacity: 0.5, offset: 0.3 }, { opacity: 1 }], { duration })),
          play(light, [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], { duration }),
          play(newEl, [{ filter: "brightness(.1)" }, { filter: "brightness(.1)", offset: 0.3 }, { filter: "none" }], { duration }),
        ]);
      },
    },

    spellbook: {
      ms: 2000,
      prepare: async ({ oldEl, newEl }) => ({
        ...stageSize(),
        oldSet: await makePieces(oldEl, 2, 1),
        newSet: await makePieces(newEl, 2, 1),
      }),
      run: async ({ oldEl, newEl, prepared }) => {
        sendUnder(newEl);
        stage.style.perspective = "2200px";
        const ready = fresh(prepared);
        const [, oldRight] = await splitSlide(oldEl, 2, 1, true, ready?.oldSet);
        const [newLeft, newRight] = await splitSlide(newEl, 2, 1, false, ready?.newSet);
        newRight.el.remove();
        for (const piece of [oldRight, newLeft]) {
          piece.el.style.transformOrigin = "50% 50%";
          piece.el.style.backfaceVisibility = "hidden";
          piece.el.style.zIndex = "4";
        }
        const spine = fxEl("fx-spine");
        const half = 950;
        return Promise.all([
          play(
            oldRight.el,
            [
              { transform: "rotateY(0deg)", filter: "brightness(1)" },
              { transform: "rotateY(-90deg)", filter: "brightness(.4) sepia(.6)" },
            ],
            { duration: half, easing: "cubic-bezier(.45,0,.9,.6)" }
          ),
          play(
            newLeft.el,
            [
              { transform: "rotateY(90deg)", filter: "brightness(.4) sepia(.6)" },
              { transform: "rotateY(0deg)", filter: "none" },
            ],
            { duration: half, delay: half, easing: "cubic-bezier(.1,.4,.55,1)" }
          ),
          play(spine, [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: half * 2 }),
        ]);
      },
    },

    summoning: {
      ms: 2500,
      prepare: () => {
        const { w, h } = stageSize();
        return buildSummoning(w, h);
      },
      run: ({ oldEl, newEl, prepared }) => {
        const { w, h } = stageSize();
        const built = fresh(prepared) || buildSummoning(w, h);
        const light = compat();
        const sigil = fxEl("fx-sigil", built.html);
        sigil.style.width = `${built.S}px`;
        sigil.style.height = `${built.S}px`;
        const [ring1, ring2, pent] = sigil.querySelectorAll(".draw");
        const runeText = sigil.querySelector(".runes");
        const flash = fxEl("fx-flash fx-flash-red");
        const draw = (el, delay, duration) =>
          play(el, [{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }], { duration, delay, easing: "ease-in-out" });
        const center = "translate(-50%, -50%)";
        const jobs = [
          draw(ring1, 0, 800),
          draw(ring2, 150, 800),
          draw(pent, 450, 850),
          play(runeText, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 650 }),
          play(
            sigil,
            [
              { transform: `${center} rotate(0deg) scale(1)`, opacity: 1 },
              { transform: `${center} rotate(25deg) scale(1)`, opacity: 1, offset: 0.55 },
              { transform: `${center} rotate(32deg) scale(1.08)`, opacity: 1, offset: 0.6 },
              { transform: `${center} rotate(60deg) scale(1.9)`, opacity: 0 },
            ],
            { duration: 2500 }
          ),
          play(flash, [{ opacity: 0 }, { opacity: 0.8, offset: 0.3 }, { opacity: 0 }], { duration: 450, delay: 1300 }),
        ];
        if (light) {
          const veil = fxEl("fx-dusk");
          veil.style.background = "radial-gradient(ellipse at 50% 50%, rgba(120,0,20,.55), rgba(20,0,0,.75))";
          jobs.push(
            play(veil, [{ opacity: 0 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: 1400 }),
            play(newEl, [{ opacity: 0, transform: "scale(0.2)" }, { opacity: 1, transform: "none" }], {
              duration: 900,
              delay: 1400,
              easing: "cubic-bezier(.7,0,.3,1)",
            })
          );
        } else {
          jobs.push(
            play(oldEl, [{ filter: "none" }, { filter: "brightness(.35) sepia(.8) hue-rotate(-30deg) saturate(2)" }], {
              duration: 1300,
            }),
            play(newEl, [{ clipPath: "circle(0px at 50% 50%)" }, { clipPath: `circle(${built.r}px at 50% 50%)` }], {
              duration: 900,
              delay: 1400,
              easing: "cubic-bezier(.7,0,.3,1)",
            })
          );
        }
        return Promise.all(jobs);
      },
    },

    blink: {
      ms: 1900,
      run: ({ newEl }) => {
        const top = fxEl("fx-lid fx-lid-top");
        const bottom = fxEl("fx-lid fx-lid-bottom");
        const duration = 1900;
        const lid = (dir) =>
          [
            [0, -100],
            [0.16, -38],
            [0.26, -62],
            [0.4, 0],
            [0.55, 0],
            [0.66, -45],
            [0.72, -30],
            [1, -100],
          ].map(([offset, y]) => ({ offset, transform: `translateY(${dir * y}%)` }));
        const reveal = compat()
          ? [
              { opacity: 0, transform: "scale(1.14)" },
              { opacity: 0, offset: 0.47 },
              { opacity: 1, offset: 0.48, transform: "scale(1.14)" },
              { opacity: 1, transform: "none" },
            ]
          : [
              { opacity: 0, transform: "scale(1.14)", filter: "blur(8px) saturate(1.4)" },
              { opacity: 0, offset: 0.47 },
              { opacity: 1, offset: 0.48, transform: "scale(1.14)", filter: "blur(8px) saturate(1.4)" },
              { opacity: 1, transform: "none", filter: "none" },
            ];
        return Promise.all([
          play(top, lid(1), { duration, easing: "ease-in-out" }),
          play(bottom, lid(-1), { duration, easing: "ease-in-out" }),
          play(newEl, reveal, { duration, easing: "ease-out" }),
        ]);
      },
    },

    vines: {
      ms: 2800,
      prepare: () => {
        const { w, h } = stageSize();
        return buildVines(w, h);
      },
      run: ({ newEl, prepared }) => {
        const { w, h } = stageSize();
        const built = fresh(prepared) || buildVines(w, h);
        const layer = fxEl("fx-vines", built.html);
        const thicket = fxEl("fx-thicket");
        fx.insertBefore(thicket, layer);
        const grow = 1100;
        const jobs = [];
        layer.querySelectorAll(".vine").forEach((path, i) => {
          const delay = built.vines[i].delay;
          jobs.push(
            play(
              path,
              [
                { strokeDashoffset: "1" },
                { strokeDashoffset: "0", offset: (grow + delay) / 2600 },
                { strokeDashoffset: "0", offset: 0.62 },
                { strokeDashoffset: "1" },
              ],
              { duration: 2600, easing: "ease-in-out" }
            )
          );
        });
        layer.querySelectorAll(".thorns path").forEach((thorn) => {
          const appear = Number(thorn.dataset.appear) || 0;
          jobs.push(
            play(
              thorn,
              [
                { opacity: 0 },
                { opacity: 0, offset: appear / 2600 },
                { opacity: 1, offset: Math.min(0.6, appear / 2600 + 0.03) },
                { opacity: 1, offset: 0.62 },
                { opacity: 0, offset: 0.8 },
                { opacity: 0 },
              ],
              { duration: 2600 }
            )
          );
        });
        jobs.push(
          play(thicket, [{ opacity: 0 }, { opacity: 0.96, offset: 0.42 }, { opacity: 0.96, offset: 0.55 }, { opacity: 0 }], {
            duration: 2600,
          }),
          play(newEl, [{ opacity: 0 }, { opacity: 0, offset: 0.48 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration: 2600 })
        );
        return Promise.all(jobs);
      },
    },

    tarot: {
      ms: 2700,
      run: ({ oldEl, newEl }) => {
        const { w, h } = stageSize();
        const ch = h * 0.82;
        const cw = Math.min(w * 0.8, ch * 0.6);
        const ix = (w - cw) / 2;
        const iy = (h - ch) / 2;
        const card = `inset(${iy}px ${ix}px ${iy}px ${ix}px round 22px)`;
        const full = "inset(0px 0px 0px 0px round 0px)";
        const glow = fxEl("fx-tarot-glow");
        const back = fxEl("fx-tarot", TAROT_SVG);
        back.style.width = `${cw * 0.92}px`;
        back.style.height = `${ch * 0.92}px`;
        const persp = "perspective(1600px)";
        const duration = 2700;
        const center = "translate(-50%, -50%)";
        return Promise.all([
          play(glow, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration }),
          play(
            oldEl,
            [
              { clipPath: full, transform: `${persp} rotateY(0deg) scale(1)`, easing: "ease-in-out" },
              { clipPath: card, transform: `${persp} rotateY(0deg) scale(.92)`, offset: 0.25, easing: "ease-in" },
              { clipPath: card, transform: `${persp} rotateY(90deg) scale(.92)`, offset: 0.4 },
              { clipPath: card, transform: `${persp} rotateY(90deg) scale(.92)` },
            ],
            { duration }
          ),
          play(
            back,
            [
              { transform: `${center} ${persp} rotateY(-90deg)` },
              { transform: `${center} ${persp} rotateY(-90deg)`, offset: 0.4, easing: "ease-out" },
              { transform: `${center} ${persp} rotateY(0deg) translateY(0)`, offset: 0.5 },
              { transform: `${center} ${persp} rotateY(0deg) translateY(-2%)`, offset: 0.6 },
              { transform: `${center} ${persp} rotateY(0deg) translateY(0)`, offset: 0.66, easing: "ease-in" },
              { transform: `${center} ${persp} rotateY(90deg)`, offset: 0.76 },
              { transform: `${center} ${persp} rotateY(90deg)` },
            ],
            { duration }
          ),
          play(
            newEl,
            [
              { opacity: 0, clipPath: card, transform: `${persp} rotateY(-90deg) scale(.92)` },
              { opacity: 0, offset: 0.76 },
              { opacity: 1, offset: 0.761, clipPath: card, transform: `${persp} rotateY(-90deg) scale(.92)`, easing: "ease-out" },
              { clipPath: card, transform: `${persp} rotateY(0deg) scale(.92)`, offset: 0.86, easing: "ease-in-out" },
              { opacity: 1, clipPath: full, transform: `${persp} rotateY(0deg) scale(1)` },
            ],
            { duration }
          ),
        ]);
      },
    },
  };

  let timer = null;
  let busy = false;
  let currentEl = null;
  let lastName = "";
  let sequenceIndex = -1;
  const config = {
    duration: 5,
    transitions: Object.keys(TRANSITIONS),
    mode: "random",
  };

  function applyConfig(data) {
    if (typeof data.slide_duration === "number" && data.slide_duration >= 1) {
      config.duration = data.slide_duration;
    }
    if (Array.isArray(data.transitions)) config.transitions = data.transitions;
    if (data.transition_mode) config.mode = data.transition_mode;
    if (typeof data.compat_mode === "boolean") {
      compatOn = data.compat_mode;
      document.body.classList.toggle("compat-mode", compatOn);
      if (compatOn) canvasQuality = Math.min(canvasQuality, 0.65);
    }
    if (data.qr) updateQr(data.qr);
  }

  let qrKey = "";

  async function updateQr(qr) {
    if (!qr.enabled) {
      qrBox.hidden = true;
      delete document.body.dataset.qrCorner;
      qrKey = "";
      return;
    }
    qrBox.style.setProperty("--qr-size", `${qr.size}vmin`);
    qrBox.dataset.corner = qr.corner;
    document.body.dataset.qrCorner = qr.corner;
    const key = JSON.stringify([qr.theme, qr.label, qr.base_url]);
    if (key === qrKey) {
      qrBox.hidden = false;
      return;
    }
    qrKey = key;
    try {
      const res = await fetch(`/api/qr-link?origin=${encodeURIComponent(window.location.origin)}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      window.SlideshowQR.render(qrBox, { url: data.url, theme: qr.theme, label: qr.label });
      qrBox.hidden = false;
    } catch (_) {
      qrKey = ""; // retry on the next slide
    }
  }

  function chooseTransition() {
    if (forcedTransition && TRANSITIONS[forcedTransition]) return forcedTransition;
    const enabled = config.transitions.filter((n) => TRANSITIONS[n]);
    const pool = enabled.length ? enabled : Object.keys(TRANSITIONS);
    if (config.mode === "sequence") {
      sequenceIndex = (sequenceIndex + 1) % pool.length;
      return pool[sequenceIndex];
    }
    const options = pool.length > 1 ? pool.filter((n) => n !== lastName) : pool;
    return pick(options);
  }

  function formatCaption(image) {
    const name = (image && image.uploader_name) || "Anonymous";
    let time = "--:--";
    if (image && image.created_at) {
      const d = new Date(image.created_at);
      if (!Number.isNaN(d.getTime())) {
        time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      }
    }
    return `${time} - ${name}`;
  }

  async function buildSlide(image) {
    const frame = document.createElement("div");
    frame.className = "slide";
    const img = document.createElement("img");
    img.alt = "";
    img.src = image.url;
    const meta = document.createElement("p");
    meta.className = "slide-meta";
    meta.textContent = formatCaption(image);
    frame.appendChild(img);
    frame.appendChild(meta);
    await img.decode();
    return frame;
  }

  function cleanupAfter(oldEl, newEl) {
    oldEl.remove();
    stage.querySelectorAll(".piece").forEach((el) => el.remove());
    fx.replaceChildren();
    newEl.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    newEl.style.zIndex = "";
    stage.style.perspective = "";
  }

  async function transitionTo(newEl, preName, prepared) {
    const name = preName || chooseTransition();
    lastName = name;
    const tx = TRANSITIONS[name];

    let oldEl = currentEl;
    if (!oldEl) {
      oldEl = document.createElement("div");
      oldEl.className = "slide";
      stage.appendChild(oldEl);
    }
    oldEl.style.zIndex = "1";
    newEl.style.zIndex = "2";
    // A prepared slide is already laid out under the current one; moving it would repaint it
    if (newEl.parentNode !== stage) stage.appendChild(newEl);
    currentEl = newEl;

    try {
      await Promise.race([tx.run({ oldEl, newEl, prepared }), wait(tx.ms + 2500)]);
    } catch (_) {
      // A broken effect should never stall the slideshow
    }
    cleanupAfter(oldEl, newEl);
  }

  // Page boot id from the HTML; API boot_id changes when the server restarts.
  const pageBootId = document.body.dataset.bootId || "";

  async function showEmpty(serverBootId) {
    empty.style.display = "grid";
    badge.classList.remove("show");
    if (currentEl) {
      const old = currentEl;
      currentEl = null;
      await play(old, [{ opacity: 1 }, { opacity: 0 }], { duration: 700 });
      old.remove();
    }
    // Waiting screen + new boot id ⇒ pull latest HTML/CSS/JS for the live display.
    if (serverBootId && pageBootId && serverBootId !== pageBootId) {
      location.reload();
    }
  }

  function flashBadge() {
    badge.classList.add("show");
    setTimeout(() => badge.classList.remove("show"), 1800);
  }

  /* While a slide is on screen, get the next one fully ready: the server reserves
     the next photo, it is downloaded, decoded and laid out underneath the current
     slide, the transition is chosen, and that transition's prepare() does its
     heavy canvas/DOM work. The transition itself then starts with nothing to do. */
  let pending = null; // Promise of the prepared next slide (or null)

  async function prepareNext() {
    const res = await fetch("/api/slideshow/peek", { cache: "no-store" });
    const peek = await res.json();
    if (!peek.ok || !peek.image) return null;
    const slide = await buildSlide(peek.image);
    const name = chooseTransition();
    let prepared = null;
    if (currentEl && currentEl.isConnected) {
      // Opaque current slide hides it; being in the page lets the browser lay out and paint it now
      slide.style.zIndex = "0";
      stage.insertBefore(slide, currentEl);
      const tx = TRANSITIONS[name];
      if (tx.prepare) {
        try {
          prepared = await tx.prepare({ oldEl: currentEl, newEl: slide });
        } catch (_) {
          prepared = null;
        }
      }
    }
    return { imageId: peek.image.id, slide, name, prepared };
  }

  async function tick() {
    if (busy) return;
    busy = true;
    let next = 2000;
    // On a slow display preparation may still be running; finishing it beats starting over
    const ready = pending ? await pending : null;
    pending = null;
    let unused = ready;
    const discard = () => {
      if (!unused) return;
      unused.slide.remove();
      stage.querySelectorAll(".piece").forEach((el) => el.remove());
      unused = null;
    };
    try {
      const res = await fetch("/api/slideshow/next", { cache: "no-store" });
      const data = await res.json();
      applyConfig(data);
      if (!data.ok || data.empty || !data.image) {
        discard();
        await showEmpty(data.boot_id);
      } else {
        let slide = null;
        let prepared = null;
        if (ready && ready.imageId === data.image.id) {
          slide = ready.slide;
          prepared = ready.prepared;
          unused = null;
        }
        if (!slide) {
          try {
            slide = await buildSlide(data.image);
          } catch (_) {
            slide = null;
          }
        }
        if (slide) {
          discard();
          empty.style.display = "none";
          if (data.from_priority) flashBadge();
          await transitionTo(slide, ready && ready.name, prepared);
          next = config.duration * 1000;
        } else {
          next = 1000;
        }
      }
    } catch (_) {
      discard();
      await showEmpty();
      next = 2500;
    } finally {
      discard();
      busy = false;
    }
    schedule(next);
    pending = prepareNext().catch(() => null);
  }

  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !busy) schedule(0);
  });

  tick();
})();
