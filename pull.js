// pull.js — verbose Worker-first loader with robust WASM fallbacks
const workerOrigin = "https://broad-meadow-a6f7.chrisjlove2022.workers.dev";
const githubOrigin = "https://chrisjlove2022.github.io/No-need-for-a-big-name-to-hide";
const MODULE_PATH = "/app.mjs";
const WASM_PATH = "/app.wasm";
const HEAD_TIMEOUT = 4000;

function setStatus(s){ const e=document.getElementById('status'); if(e) e.textContent=s; }
function appendOut(s){ const e=document.getElementById('out'); if(e) e.textContent=(e.textContent?e.textContent+"\n":"")+s; console.log(s); }

async function headWithTimeout(url, t=HEAD_TIMEOUT){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), t);
  try {
    const r = await fetch(url, { method:'HEAD', mode:'cors', signal: ctrl.signal });
    clearTimeout(id);
    return r;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchHeaders(url){
  try {
    const r = await fetch(url, { method:'HEAD', mode:'cors' });
    return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers.entries()) };
  } catch (e) {
    return { ok:false, error: String(e) };
  }
}

async function tryImport(origin){
  const url = origin.replace(/\/$/,'') + MODULE_PATH;
  appendOut(`import() -> ${url}`);
  try {
    const mod = await import(url);
    appendOut('import() succeeded');
    return { mod };
  } catch (e) {
    appendOut('import() failed: ' + e);
    throw e;
  }
}

async function tryInstantiateStreaming(origin){
  const url = origin.replace(/\/$/,'') + WASM_PATH;
  appendOut('instantiateStreaming -> ' + url);
  try {
    if (!WebAssembly.instantiateStreaming) throw new Error('instantiateStreaming not supported');
    const resp = await fetch(url, { mode:'cors' });
    appendOut('wasm HEAD ok: ' + resp.status + ' content-type:' + resp.headers.get('content-type'));
    const res = await WebAssembly.instantiateStreaming(resp, {});
    appendOut('instantiateStreaming succeeded');
    return res;
  } catch (e) {
    appendOut('instantiateStreaming failed: ' + e);
    throw e;
  }
}

async function tryRawInstantiate(origin){
  const url = origin.replace(/\/$/,'') + WASM_PATH;
  appendOut('raw fetch+instantiate -> ' + url);
  try {
    const resp = await fetch(url, { mode:'cors' });
    if (!resp.ok) throw new Error('WASM fetch failed status ' + resp.status);
    const buf = await resp.arrayBuffer();
    const res = await WebAssembly.instantiate(buf, {});
    appendOut('raw instantiate succeeded');
    return res;
  } catch (e) {
    appendOut('raw instantiate failed: ' + e);
    throw e;
  }
}

(async function main(){
  setStatus('Detecting Worker');
  appendOut('Starting Worker-first detection');
  let origin = workerOrigin;
  // quick HEAD check
  try {
    const headUrl = workerOrigin.replace(/\/$/,'') + MODULE_PATH;
    const head = await headWithTimeout(headUrl);
    appendOut('Worker HEAD status: ' + head.status);
    if (!head.ok) throw new Error('Worker HEAD non-ok');
    const headers = Object.fromEntries(head.headers.entries());
    appendOut('Worker headers: ' + JSON.stringify(headers));
    setStatus('Worker reachable — attempting import');
  } catch (err) {
    appendOut('Worker unreachable: ' + err);
    origin = githubOrigin;
    setStatus('Falling back to GitHub');
  }

  // try import from chosen origin
  try {
    const { mod } = await tryImport(origin);
    // call default factory if present
    if (mod && typeof mod.default === 'function') {
      setStatus('Initializing module factory');
      await mod.default();
      setStatus('WASM Ready via import');
      appendOut('Loaded module from ' + origin);
      window.pullMode = origin.includes('workers.dev') ? 'worker' : 'github';
      return;
    } else {
      appendOut('Module imported but no default factory found; exports: ' + Object.keys(mod || {}).join(','));
      setStatus('Module imported');
      window.pullMode = origin.includes('workers.dev') ? 'worker' : 'github';
      return;
    }
  } catch (importErr) {
    appendOut('Import failed from ' + origin + ': ' + importErr);
    // if we tried worker first, try GitHub import next
    if (origin === workerOrigin) {
      appendOut('Retrying import from GitHub');
      origin = githubOrigin;
      try {
        const { mod } = await tryImport(origin);
        if (mod && typeof mod.default === 'function') {
          await mod.default();
          setStatus('WASM Ready via GitHub import');
          appendOut('Loaded module from GitHub');
          window.pullMode = 'github';
          return;
        }
      } catch (e2) {
        appendOut('GitHub import also failed: ' + e2);
      }
    }
  }

  // instantiateStreaming fallback
  try {
    await tryInstantiateStreaming(origin);
    setStatus('WASM Ready via instantiateStreaming');
    window.pullMode = origin.includes('workers.dev') ? 'worker' : 'github';
    return;
  } catch (e) {
    appendOut('instantiateStreaming failed for ' + origin);
  }

  // raw instantiate fallback
  try {
    await tryRawInstantiate(origin);
    setStatus('WASM Ready via raw instantiate');
    window.pullMode = origin.includes('workers.dev') ? 'worker' : 'github';
    return;
  } catch (e) {
    appendOut('raw instantiate failed for ' + origin);
  }

  // final attempt: if we used GitHub, try worker raw instantiate once more (may fail due to cert)
  if (origin === githubOrigin) {
    appendOut('Final attempt: try Worker raw instantiate');
    try {
      await tryRawInstantiate(workerOrigin);
      setStatus('WASM Ready via Worker raw instantiate');
      window.pullMode = 'worker';
      return;
    } catch (finalErr) {
      appendOut('Final attempt failed: ' + finalErr);
    }
  }

  setStatus('All WASM load attempts failed — check console and headers');
})();
