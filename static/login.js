(() => {
  const form = document.getElementById("loginForm");
  const password = document.getElementById("password");
  const status = document.getElementById("status");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "Signing in…";
    status.className = "status";
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Wrong password");
      }
      window.location.href = "/admin";
    } catch (err) {
      status.textContent = err.message || "Login failed";
      status.className = "status err";
    }
  });
})();
