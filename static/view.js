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

  function showImage(url, fromPriority) {
    return new Promise((resolve) => {
      empty.style.display = "none";
      const incoming = document.createElement("img");
      incoming.className = "slide enter";
      incoming.alt = "";

      const finish = () => {
        if (fromPriority) {
          badge.classList.add("show");
          setTimeout(() => badge.classList.remove("show"), 1600);
        }
        setTimeout(resolve, TRANSITION_MS);
      };

      incoming.onload = () => {
        stage.appendChild(incoming);
        // Force layout so the enter → current transition runs
        void incoming.offsetWidth;
        incoming.classList.remove("enter");
        incoming.classList.add("current");

        if (currentEl && currentEl !== incoming) {
          const old = currentEl;
          old.classList.remove("current");
          old.classList.add("exit");
          const cleanup = () => old.remove();
          old.addEventListener("transitionend", cleanup, { once: true });
          setTimeout(cleanup, TRANSITION_MS + 80);
        }

        currentEl = incoming;
        finish();
      };

      incoming.onerror = () => resolve();
      incoming.src = url;
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
      await showImage(data.image.url, !!data.from_priority);
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
