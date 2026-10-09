/* Shell: tabs, theme, clipboard, toast */
const App = (() => {
  const tabs = () => document.querySelectorAll(".tabs [data-tab]");

  function show(name) {
    if (!document.querySelector(`[data-panel="${name}"]`)) name = "subnet";
    tabs().forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  async function copy(text, msg = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(msg);
  }

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("opskit-theme", t); } catch {}
  }

  function init() {
    let saved = null;
    try { saved = localStorage.getItem("opskit-theme"); } catch {}
    setTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    document.getElementById("themeToggle").addEventListener("click", () =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

    tabs().forEach((t) => t.addEventListener("click", () => { location.hash = t.dataset.tab; }));
    window.addEventListener("hashchange", () => show(location.hash.slice(1)));
    show(location.hash.slice(1));

    Subnet.init();
    K8s.init();
    Cron.init();
  }

  return { init, copy, toast };
})();

document.addEventListener("DOMContentLoaded", App.init);
