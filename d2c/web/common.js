const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (p) => "\u20b9" + (Number(p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STEPS = ["Placed", "Packed", "Shipped", "Out for delivery", "Delivered"];
const configMissing = () => !window.CONFIG || /YOUR_/.test(CONFIG.SUPABASE_URL + CONFIG.SUPABASE_ANON_KEY);
(function () {
  const K = "d2c_theme", root = document.documentElement;
  try { const t = localStorage.getItem(K); if (t === "dark" || t === "light") root.dataset.theme = t; } catch (e) {}
  const cur = () => root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const paint = () => { const b = $("#themebtn"); if (b) b.textContent = cur() === "dark" ? "Light mode" : "Dark mode"; };
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#themebtn")) return;
    const n = cur() === "dark" ? "light" : "dark";
    root.dataset.theme = n;
    try { localStorage.setItem(K, n); } catch (_) {}
    paint();
  });
  paint();
})();
