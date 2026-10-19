// Guarded Playwright service, local HTTP only (127.0.0.1, bearer token from JARVIS_BROWSER_TOKEN). DOM first: navigate, click,
// type, press, read, screenshot, back, close. The sidecar enforces the rules itself (guard.js): private networks are blocked for
// every request the page makes, password and payment fields are never typed into, anything that would submit/pay/send/delete
// needs a single-use confirmation bound to the element and the page address, typing asks once per site, and a CAPTCHA pauses
// everything until the user says done. It never solves or bypasses one.
//   node sidecars/browser-guard/server.js --port 4001 [--headed]
import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { checkUrl, isSubmitLike, isSensitiveField, looksLikeCaptcha } from './guard.js';
import { safeEqual, isMain } from '../../shared/util.js';

const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Space']);
const MAX_TEXT = 8000;

export function createBrowserService({ token, policy, headed = false, allowLoopback = false, launch = () => chromium.launch({ headless: !headed, channel: process.env.JARVIS_BROWSER_CHANNEL || undefined }).catch(() => chromium.launch({ headless: !headed })), now = Date.now }) {
  let browser = null;
  let context = null;
  let page = null;
  let paused = false;
  const typedSites = new Set();
  const challenges = new Map();
  const hostCache = new Map();
  const opts = { allow: policy.allowDomains, deny: policy.denyDomains, allowLoopback };

  async function ensure() {
    if (page && !page.isClosed()) return page;
    browser ??= await launch();
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', permissions: [], viewport: { width: 1280, height: 800 } });
    // Every request the page makes, redirects and subresources included, is checked; a blocked one is aborted.
    // ponytail: DNS is resolved again by the browser after this check, so a rebinding host could slip between them; pin through a proxy if that threat matters.
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (/^(data|blob|about):/.test(url)) return route.continue();
      const host = (() => { try { return new URL(url).host; } catch { return url; } })();
      let v = hostCache.get(host);
      if (!v || now() - v.at > 30_000) { v = { at: now(), r: await checkUrl(url, opts) }; hostCache.set(host, v); }
      return v.r.ok ? route.continue() : route.abort('blockedbyclient');
    });
    page = await context.newPage();
    return page;
  }

  const shot = async (p) => (await p.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');

  async function describe(loc) {
    return loc.first().evaluate((el) => ({
      tag: el.tagName.toLowerCase(), type: el.getAttribute('type') ?? '', role: el.getAttribute('role') ?? '', name: el.getAttribute('name') ?? '', id: el.id ?? '',
      autocomplete: el.getAttribute('autocomplete') ?? '', placeholder: el.getAttribute('placeholder') ?? '', ariaLabel: el.getAttribute('aria-label') ?? '',
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 120), insideForm: !!el.closest('form'),
    }));
  }
  const locate = (p, { selector, text }) => (selector ? p.locator(selector) : p.getByText(String(text), { exact: false }));
  const label = (d) => `${d.tag}${d.type ? `[type=${d.type}]` : ''} "${d.text}"`.trim();

  async function challenge(p, kind, element, reason, action) {
    const id = crypto.randomBytes(12).toString('hex');
    const c = { id, kind, element, url: p.url(), expires: now() + 120_000, action };
    challenges.set(id, c);
    return { status: 'needs_approval', id, kind, element, url: c.url, reason, screenshot: await shot(p) };
  }
  const captcha = async (p) => {
    const text = await p.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (looksLikeCaptcha({ frameUrls: p.frames().map((f) => f.url()), text })) { paused = true; return { status: 'captcha', message: 'A CAPTCHA or bot check is showing. Ask the user to solve it in the browser window, then call resume.' }; }
    return null;
  };
  const done = async (p) => (await captcha(p)) ?? { status: 'ok', url: p.url(), title: await p.title().catch(() => '') };

  const actions = {
    async navigate({ url }) {
      const v = await checkUrl(String(url ?? ''), opts);
      if (!v.ok) return { status: 'refused', reason: v.reason };
      const p = await ensure();
      if (v.ask) return challenge(p, 'navigate', url.slice(0, 200), v.ask, async () => { await p.goto(url, { timeout: 30_000 }); return done(p); });
      await p.goto(url, { timeout: 30_000 });
      return done(p);
    },
    async click(args) {
      const p = await ensure();
      const loc = locate(p, args);
      if (!(await loc.count())) return { status: 'error', reason: 'no such element' };
      const d = await describe(loc);
      const act = async () => { await loc.first().click({ timeout: 10_000 }); await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}); return done(p); };
      if (isSubmitLike({ ...d, patterns: policy.submitPatterns })) return challenge(p, 'submit', label(d), 'this would submit, pay, send, delete or confirm', act);
      return act();
    },
    async type({ selector, text }) {
      const p = await ensure();
      if (typeof text !== 'string' || text.length > 500) return { status: 'refused', reason: 'text must be a string of at most 500 characters' };
      const loc = p.locator(selector);
      if (!(await loc.count())) return { status: 'error', reason: 'no such element' };
      const d = await describe(loc);
      if (isSensitiveField(d)) return { status: 'refused', reason: 'password and payment fields are never typed into by JARVIS' };
      if (!['input', 'textarea'].includes(d.tag) && !(await loc.first().evaluate((el) => el.isContentEditable))) return { status: 'refused', reason: 'that element does not take text' };
      const site = new URL(p.url()).host;
      const act = async () => { await loc.first().fill(text, { timeout: 10_000 }); typedSites.add(site); return { status: 'ok', typedInto: label(d) }; };
      return typedSites.has(site) ? act() : challenge(p, 'type', label(d), `first time typing on ${site}`, act);
    },
    async press({ key }) {
      const p = await ensure();
      if (!KEYS.has(key)) return { status: 'refused', reason: 'key not allowed' };
      const act = async () => { await p.keyboard.press(key); await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}); return done(p); };
      if (key === 'Enter') {
        const d = await p.evaluate(() => { const el = document.activeElement; return el && el !== document.body ? { tag: el.tagName.toLowerCase(), type: el.getAttribute('type') ?? '', text: (el.innerText || el.value || '').slice(0, 120), insideForm: !!el.closest('form') } : null; });
        if (d && (d.insideForm || isSubmitLike({ ...d, patterns: policy.submitPatterns }))) return challenge(p, 'submit', `Enter in ${label(d)}`, 'Enter may submit a form', act);
      }
      return act();
    },
    async read() {
      const p = await ensure();
      if (paused) return { status: 'captcha', message: 'Paused for a CAPTCHA.' };
      const text = (await p.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, MAX_TEXT);
      const tree = (await p.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '')).slice(0, MAX_TEXT);
      return { status: 'ok', url: p.url(), title: await p.title().catch(() => ''), text, tree };
    },
    async screenshot() { const p = await ensure(); return { status: 'ok', jpeg: await shot(p) }; },
    async back() { const p = await ensure(); await p.goBack({ timeout: 10_000 }).catch(() => null); return done(p); },
    async close() { await context?.close().catch(() => {}); page = null; context = null; typedSites.clear(); challenges.clear(); return { status: 'ok' }; },
    async resume() { paused = false; const p = await ensure(); return done(p); },
    // Runs a stored action once, only if it is the same element on the same page and has not expired.
    async confirm({ id }) {
      const c = challenges.get(id);
      challenges.delete(id);
      if (!c || c.expires < now()) return { status: 'refused', reason: 'unknown, used or expired confirmation' };
      const p = await ensure();
      if (c.kind !== 'navigate' && p.url() !== c.url) return { status: 'refused', reason: 'the page changed since the confirmation was asked for' };
      return c.action();
    },
  };

  async function handle(name, args) {
    if (paused && !['resume', 'close', 'read'].includes(name)) return { status: 'captcha', message: 'Paused for a CAPTCHA. Ask the user to solve it, then resume.' };
    return actions[name](args ?? {});
  }
  return { handle, names: Object.keys(actions), state: () => ({ running: !!page && !page.isClosed(), url: page && !page.isClosed() ? page.url() : null, paused }), async stop() { await context?.close().catch(() => {}); await browser?.close().catch(() => {}); browser = null; page = null; } };
}

export function createBrowserServer({ token, service }) {
  return http.createServer((req, res) => {
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!safeEqual(String(req.headers.authorization ?? ''), `Bearer ${token}`)) return send(401, { error: 'unauthorized' });
    if (req.headers.origin) return send(403, { error: 'no browsers' });
    const name = new URL(req.url, 'http://x').pathname.slice(1);
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); if (Buffer.concat(chunks).length > 100_000) req.destroy(); });
    req.on('end', async () => {
      if (name === 'health' || name === 'state') return send(200, service.state());
      if (!service.names.includes(name) || (req.method !== 'POST' && name !== 'read' && name !== 'screenshot')) return send(404, { error: 'not found' });
      let body = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return send(400, { error: 'body must be JSON' }); }
      try { send(200, await service.handle(name, body)); } catch (e) { send(200, { status: 'error', reason: String(e.message).slice(0, 300) }); }
    });
  });
}

if (isMain(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
  const { loadConfig } = await import('../../server/core/config.js');
  const policy = loadConfig({ only: ['policy.json'] }).policy.browser;
  const token = process.env.JARVIS_BROWSER_TOKEN;
  if (!token) { console.error('JARVIS_BROWSER_TOKEN is required'); process.exit(1); }
  const service = createBrowserService({ token, policy, headed: process.argv.includes('--headed') });
  const server = createBrowserServer({ token, service });
  server.listen(Number(arg('--port') ?? 4001), '127.0.0.1');
  const stop = async () => { await service.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  process.stdin.resume(); process.stdin.on('close', stop); // exit when the agent goes away
}
