// HTTP side of the server. Every route needs a bearer token (UI, machine or model token, per route); /v1 is the authenticated
// OpenAI-compatible proxy for OpenCode. Browser pages may call the REST routes only from the configured origins.
import fs from 'node:fs';
import path from 'node:path';
import { ipAllowed } from '../../shared/net.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.map': 'application/json' };

// The built app (dist/) is served to browsers, so a Mac needs nothing installed: open the server's address. It holds no secrets
// (the token is typed in or passed in the #fragment, which a browser never sends); every data route below still needs a token.
function serveStatic(req, res, root, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.includes('\0') || rel.split(/[\\/]/).includes('..')) { res.writeHead(400); return res.end(); }
  let file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(400); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(503, { 'content-type': 'text/plain' }); return res.end('The app is not built yet: run npm run build on the PC.'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'microphone=(self), camera=(), geolocation=()' });
  return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
}

const json = (res, status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };

export function createHealth({ llm, queue, router, machines, contextLength = null, ttlMs = 4000, now = Date.now }) {
  let cached = null;
  return async function health({ fresh = false } = {}) {
    if (!fresh && cached && now() - cached.at < ttlMs) return cached.value;
    const ids = Object.keys(machines);
    const [model, ...agents] = await Promise.all([llm.health(), ...ids.map((id) => router.health(id).then((h) => ({ online: h?.ok === true, os: h?.os ?? machines[id].os, sidecars: h?.sidecars ?? {} })).catch(() => ({ online: false, os: machines[id].os, sidecars: {} })))]);
    const last = llm.lastStats?.() ?? null;
    const value = { model: { reachable: model.reachable, modelId: model.modelId ?? null, modelPresent: model.modelPresent ?? false, error: model.error ?? null, contextLength: contextLength ?? null }, last: last ? { tokensPerSec: last.tokensPerSec, promptTokens: last.promptTokens, completionTokens: last.completionTokens, ttftMs: last.ttftMs } : null, queueDepth: queue.depth(), tokensPerSec: model.tokensPerSec, machines: Object.fromEntries(ids.map((id, i) => [id, { label: machines[id].label, ...agents[i] }])), ts: now() };
    cached = { at: now(), value };
    return value;
  };
}

const readBody = (req) => new Promise((resolve, reject) => { const c = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > 20_000) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else c.push(d); }); req.on('end', () => { try { resolve(c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('body must be JSON'), { status: 400 })); } }); req.on('error', reject); });

export function createHttpHandler({ cfg, auth, llmProxy, health, audit, conversations, digest, osint, browserView, bundle, latex, buildState, log = () => {} }) {
  const origins = cfg.machines.server.origins ?? [];
  return async function handle(req, res) {
    try {
      const ip = req.socket.remoteAddress;
      const origin = req.headers.origin;
      const sameOrigin = !!origin && (origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`); // https when reached through tailscale serve
      const cors = origin && (sameOrigin || origins.includes(origin)) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
      if (req.method === 'OPTIONS') {
        if (!cors['access-control-allow-origin']) return json(res, 403, { error: 'origin not allowed' });
        res.writeHead(204, { ...cors, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE', 'access-control-max-age': '600' });
        return res.end();
      }
      if (origin && !cors['access-control-allow-origin']) return json(res, 403, { error: 'origin not allowed' });

      const url = new URL(req.url, 'http://server');
      const p = url.pathname;
      if ((req.method === 'GET' || req.method === 'HEAD') && !/^\/(api|v1|health|ws)(\/|$)/.test(p)) return serveStatic(req, res, path.join(cfg.root, 'dist'), p);
      const need = p.startsWith('/v1/') || p === '/v1' ? ['machine', 'model'] : ['ui', 'machine'];
      const verdict = auth.check(req.headers.authorization, { roles: need, ip });
      if (!verdict.ok) return json(res, verdict.status, { error: verdict.status === 429 ? 'too many attempts' : verdict.status === 403 ? 'this token cannot use this route' : 'unauthorized' }, cors);

      if (need.includes('model') && (p.startsWith('/v1/') || p === '/v1')) return llmProxy.handle(req, res, verdict.principal);
      if (req.method === 'GET' && p === '/health') return json(res, 200, await health({ fresh: url.searchParams.get('fresh') === '1' }), cors);
      if (bundle && p === '/api/bundle' && req.method === 'GET' && ['machine', 'ui'].includes(verdict.principal.role)) { // a machine updates itself from here; the bundle holds code and config, never tokens
        const zip = await bundle();
        res.writeHead(200, { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-length': zip.length });
        return res.end(zip);
      }
      if (verdict.principal.role !== 'ui') return json(res, 403, { error: 'this token cannot use this route' }, cors);
      if (req.method === 'GET' && p === '/api/state') return json(res, 200, await buildState(), cors);
      if (req.method === 'GET' && p === '/api/audit') return json(res, 200, { entries: audit.tail(Math.min(200, Number(url.searchParams.get('n')) || 50)), verify: url.searchParams.get('verify') === '1' ? audit.verify() : undefined }, cors);
      if (osint && p === '/api/osint/aircraft' && req.method === 'GET') { const q = url.searchParams; return json(res, 200, await osint.aircraft({ force: q.get('force') === '1', since: q.get('since') ?? 0, mine: q.get('watch') !== '0' }), cors); }
      if (osint && p === '/api/osint/watch' && req.method === 'GET') return json(res, 200, osint.watch(), cors);
      if (osint && p === '/api/osint/opensky') {
        if (req.method === 'GET') return json(res, 200, osint.status(), cors);
        if (req.method === 'POST') { const b = await readBody(req); try { return json(res, 200, await osint.login(b.clientId, b.clientSecret), cors); } catch (e) { return json(res, e.status ?? 500, { error: e.message }, cors); } }
      }
      if (browserView && p === '/api/browser/shot' && req.method === 'GET') {
        const s = await browserView.shot(req.headers['if-none-match']);
        if (!s) { res.writeHead(204, cors); return res.end(); }
        if (s.unchanged) { res.writeHead(304, { ...cors, etag: s.etag }); return res.end(); }
        res.writeHead(200, { ...cors, 'content-type': 'image/jpeg', 'cache-control': 'no-store', etag: s.etag, 'x-url': encodeURIComponent(s.url ?? ''), 'x-target': s.target, 'access-control-expose-headers': 'x-url, x-target, etag' });
        return res.end(s.jpeg);
      }
      if (latex && p === '/api/latex' && req.method === 'POST') { try { return json(res, 200, await latex(String((await readBody(req)).text ?? '').slice(0, 500)), cors); } catch (e) { return json(res, e.status ?? 502, { error: 'the model could not be reached' }, cors); } }
      if (browserView && p === '/api/browser/do' && req.method === 'POST') return json(res, 200, await browserView.act(await readBody(req)), cors);
      if (req.method === 'GET' && p === '/api/conversations') return json(res, 200, { conversations: conversations.list() }, cors);
      const one = p.match(/^\/api\/conversations\/([\w-]{1,64})$/);
      if (one) {
        const c = conversations.get(one[1]);
        if (!c) return json(res, 404, { error: 'no such conversation' }, cors);
        if (req.method === 'GET') return json(res, 200, { id: c.id, title: c.title, pinned: !!c.pinned, messages: conversations.transcript(c) }, cors);
        if (req.method === 'PATCH') { conversations.patch(c.id, await readBody(req)); return json(res, 200, { ok: true }, cors); }
        if (req.method === 'DELETE') { conversations.remove(c.id); return json(res, 200, { ok: true }, cors); }
      }
      if (req.method === 'GET' && p === '/api/digest') {
        const date = url.searchParams.get('date');
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'date must be YYYY-MM-DD' }, cors);
        return json(res, 200, digest?.get(date ?? undefined) ?? { error: 'no digest yet' }, cors);
      }
      return json(res, 404, { error: 'not found' }, cors);
    } catch (e) {
      log(`http error: ${e.stack ?? e}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' }); else res.destroy();
    }
  };
}

export { ipAllowed };
