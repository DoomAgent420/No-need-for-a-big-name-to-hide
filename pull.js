// pull.js — Worker-first but honest: probe Worker, import from best source, log everything
// Configure these for your project:
const WORKER_ORIGIN = "https://broad-meadow-a6f7.chrisjlove2022.workers.dev";
const PAGES_ORIGIN  = "https://chrisjlove2022.github.io/No-need-for-a-big-name-to-hide";
const CDN_FALLBACK   = "https://cdn.jsdelivr.net/gh/chrisjlove2022/No-need-for-a-big-name-to-hide@main/app.mjs";

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
  const probeUrl = WORKER_ORIGIN + '/ping'; // safe path; Worker should respond to simple fetch
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

  // 1) If forcing worker-only, probe and try worker import only
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
          } else appendOut('Worker module has no default factory');
        } catch (e) { appendOut('Worker factory error: ' + e); }
        return;
      }
    }
    appendOut('Worker-only mode failed to load module');
    setStatus('Worker-only failed');
    return;
  }

  // 2) Normal flow: probe Worker first, but don't assume failure until we've tried other sane sources
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
        } else appendOut('Worker module has no default factory');
      } catch (e) { appendOut('Worker factory error: ' + e); }
      return;
    } else {
      appendOut('Import from Worker failed despite probe success — falling back');
    }
  } else {
    appendOut('Worker not reachable (probe failed) — falling back to Pages/CDN');
  }

  // 3) Try same-origin Pages import (relative or absolute)
  setStatus('Trying Pages import (relative then absolute)');
  // try relative first (works when page and module are same origin)
  let mod = await tryImport('./app.mjs', 'local-relative');
  if (!mod) mod = await tryImport(PAGES_ORIGIN + '/app.mjs', 'pages-absolute');

  // 4) Try CDN fallback if Pages failed
  if (!mod) {
    setStatus('Trying CDN fallback');
    mod = await tryImport(CDN_FALLBACK, 'jsdelivr');
  }

  if (!mod) {
    setStatus('All module import attempts failed');
    appendOut('All module import attempts failed — loader will not attempt WASM if JS module missing.');
    // Optionally, you could attempt WASM here, but only if you want that behavior.
    return;
  }

  // 5) If we have a module, initialize it
  try {
    const factory = mod.default;
    if (factory && typeof factory === 'function') {
      setStatus('Initializing module factory');
      const Module = await factory();
      appendOut('Module initialized. my_exported() -> ' + (Module.my_exported ? Module.my_exported() : 'no my_exported'));
      window.AppModule = Module;
      // record which source succeeded
      window.pullMode = window.pullDiagnostics.success ? window.pullDiagnostics.success.step : 'module';
    } else {
      appendOut('Module imported but no default factory; exports: ' + Object.keys(mod || {}).join(','));
    }
  } catch (err) {
    appendOut('Module factory threw: ' + err);
    setStatus('Module factory error');
  }
})();
