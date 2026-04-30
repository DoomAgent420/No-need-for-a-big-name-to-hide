// pull.js — choose Worker or GitHub fallback

// 1. Define your two possible origins
const workerOrigin = "https://broad-meadow-a6f7.chrisjlove2022.workers.dev";
const githubOrigin = "https://chrisjlove2022.github.io/No-need-for-a-big-name-to-hide";

// 2. Helper to update the on‑page status box
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// 3. Try the Worker first
async function detectOrigin() {
  setStatus("Checking Worker…");

  try {
    const testUrl = workerOrigin + "/app.mjs";
    const res = await fetch(testUrl, { method: "HEAD" });

    if (res.ok) {
      setStatus("Worker online — loading from Worker");
      return workerOrigin;
    }

    throw new Error("Worker returned non‑OK");
  } catch (err) {
    setStatus("Worker offline — falling back to GitHub");
    return githubOrigin;
  }
}

// 4. Load the module dynamically once we know the origin
async function loadModule(origin) {
  const loader = document.getElementById("loader");
  if (!loader) {
    console.error("No #loader script tag found");
    return;
  }

  // Inject the module loader code
  loader.textContent = `
    import("${origin}/app.mjs").then(mod => {
      return mod.default();
    }).then(Module => {
      const out = document.getElementById("out");
      if (out) out.textContent = "WASM loaded from: ${origin}";
      setStatus("WASM Ready");
    }).catch(err => {
      console.error("Module load failed:", err);
      setStatus("Module load failed — see console");
    });
  `;
}

// 5. Main startup
(async () => {
  const origin = await detectOrigin();
  window.pullMode = origin.includes("workers.dev") ? "worker" : "github";
  await loadModule(origin);
})();
