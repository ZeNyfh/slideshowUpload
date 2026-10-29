(() => {
  const stage = document.getElementById("stage");
  const empty = document.getElementById("empty");
  const badge = document.getElementById("badge");
  const TRANSITION_MS = 700;

  let timer = null;
  let duration = 5;
  let busy = false;
  let currentEl = null;

  function clearSlides() {
    stage.querySelectorAll(".slide").forEach((el) => el.remove());
    currentEl = null;
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

  function showEmpty() {
    empty.style.display = "grid";
    if (currentEl) {
      const old = currentEl;
      old.classList.remove("current");
      old.classList.add("exit");
      setTimeout(() => old.remove(), TRANSITION_MS + 80);
      currentEl = null;
    } else {
      clearSlides();
    }
    badge.classList.remove("show");
  }

  function showImage(image, fromPriority) {
    return new Promise((resolve) => {
      empty.style.display = "none";
      const frame = document.createElement("div");
      frame.className = "slide enter";

      const img = document.createElement("img");
      img.alt = "";

      const meta = document.createElement("p");
      meta.className = "slide-meta";
      meta.textContent = formatCaption(image);

      frame.appendChild(img);
      frame.appendChild(meta);

      const finish = () => {
        if (fromPriority) {
          badge.classList.add("show");
          setTimeout(() => badge.classList.remove("show"), 1600);
        }
        setTimeout(resolve, TRANSITION_MS);
      };

      img.onload = () => {
        stage.appendChild(frame);
        void frame.offsetWidth;
        frame.classList.remove("enter");
        frame.classList.add("current");

        if (currentEl && currentEl !== frame) {
          const old = currentEl;
          old.classList.remove("current");
          old.classList.add("exit");
          const cleanup = () => old.remove();
          old.addEventListener("transitionend", cleanup, { once: true });
          setTimeout(cleanup, TRANSITION_MS + 80);
        }

        currentEl = frame;
        finish();
      };

      img.onerror = () => resolve();
      img.src = image.url;
    });
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch("/api/slideshow/next", { cache: "no-store" });
      const data = await res.json();
      if (typeof data.slide_duration === "number" && data.slide_duration >= 1) {
        duration = data.slide_duration;
      }
      if (!data.ok || data.empty || !data.image) {
        showEmpty();
        schedule(2000);
        return;
      }
      await showImage(data.image, !!data.from_priority);
      schedule(duration * 1000);
    } catch (_) {
      showEmpty();
      schedule(2500);
    } finally {
      busy = false;
    }
  }

  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });

  tick();
})();
