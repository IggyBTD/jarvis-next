// JARVIS browser sidecar: one Chrome page driven by Playwright, on localhost.
//
//   GET  /health            { ok, running, url, title }
//   GET  /shot              the page as a JPEG (headers X-Url and X-Title, both URL-encoded)
//   POST /open  {url}       go to an http or https address
//   POST /do    {type, ...} back | forward | reload | click {x, y} | clickText {text} | type {text}
//                           | press {key} | scroll {dy} | text | close
//
// The page runs in a fresh, empty profile (no cookies or logins from the user's own Chrome), headless,
// at 1280 x 800. Only http and https addresses are opened: never file:, chrome: or javascript:.
// Only pages of the app (and local scripts) may call it (the same origin rule as the voice sidecar).
//
// Run: node server.mjs [--parent-stdin] [--port 8766]   (--parent-stdin: exit when stdin closes, so it never outlives the app)
import http from 'node:http';
import { chromium } from 'playwright';

const ORIGIN_RE = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/;
const originAllowed = (origin) => !origin || ORIGIN_RE.test(origin);
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8766;
const VIEW = { width: 1280, height: 800 };
const MAX_TEXT = 12000;

if (args.includes('--parent-stdin')) {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
}

let browser = null;
let page = null;
let starting = null;

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  starting ??= (async () => {
    browser ??= await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] }); // software rendering: no GPU memory
    const context = await browser.newContext({ viewport: VIEW, acceptDownloads: false, serviceWorkers: 'block' });
    page = await context.newPage();
    return page;
  })().finally(() => { starting = null; });
  return starting;
}

const safeUrl = (raw) => {
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error('That is not a web address.'); }
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
    case 'close': await browser?.close().catch(() => {}); browser = null; page = null; return { running: false, url: '', title: '' };
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

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) { res.writeHead(403).end(); return; }
  const cors = { 'Access-Control-Allow-Origin': origin ?? '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'X-Url,X-Title' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  const json = (code, obj) => res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && path === '/health') return json(200, { ok: true, ...(await state()) });
    if (req.method === 'GET' && path === '/shot') {
      if (!page || page.isClosed()) return json(409, { error: 'No page is open.' });
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 72 });
      const s = await state();
      res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Url': encodeURIComponent(s.url), 'X-Title': encodeURIComponent(s.title) }).end(jpeg);
      return;
    }
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
const stop = async () => { await browser?.close().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
