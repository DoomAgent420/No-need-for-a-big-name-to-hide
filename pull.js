// pull.js — Worker-first loader with GitHub fallback and raw-WASM fallback
// Place at repo root. index.html should include:
// <script src="pull.js"></script>
// <script type="module" id="loader"></script>

const workerOrigin = "https://broad-meadow-a6f7.chrisjlove2022.workers.dev";
const githubOrigin = "https://chrisjlove2022.github.io/No-need-for-a-big-name-to-hide";
const MODULE_PATH = "/app.mjs";
const WASM_PATH = "/app.wasm";
const HEAD_TIMEOUT = 5000; // ms

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}
function setOut(msg) {
  const el = document.getElementById("out");
  if (el) el.textContent = msg;
}
function log(...args) {
  console.log(...args);
  setOut((prev => (prev ? prev + "\n" : "") + args.map(a => String(a)).join(" "))(document.getElementById("out")?.textContent));
}

// HEAD check with timeout to detect reachable origin quickly
async function headCheck(url, timeout = HEAD_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { method: "HEAD", mode: "cors", signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Try dynamic import of app.mjs from origin
async function tryImportModule(origin) {
  const moduleUrl = origin.replace(/\/$/, "") + MODULE_PATH;
  try {
    // dynamic import must be a string literal or data URL; create a blob URL wrapper
    // to avoid CSP issues we import directly by URL string
    const mod = await import(moduleUrl);
    return mod;
  } catch (err) {
    throw err;
  }
}

// Raw WASM instantiate fallback (for when import fails)
async function rawInstantiateWasm(origin) {
  const wasmUrl = origin.replace(/\/$/, "") + WASM_PATH;
  try {
    // prefer instantiateStreaming if available and server serves correct MIME and CORS
    if (WebAssembly.instantiateStreaming) {
      const resp = await fetch(wasmUrl, { mode: "cors" });
      if (!resp.ok) throw new Error("WASM fetch failed: " + resp.status);
      const { instance, module } = await WebAssembly.instantiateStreaming(resp, {});
      return { instance, module };
    } else {
      const resp = await fetch(wasmUrl, { mode: "cors" });
      if (!resp.ok) throw new Error("WASM fetch failed: " + resp.status);
      const buffer = await resp.arrayBuffer();
      const { instance, module } = await WebAssembly.instantiate(buffer, {});
      return { instance, module };
    }
  } catch (err) {
    throw err;
  }
}

// Main loader logic
(async function main() {
  setStatus("Checking Worker availability...");
  log("Starting Worker-first detection");

  let chosenOrigin = null;

  // 1) Try Worker HEAD quickly
  try {
    const headUrl = workerOrigin.replace(/\/$/, "") + MODULE_PATH;
    const res = await headCheck(headUrl);
    if (res && res.ok) {
      log("Worker HEAD OK:", headUrl);
      chosenOrigin = workerOrigin;
    } else {
      log("Worker HEAD returned non-OK:", res && res.status);
      throw new Error("Worker HEAD non-OK");
    }
  } catch (err) {
    log("Worker unreachable or error:", err && err.message ? err.message : err);
    setStatus("Worker unreachable — falling back to GitHub");
    chosenOrigin = githubOrigin;
  }

  // 2) Try to import module from chosen origin (Worker preferred)
  window.pullMode = chosenOrigin.includes("workers.dev") ? "worker" : "github";
  setStatus(`Loading module from ${window.pullMode === "worker" ? "Worker" : "GitHub"}...`);

  const loaderEl = document.getElementById("loader");
  if (!loaderEl) {
    log("No #loader script tag found in HTML. Aborting.");
    setStatus("Loader missing");
    return;
  }

  // Attempt dynamic import first (this will fail early on TLS cert errors)
  try {
    log("Attempting dynamic import from", chosenOrigin);
    const mod = await tryImportModule(chosenOrigin);
    // If module exports a default factory (Emscripten style), call it
    if (mod && (typeof mod.default === "function" || typeof mod.createModule === "function")) {
      setStatus("Initializing module...");
      const factory = mod.default || mod.createModule || mod.createModule;
      const Module = await factory();
      log("Module initialized from", chosenOrigin);
      setStatus("WASM Ready (module import)");
      setOut(`Loaded from: ${chosenOrigin}`);
      return;
    } else {
      // If module doesn't export a factory, just report success
      log("Module imported, exports:", Object.keys(mod || {}));
      setStatus("Module imported");
      setOut(`Loaded from: ${chosenOrigin}`);
      return;
    }
  } catch (importErr) {
    log("Dynamic import failed for", chosenOrigin, importErr && importErr.message ? importErr.message : importErr);
    // If we tried Worker and it failed due to cert, switch to GitHub and try again
    if (chosenOrigin === workerOrigin) {
      log("Switching to GitHub fallback and retrying import");
      window.pullMode = "github";
      chosenOrigin = githubOrigin;
      setStatus("Retrying import from GitHub...");
      try {
        const mod2 = await tryImportModule(chosenOrigin);
        if (mod2 && (typeof mod2.default === "function" || typeof mod2.createModule === "function")) {
          const factory2 = mod2.default || mod2.createModule || mod2.createModule;
          const Module2 = await factory2();
          log("Module initialized from GitHub");
          setStatus("WASM Ready (module import fallback)");
          setOut(`Loaded from: ${chosenOrigin}`);
          return;
        } else {
          log("Module imported from GitHub, exports:", Object.keys(mod2 || {}));
          setStatus("Module imported from GitHub");
          setOut(`Loaded from: ${chosenOrigin}`);
          return;
        }
      } catch (importErr2) {
        log("Import from GitHub also failed:", importErr2 && importErr2.message ? importErr2.message : importErr2);
        // fall through to raw WASM fallback
      }
    }
    // If we already were on GitHub or import failed twice, continue to raw WASM fallback
  }

  // 3) Raw WASM instantiate fallback (same code path as Worker would do)
  setStatus("Attempting raw WASM instantiate fallback...");
  try {
    const wasmResult = await rawInstantiateWasm(chosenOrigin);
    log("Raw WASM instantiated from", chosenOrigin, wasmResult);
    setStatus("WASM Ready (raw instantiate)");
    setOut(`WASM instantiated from: ${chosenOrigin}`);
    return;
  } catch (wasmErr) {
    log("Raw WASM instantiate failed for", chosenOrigin, wasmErr && wasmErr.message ? wasmErr.message : wasmErr);
    // If we tried GitHub and failed, and we originally tried Worker, try the other origin once more
    if (chosenOrigin === githubOrigin && window.pullMode === "github") {
      log("Final attempt: try Worker raw instantiate (may fail due to cert)");
      try {
        const wasmResult2 = await rawInstantiateWasm(workerOrigin);
        log("Raw WASM instantiated from Worker on final attempt", wasmResult2);
        window.pullMode = "worker";
        setStatus("WASM Ready (raw instantiate from Worker)");
        setOut(`WASM instantiated from: ${workerOrigin}`);
        return;
      } catch (finalErr) {
        log("Final attempt failed:", finalErr && finalErr.message ? finalErr.message : finalErr);
      }
    }
    setStatus("All loading attempts failed — check console for details");
    setOut((document.getElementById("out")?.textContent || "") + "\nAll loading attempts failed.");
  }
})();
