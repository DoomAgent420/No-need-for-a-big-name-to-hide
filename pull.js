// Top of pull.js — global guard to stop any later WASM attempts
window.__MODULE_LOADED__ = window.__MODULE_LOADED__ || false;
window.__BLOCK_WASM_IF_MODULE_LOADED__ = true;

function blockWasmIfModuleLoaded(url) {
  if (!window.__BLOCK_WASM_IF_MODULE_LOADED__) return false;
  try {
    const u = String(url || '');
    return window.__MODULE_LOADED__ && (u.endsWith('/app.wasm') || u.includes('/app.wasm'));
  } catch (e) { return false; }
}
// pull.js — Worker-first loader with robust fallbacks and early stop after JS module loads
// Configure these for your project:
const WORKER_ORIGIN = "https://broad-meadow-a6f7.chrisjlove2022.workers.dev";
const PAGES_ORIGIN  = "https://chrisjlove2022.github.io/No-need-for-a-big-name-to-hide";
const CDN_FALLBACK  = "https://cdn.jsdelivr.net/gh/chrisjlove2022/No-need-for-a-big-name-to-hide@main/app.mjs";

// Optional: force worker-only mode (true = try worker only, then stop)
const FORCE_WORKER_ONLY = false;

// UI helpers
function setStatus(s){ const e=document.getElementById('status'); if(e) e.textContent = s; console.log(s); }
function appendOut(s){ const e=document.getElementById('out'); if(e) e.textContent = (e.textContent?e.textContent+"\n":"") + s; console.log(s); }

// Diagnostics store on window for easy inspection
window.pullDiagnostics = window.pullDiagnostics || { attempts: [], success: null };

function diagLog(step, url, ok, err) {
  window.pullDiagnostics.attempts.push({ step, url, ok: !!ok, err: err ? String(err) : null, ts: Date.now() });
  const s = `${step} -> ${url} : ${ok ? 'OK' : 'FAIL'}${err ? ' : '+err : ''}`;
  appendOut(s);
  if (ok && !window.pullDiagnostics.success) window.pullDiagnostics.success = { step, url, ts: Date.now() };
}

// Try a simple fetch probe to see if the Worker endpoint is reachable
async function probeWorker() {
  const probeUrl = WORKER_ORIGIN + '/ping';
  try {
    const r = await fetch(probeUrl, { method: 'GET', mode: 'cors', cache: 'no-store' });
    diagLog('worker-probe', probeUrl, r.ok, r.ok ? null : `status ${r.status}`);
    return r.ok;
  } catch (e) {
    diagLog('worker-probe', probeUrl, false, e);
    return false;
  }
}

// Generic dynamic import with cache-bust and diag logging
async function tryImport(u, label) {
  const url = u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();
  diagLog('import-attempt', url, false, null);
  try {
    const mod = await import(url);
    diagLog('import', url, true, null);
    return mod;
  } catch (err) {
    diagLog('import', url, false, err);
    return null;
  }
}

(async function main() {
  setStatus('Starting loader');
  appendOut('Loader start: prefer Worker when reachable');

  // If forcing worker-only, probe and try worker import only
  if (FORCE_WORKER_ONLY) {
    setStatus('Worker-only mode');
    const ok = await probeWorker();
    if (ok) {
      const mod = await tryImport(WORKER_ORIGIN + '/app.mjs', 'worker-module');
      if (mod) {
        setStatus('Loaded module from Worker');
        window.pullMode = 'worker';
        try {
          const factory = mod.default;
          if (factory) {
            const Module = await factory();
            appendOut('Module.my_exported() -> ' + (Module.my_exported ? Module.my_exported() : 'no export'));
            window.AppModule = Module;
            window.__MODULE_LOADED__ = true;
            appendOut('JS module loaded — skipping any WASM attempts');
            return;
          } else appendOut('Worker module has no default factory');
        } catch (e) { appendOut('Worker factory error: ' + e); }
      }
    }
    appendOut('Worker-only mode failed to load module');
    setStatus('Worker-only failed');
    return;
  }

  // Normal flow: probe Worker first
  setStatus('Probing Worker');
  const workerReachable = await probeWorker();

  if (workerReachable) {
    setStatus('Worker reachable — trying to import from Worker');
    const mod = await tryImport(WORKER_ORIGIN + '/app.mjs', 'worker-module');
    if (mod) {
      setStatus('Loaded module from Worker');
      window.pullMode = 'worker';
      try {
        const factory = mod.default;
        if (factory) {
          const Module = await factory();
          appendOut('Module.my_exported() -> ' + (Module.my_exported ? Module.my_exported() : 'no export'));
          window.AppModule = Module;
          // NEW: mark module loaded and stop further WASM attempts
          window.__MODULE_LOADED__ = true;
          appendOut('JS module loaded — skipping any WASM attempts');
          return; // exit loader early, no WASM attempts
        } else appendOut('Worker module has no default factory');
      } catch (e) { appendOut('Worker factory error: ' + e); }
      appendOut('Import from Worker failed despite probe success — falling back');
    } else {
      appendOut('Import from Worker failed despite probe success — falling back');
    }
  } else {
    appendOut('Worker not reachable (probe failed) — falling back to Pages/CDN');
  }

  // Try same-origin Pages import (relative then absolute)
  setStatus('Trying Pages import (relative then absolute)');
  let mod = await tryImport('./app.mjs', 'local-relative');
  if (!mod) mod = await tryImport(PAGES_ORIGIN + '/app.mjs', 'pages-absolute');

  // Try CDN fallback if Pages failed
  if (!mod) {
    setStatus('Trying CDN fallback');
    mod = await tryImport(CDN_FALLBACK, 'jsdelivr');
  }

  if (!mod) {
    setStatus('All module import attempts failed');
    appendOut('All module import attempts failed — loader will not attempt WASM if JS module missing.');
    return;
  }

  // Initialize the JS module and stop further WASM attempts
  try {
    const factory = mod.default;
    if (factory && typeof factory === 'function') {
      setStatus('Initializing module factory');
      const Module = await factory();
      appendOut('Module initialized. my_exported() -> ' + (Module.my_exported ? Module.my_exported() : 'no my_exported'));
      window.AppModule = Module;
      // record which source succeeded
      window.pullMode = window.pullDiagnostics.success ? window.pullDiagnostics.success.step : 'module';

      // NEW: mark module loaded and stop further WASM attempts
      window.__MODULE_LOADED__ = true;
      appendOut('JS module loaded — skipping any WASM attempts');
      return; // important: exit the loader here
    } else {
      appendOut('Module imported but no default factory; exports: ' + Object.keys(mod || {}).join(','));
    }
  } catch (err) {
    appendOut('Module factory threw: ' + err);
    setStatus('Module factory error');
  }

  // If you still want to attempt WASM as a last resort, guard it so it never runs when JS module succeeded.
  if (window.__MODULE_LOADED__) {
    appendOut('Skipping WASM because JS module already loaded');
    return;
  }

  // Optional WASM attempt block (kept for completeness). It will only run if no JS module loaded.
  // Replace or remove this block if you do not want WASM attempts at all.
  try {
    setStatus('Attempting WASM fallback');
    // Example WASM URL (same origin)
    const wasmUrl = PAGES_ORIGIN + '/app.wasm';
    // instantiateStreaming if available
    if (WebAssembly.instantiateStreaming) {
      appendOut('instantiateStreaming -> ' + wasmUrl);
      const r = await fetch(wasmUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error('WASM fetch failed status ' + r.status);
      const { instance } = await WebAssembly.instantiateStreaming(r);
      appendOut('WASM instantiated via instantiateStreaming');
      window.AppWasm = instance;
    } else {
      appendOut('instantiateStreaming not available, trying raw fetch+instantiate');
      const buf = await (await fetch(wasmUrl, { cache: 'no-store' })).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(buf);
      appendOut('WASM instantiated via raw instantiate');
      window.AppWasm = instance;
    }
  } catch (e) {
    appendOut('WASM attempt failed: ' + e);
    setStatus('WASM fallback failed');
  }
})();
