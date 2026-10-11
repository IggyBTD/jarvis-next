// The one place that talks to the browser sidecar (sidecars/browser/server.mjs). The app starts the sidecar
// through Tauri; in a plain browser tab it has to be running already (`npm run browser`).
const PORT = 8766;
const BASE = `http://127.0.0.1:${PORT}`;
let ready = null;

export function ensureBrowser() {
  ready ??= (async () => {
    if (window.__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('browser_start');
    }
    for (let i = 0; i < 40; i += 1) {
      try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('The browser sidecar did not start. Is Node.js installed? In a plain browser tab run: npm run browser');
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

async function post(path, body) {
  await ensureBrowser();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Browser sidecar answered ${res.status}`);
  return data;
}

export const openUrl = (url) => post('/open', { url });
export const doAction = (body) => post('/do', body);
export async function health() {
  await ensureBrowser();
  return (await fetch(`${BASE}/health`)).json();
}
// The current page as an object URL (the caller revokes it); undefined when nothing changed since `since`; null when no page is open.
let frame = -1;
export async function shot() {
  const res = await fetch(`${BASE}/shot?since=${frame}`, { cache: 'no-store' });
  if (res.status === 204) return res.headers.get('X-Open') === '0' ? null : undefined;
  if (!res.ok) return null;
  frame = Number(res.headers.get('X-Frame') ?? -1);
  return { src: URL.createObjectURL(await res.blob()), url: decodeURIComponent(res.headers.get('X-Url') ?? ''), title: decodeURIComponent(res.headers.get('X-Title') ?? '') };
}

// Aircraft for the OSINT map (the sidecar asks OpenSky and caches the answer). `mine`: only the airlines in the watch list.
export async function aircraft(force = false, since = 0, mine = true) {
  await ensureBrowser();
  const res = await fetch(`${BASE}/osint/aircraft?since=${since}&mode=${mine ? 'watch' : 'all'}&watch=${mine ? 1 : 0}${force ? '&force=1' : ''}`);
  if (!res.ok) throw new Error(`Aircraft data: the sidecar answered ${res.status}`);
  return res.json();
}

export async function osintWatch() {
  await ensureBrowser();
  return (await fetch(`${BASE}/osint/watch`)).json();
}
export async function osintLoginStatus() {
  await ensureBrowser();
  return (await fetch(`${BASE}/osint/opensky`)).json();
}
// An OpenSky API client (id and secret). Empty strings remove the saved login.
export async function osintLogin(clientId, clientSecret) {
  await ensureBrowser();
  const res = await fetch(`${BASE}/osint/opensky`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The sidecar answered ${res.status}`);
  return data;
}
