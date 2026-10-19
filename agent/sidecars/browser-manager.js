// Spawns the guarded Playwright service on 127.0.0.1 with a random token, restarts it with backoff, and proxies the agent's
// /browser/* routes to it. The browser profile is clean (no logins). The token never leaves this process.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { cleanEnv } from './opencode-manager.js';

export function createBrowserManager({ cfg, port = 4001, env = process.env, log = () => {}, spawnFn = spawn, script = path.join(cfg.root, 'sidecars', 'browser-guard', 'server.js'), extraEnv = {}, readyTimeoutMs = 20_000 }) {
  const events = new EventEmitter();
  const st = { running: false, error: null, restarts: 0 };
  const token = crypto.randomBytes(24).toString('hex');
  let child = null;
  let stopping = false;
  let failures = 0;
  const call = (method, p, body) => new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, timeout: 60_000 }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString() })); });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });

  async function start() {
    stopping = false;
    child = spawnFn(process.execPath, [script, '--port', String(port)], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], env: cleanEnv(env, { JARVIS_BROWSER_TOKEN: token, ...extraEnv }) });
    const me = child;
    me.on('exit', () => {
      if (child !== me) return;
      st.running = false;
      if (stopping) return;
      failures += 1;
      st.restarts += 1;
      setTimeout(() => start().catch(() => {}), Math.min(30_000, 1000 * 2 ** failures)).unref?.();
    });
    me.on('error', (e) => { st.error = e.message; });
    for (let i = 0; i < readyTimeoutMs / 250; i++) {
      try { if ((await call('GET', '/health')).status === 200) { st.running = true; st.error = null; failures = 0; return true; } } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    st.error = 'the browser service did not start';
    return false;
  }
  async function stop() { stopping = true; st.running = false; const c = child; child = null; try { await call('POST', '/close', {}); } catch { /* not running */ } c?.kill(); }

  function proxy(req, res, sub) {
    if (!st.running) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"the browser service is not running on this machine"}'); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      call(req.method, sub, body ? JSON.parse(body) : undefined).then((r) => { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(r.text); }).catch(() => { res.writeHead(502); res.end('{"error":"the browser service did not answer"}'); });
    });
    return undefined;
  }
  return { start, stop, proxy, events, status: () => ({ ...st }) };
}
