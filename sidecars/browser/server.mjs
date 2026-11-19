// JARVIS browser sidecar: one Chrome page driven by Playwright, on localhost.
//
//   GET  /health            { ok, running, url, title }
//   GET  /shot              the page as a JPEG (headers X-Url and X-Title, both URL-encoded)
//   POST /open  {url}       go to an http or https address
//   GET  /osint/aircraft    aircraft in the air, from OpenSky (fetched here because OpenSky's CORS rule refuses the app's own
//                           pages). ?watch=1 (default) keeps only the airlines in config/osint-watch.json. Anonymous: cached 15
//                           minutes (400 credits a day, the world costs 4). With an OpenSky API client saved: every 100 seconds
//                           (4000 credits a day). ?force=1 asks again, at most every 30 to 60 seconds.
//   GET  /osint/opensky     { configured, authed }: whether an OpenSky login is saved and accepted (the secret is never sent back)
//   POST /osint/opensky     {clientId, clientSecret} save the login (data/opensky.json, git-ignored); both empty removes it
//   GET  /osint/watch       the watch list file (airlines and companies)
//   POST /do    {type, ...} back | forward | reload | click {x, y} | clickText {text} | type {text}
//                           | press {key} | scroll {dy} | text | close
//
// The page runs in a fresh, empty profile (no cookies or logins from the user's own Chrome), headless,
// at 1280 x 800. Only http and https addresses are opened: never file:, chrome: or javascript:.
// Only pages of the app (and local scripts) may call it (the same origin rule as the voice sidecar).
//
// Run: node server.mjs [--parent-stdin] [--port 8766]   (--parent-stdin: exit when stdin closes, so it never outlives the app)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ORIGIN_RE = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/;
const originAllowed = (origin) => !origin || ORIGIN_RE.test(origin);
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8766;
const VIEW = { width: 1280, height: 800 };
const PROFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'browser-profile');
const MAX_TEXT = 12000;

if (args.includes('--parent-stdin')) {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
}

let browser = null;
let context = null;
let page = null;
let starting = null;
let latest = null; // the newest frame the page pushed (screencast): serving it costs nothing, a fresh screenshot costs half a second
let frameNo = 0;

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  starting ??= (async () => {
    // One profile folder for JARVIS's own browser: a site the user logs in to here stays logged in. It is not the user's Chrome profile.
    context ??= await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: true, args: ['--disable-gpu'], viewport: VIEW, acceptDownloads: false, serviceWorkers: 'block' }); // software rendering: no GPU memory
    browser = context.browser();
    page = context.pages()[0] ?? await context.newPage();
    latest = null;
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => { latest = Buffer.from(data, 'base64'); frameNo += 1; cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
    return page;
  })().finally(() => { starting = null; });
  return starting;
}

// Words that are not an address are a search. DuckDuckGo's plain page is used: Google refuses automated browsers with a captcha.
const looksLikeAddress = (t) => !/\s/.test(t) && (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[^./]+\.[^./]+/.test(t) || /^localhost(:\d+)?(\/|$)/i.test(t));
const safeUrl = (input) => {
  const text = input.trim();
  const raw = looksLikeAddress(text) ? text : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error('That is not a web address.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https addresses can be opened.');
  return u.href;
};

async function state() {
  if (!page || page.isClosed()) return { running: false, url: '', title: '' };
  return { running: true, url: page.url(), title: await page.title().catch(() => '') };
}

async function act(body) {
  const p = await ensurePage();
  switch (body.type) {
    case 'back': await p.goBack({ timeout: 15000 }).catch(() => {}); break;
    case 'forward': await p.goForward({ timeout: 15000 }).catch(() => {}); break;
    case 'reload': await p.reload({ timeout: 30000 }).catch(() => {}); break;
    case 'click': await p.mouse.click(Math.max(0, Math.min(VIEW.width, +body.x)), Math.max(0, Math.min(VIEW.height, +body.y))); break;
    case 'clickText': await p.getByText(String(body.text), { exact: false }).first().click({ timeout: 8000 }); break;
    case 'type': await p.keyboard.type(String(body.text), { delay: 12 }); break;
    case 'press': await p.keyboard.press(String(body.key)); break;
    case 'scroll': await p.mouse.wheel(0, +body.dy || 0); break;
    case 'text': {
      const text = await p.evaluate(() => document.body?.innerText ?? '');
      return { ...(await state()), text: text.replace(/\n{3,}/g, '\n\n').slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
    }
    case 'close': await context?.close().catch(() => {}); browser = null; context = null; page = null; return { running: false, url: '', title: '' };
    default: throw new Error(`Unknown action ${body.type}`);
  }
  await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  return state();
}

const readJson = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e5) { reject(new Error('Request too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Body is not JSON')); } });
});

// --- OSINT: aircraft ----------------------------------------------------------------
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPENSKY_API = process.env.OPENSKY_API_URL ?? 'https://opensky-network.org/api/states/all';
const OPENSKY_AUTH = process.env.OPENSKY_AUTH_URL ?? 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const DATA_DIR = path.join(ROOT, 'data');
const CRED_FILE = path.join(DATA_DIR, 'opensky.json');
const WATCH_FILE = path.join(ROOT, 'config', 'osint-watch.json');

const readJsonFile = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const readWatch = () => readJsonFile(WATCH_FILE, { airlines: [], companies: [] });

let creds = readJsonFile(CRED_FILE, null);
let token = { value: '', until: 0 };
let authed = false; // the saved login was accepted the last time it was used

// OpenSky's own API login: an OAuth2 client (id and secret from the free account page) is traded for a token that lasts 30 minutes.
async function bearer() {
  if (!creds?.clientId || !creds?.clientSecret) return '';
  if (token.value && Date.now() < token.until) return token.value;
  const res = await fetch(OPENSKY_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) { authed = false; throw new Error(res.status === 401 || res.status === 400 ? 'OpenSky refused the login (check the client id and secret)' : `OpenSky login answered ${res.status}`); }
  const body = await res.json();
  token = { value: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 1800) - 60) * 1000 };
  authed = true;
  return token.value;
}

let aircraft = { at: 0, time: 0, credits: null, list: [], error: '' };
async function loadAircraft(force) {
  const ttl = authed ? 100 * 1000 : 15 * 60 * 1000;
  const gap = authed ? 30 * 1000 : 60 * 1000;
  const age = Date.now() - aircraft.at;
  if (aircraft.list.length && ((age < ttl && !force) || age < gap)) return aircraft;
  try {
    let bear = '';
    try { bear = await bearer(); } catch (e) { aircraft = { ...aircraft, error: String(e.message) }; } // fall back to anonymous, and say why
    const res = await fetch(OPENSKY_API, { headers: bear ? { Authorization: `Bearer ${bear}` } : {}, signal: AbortSignal.timeout(25000) });
    if (res.status === 401 && bear) { token = { value: '', until: 0 }; authed = false; throw new Error('OpenSky refused the saved login'); }
    if (res.status === 429) throw new Error('OpenSky says the daily limit is used up');
    if (!res.ok) throw new Error(`OpenSky answered ${res.status}`);
    const body = await res.json();
    // [lat, lon, altitude m, track deg, icao24, callsign, country, speed m/s, seconds since the position was taken], airborne ones only
    const list = (body.states ?? []).filter((r) => r[6] != null && r[5] != null && !r[8]).map((r) => [r[6], r[5], Math.round(r[13] ?? r[7] ?? 0), Math.round(r[10] ?? 0), r[0], (r[1] ?? '').trim(), r[2], Math.round(r[9] ?? 0), Math.max(0, (body.time ?? 0) - (r[3] ?? body.time ?? 0))]);
    aircraft = { at: Date.now(), time: body.time, credits: Number(res.headers.get('x-rate-limit-remaining')) || null, list, error: aircraft.error && !authed && creds ? aircraft.error : '' };
  } catch (e) {
    aircraft = { ...aircraft, error: String(e?.message ?? e) }; // keep the old list on screen, say why it is old
  }
  return aircraft;
}

// The flights of the airlines in the watch list, each with its airline's name added at the end.
function watched(list, watch) {
  const rules = (watch.airlines ?? []).map((a) => ({ name: a.name, prefixes: a.prefixes ?? [] }));
  const out = [];
  for (const row of list) {
    const call = row[5];
    if (!call) continue;
    const hit = rules.find((r) => r.prefixes.some((p) => call.startsWith(p) && /^\d/.test(call.slice(p.length))));
    if (hit) out.push([...row, hit.name]);
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) { res.writeHead(403).end(); return; }
  const cors = { 'Access-Control-Allow-Origin': origin ?? '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'X-Url,X-Title,X-Frame,X-Open' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  const json = (code, obj) => res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && path === '/health') return json(200, { ok: true, ...(await state()) });
    if (req.method === 'GET' && path === '/shot') {
      if (!page || page.isClosed()) { res.writeHead(204, { ...cors, 'X-Open': '0' }).end(); return; } // 204, not an error: the viewer asks twice a second
      const since = Number(new URL(req.url, 'http://x').searchParams.get('since'));
      if (latest && since === frameNo) { res.writeHead(204, { ...cors, 'X-Open': '1', 'X-Frame': String(frameNo) }).end(); return; } // nothing new
      const jpeg = latest ?? await page.screenshot({ type: 'jpeg', quality: 70 });
      const s = await state();
      res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Frame': String(frameNo), 'X-Url': encodeURIComponent(s.url), 'X-Title': encodeURIComponent(s.title) }).end(jpeg);
      return;
    }
    if (req.method === 'GET' && path === '/osint/aircraft') {
      const q = new URL(req.url, 'http://x').searchParams;
      const a = await loadAircraft(q.get('force') === '1');
      const mine = q.get('watch') !== '0';
      const list = mine ? watched(a.list, readWatch()) : a.list;
      const head = { time: a.time, ageSec: Math.round((Date.now() - a.at) / 1000), credits: a.credits, error: a.error, count: list.length, total: a.list.length, authed, refreshSec: authed ? 100 : 900 };
      if (a.time && Number(q.get('since')) === a.time && q.get('mode') === (mine ? 'watch' : 'all')) return json(200, { ...head, unchanged: true }); // the page already has this list
      return json(200, { ...head, aircraft: list });
    }
    if (path === '/osint/opensky') {
      if (req.method === 'GET') return json(200, { configured: !!creds, authed });
      if (req.method === 'POST') {
        const { clientId = '', clientSecret = '' } = await readJson(req);
        const ok = (v) => typeof v === 'string' && v.length <= 200 && /^[\w@.\-~+=]*$/.test(v);
        if (!ok(clientId) || !ok(clientSecret)) return json(400, { error: 'That is not a client id and secret.' });
        token = { value: '', until: 0 };
        authed = false;
        if (!clientId && !clientSecret) { creds = null; fs.rmSync(CRED_FILE, { force: true }); return json(200, { configured: false, authed: false }); }
        creds = { clientId, clientSecret };
        try { await bearer(); } catch (e) { creds = null; return json(400, { error: String(e.message) }); } // only a login that works is kept
        fs.mkdirSync(DATA_DIR, { recursive: true }); // (`path` is the request's path in here, not the module)
        fs.writeFileSync(CRED_FILE, JSON.stringify(creds), { mode: 0o600 });
        aircraft.at = 0; // fetch with the login right away
        return json(200, { configured: true, authed });
      }
    }
    if (req.method === 'GET' && path === '/osint/watch') return json(200, readWatch());
    if (req.method === 'POST' && path === '/open') {
      const { url } = await readJson(req);
      const p = await ensurePage();
      await p.goto(safeUrl(String(url ?? '')), { waitUntil: 'domcontentloaded', timeout: 30000 });
      return json(200, await state());
    }
    if (req.method === 'POST' && path === '/do') return json(200, await act(await readJson(req)));
    return json(404, { error: 'Not found' });
  } catch (e) {
    return json(500, { error: String(e?.message ?? e).split('\n')[0] });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`browser sidecar on 127.0.0.1:${port}`));
const stop = async () => { await context?.close().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
