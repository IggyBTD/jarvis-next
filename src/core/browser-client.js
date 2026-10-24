// The one place that talks to the browser sidecar (sidecars/browser/server.mjs). The app starts the sidecar
// through Tauri; in a plain browser tab it has to be running already (`npm run browser`).
import { serverMode, getSettings } from './server-link.js';

const PORT = 8766;
const BASE = `http://127.0.0.1:${PORT}`;
let ready = null;

export function ensureBrowser() {
  if (serverMode()) return Promise.resolve(); // the server drives the guarded browser of the active computer: no local sidecar to start
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
  if (serverMode()) {
    const res = await osintFetch('/browser/do', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`The server answered ${res.status}`);
    return res.json();
  }
  await ensureBrowser();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Browser sidecar answered ${res.status}`);
  return data;
}

export const openUrl = (url) => (serverMode() ? post('/browser/do', { type: 'navigate', url }) : post('/open', { url }));
export const doAction = (body) => (serverMode() ? post('/browser/do', body) : post('/do', body));
export async function health() {
  if (serverMode()) return { running: false };
  await ensureBrowser();
  return (await fetch(`${BASE}/health`)).json();
}
// The current page as an object URL (the caller revokes it); undefined when nothing changed since `since`; null when no page is open.
let frame = -1;
let serverTag = '';
export async function shot() {
  if (serverMode()) { // the active computer's browser, as a picture; unchanged pictures answer 304 and cost nothing
    const r = await osintFetch('/browser/shot', { headers: serverTag ? { 'if-none-match': serverTag } : {}, cache: 'no-store' });
    if (r.status === 304) return undefined;
    if (r.status !== 200) return null;
    serverTag = r.headers.get('etag') ?? '';
    return { src: URL.createObjectURL(await r.blob()), url: decodeURIComponent(r.headers.get('x-url') ?? ''), title: '' };
  }
  const res = await fetch(`${BASE}/shot?since=${frame}`, { cache: 'no-store' });
  if (res.status === 204) return res.headers.get('X-Open') === '0' ? null : undefined;
  if (!res.ok) return null;
  frame = Number(res.headers.get('X-Frame') ?? -1);
  return { src: URL.createObjectURL(await res.blob()), url: decodeURIComponent(res.headers.get('X-Url') ?? ''), title: decodeURIComponent(res.headers.get('X-Title') ?? '') };
}

// The globe's data. With the JARVIS server on, the server fetches it (OpenSky refuses browser pages, and the login stays on the
// PC), so a browser on the Mac gets the same feed; otherwise the old local sidecar does, as before.
async function osintFetch(path, init = {}) {
  if (serverMode()) {
    const s = getSettings();
    const base = s.url.trim().replace(/^ws/i, 'http').replace(/\/ws$/, '').replace(/\/+$/, '');
    return fetch(`${base}/api${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${s.token}` } });
  }
  await ensureBrowser();
  return fetch(`${BASE}${path}`, init);
}

// Aircraft for the OSINT map. `mine`: only the airlines in the watch list.
export async function aircraft(force = false, since = 0, mine = true) {
  const res = await osintFetch(`/osint/aircraft?since=${since}&mode=${mine ? 'watch' : 'all'}&watch=${mine ? 1 : 0}${force ? '&force=1' : ''}`);
  if (!res.ok) throw new Error(`Aircraft data: the ${serverMode() ? 'server' : 'sidecar'} answered ${res.status}`);
  return res.json();
}

export async function osintWatch() {
  return (await osintFetch('/osint/watch')).json();
}
export async function osintLoginStatus() {
  return (await osintFetch('/osint/opensky')).json();
}
// An OpenSky API client (id and secret). Empty strings remove the saved login.
export async function osintLogin(clientId, clientSecret) {
  const res = await osintFetch('/osint/opensky', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The sidecar answered ${res.status}`);
  return data;
}
