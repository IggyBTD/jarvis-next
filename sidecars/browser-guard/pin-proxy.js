// A local forward proxy for the guarded browser that pins DNS (F4-3). The guard checks a name before a request, but the browser
// would resolve it again, so a rebinding host could answer public to the check and private to the browser. With this proxy the
// browser never resolves a name: the proxy resolves it once, refuses it if any address is private, and connects to exactly the
// address it checked. Loopback only, with random Basic credentials per proxy.
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { isPrivateAddress } from './guard.js';

const HOP = ['proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade'];
const digest = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();

export async function createPinProxy({ resolve = (h) => dns.lookup(h, { all: true }), allowLoopback = false, log = () => {} } = {}) {
  const username = crypto.randomBytes(8).toString('hex');
  const password = crypto.randomBytes(16).toString('hex');
  const expected = digest(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  const authed = (req) => crypto.timingSafeEqual(digest(req.headers['proxy-authorization']), expected);
  const loop = (a) => allowLoopback && (a.startsWith('127.') || a === '::1');

  // Where to connect for this host: one lookup, every address checked, the first one used. Throws with the reason when refused.
  async function pick(rawHost) {
    const host = String(rawHost ?? '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!host) throw new Error('no host');
    if ((host === 'localhost' || host.endsWith('.localhost')) && !allowLoopback) throw new Error('local name');
    const addrs = net.isIP(host) ? [{ address: host }] : host === 'localhost' ? [{ address: '127.0.0.1' }] : await resolve(host).catch(() => []);
    if (!addrs.length) throw new Error('does not resolve');
    if (addrs.some((a) => isPrivateAddress(a.address) && !loop(a.address))) throw new Error('private or local address');
    return addrs[0].address;
  }
  const refuse = (host, e) => { log(`pin-proxy refused ${String(host).slice(0, 100)}: ${e.message}`); };

  const sockets = new Set();
  const track = (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => s.destroy()); return s; };
  const pipeBoth = (a, b) => { a.pipe(b); b.pipe(a); for (const s of [a, b]) s.on('close', () => { a.destroy(); b.destroy(); }); };
  const needAuth = 'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="jarvis"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';

  const server = http.createServer(async (req, res) => {
    if (!authed(req)) { res.writeHead(407, { 'proxy-authenticate': 'Basic realm="jarvis"' }); return res.end(); }
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400); return res.end('absolute http address required'); }
    if (u.protocol !== 'http:') { res.writeHead(400); return res.end('only http here; https goes through CONNECT'); }
    let address;
    try { address = await pick(u.hostname); } catch (e) { refuse(u.hostname, e); res.writeHead(403); return res.end('blocked'); }
    const headers = { ...req.headers };
    for (const h of HOP) delete headers[h];
    const up = http.request({ host: address, port: Number(u.port) || 80, method: req.method, path: `${u.pathname}${u.search}`, headers, setHost: false }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });

  server.on('connection', track);
  server.on('connect', async (req, client, head) => {
    if (!authed(req)) { client.end(needAuth); return; }
    const m = String(req.url ?? '').match(/^(\[[0-9a-fA-F:.]+\]|[^:[\]/]+):(\d{1,5})$/);
    const port = Number(m?.[2]);
    if (!m || port < 1 || port > 65535) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    let address;
    try { address = await pick(m[1]); } catch (e) { refuse(m[1], e); client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const up = track(net.connect({ host: address, port }));
    up.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); pipeBoth(client, up); });
    up.once('error', () => { if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  });
  server.on('upgrade', async (req, client, head) => {
    if (!authed(req)) { client.end(needAuth); return; }
    let u;
    try { u = new URL(req.url); } catch { client.destroy(); return; }
    let address;
    try { address = await pick(u.hostname); } catch (e) { refuse(u.hostname, e); client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const up = track(net.connect({ host: address, port: Number(u.port) || 80 }));
    up.once('connect', () => {
      const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) if (!/^proxy-/i.test(req.rawHeaders[i])) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      pipeBoth(client, up);
    });
    up.once('error', () => client.destroy());
  });

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    username,
    password,
    async close() { for (const s of sockets) s.destroy(); await new Promise((ok) => server.close(() => ok())); },
  };
}
