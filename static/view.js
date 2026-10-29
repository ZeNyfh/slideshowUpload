(() => {
  const slide = document.getElementById("slide");
  const empty = document.getElementById("empty");
  const badge = document.getElementById("badge");
  let timer = null;
  let duration = 5;
  let showing = false;

  function showEmpty() {
    empty.style.display = "block";
    slide.classList.remove("show");
    slide.removeAttribute("src");
    badge.classList.remove("show");
  }

  function showImage(url, fromPriority) {
    empty.style.display = "none";
    slide.classList.remove("show");
    const next = new Image();
    next.onload = () => {
      slide.src = url;
      requestAnimationFrame(() => slide.classList.add("show"));
      if (fromPriority) {
        badge.classList.add("show");
        setTimeout(() => badge.classList.remove("show"), 1600);
      }
    };
    next.onerror = () => {
      schedule(800);
    };
    next.src = url;
  }

  async function tick() {
    if (showing) return;
    showing = true;
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
      showImage(data.image.url, !!data.from_priority);
      schedule(duration * 1000);
    } catch (_) {
      showEmpty();
      schedule(2500);
    } finally {
      showing = false;
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
