// The agent: runs on every machine, executes registry actions and hosts the OpenCode and browser sidecars. Only the JARVIS
// server may call it: bearer token of this machine, caller address on the allowlist, no browser Origin, rate limit on failures.
//   GET /health  GET /info  GET /actions  POST /action/:name {args, dryRun}  GET /events (SSE)  /opencode/*  /browser/*
// Start: node agent/index.js [--machine pc|mac]   (default: the machine whose os matches this computer)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, tokenPath, dataPath } from '../server/core/config.js';
import { createAuth, loadTokens, createLimiter } from '../server/core/auth.js';
import { createRegistry } from './registry/mod.js';
import { getInfo } from './info.js';
import { ipAllowed, isLoopback, resolveBind } from '../shared/net.js';
import { installProcessGuards, isMain } from '../shared/util.js';

const MAX_BODY = 1024 * 1024;
const SHELL_ROUTE = /(^|\/)session\/[^/]+\/shell(\/|$)/i;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!size) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('body must be JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const send = (res, status, obj) => { if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

/**
 * sidecars: { opencode?, browser? } each { status(), proxy(req, res, subpath), events? (EventEmitter emitting 'event') }.
 */
export function createAgent({ cfg, machineId, registry, sidecars = {}, tokens, log = () => {}, version = '1' }) {
  const machine = cfg.machines.machines[machineId];
  const auth = createAuth({ tokens, limiter: createLimiter(), reload: () => loadTokens(cfg) });
  let lastReload = Date.now();
  const sseClients = new Set();
  const started = Date.now();
  let info = null;

  // Relay sidecar events (OpenCode permission requests, task events) to whoever is listening on /events.
  for (const [name, sc] of Object.entries(sidecars)) {
    sc.events?.on?.('event', (e) => { const line = `data: ${JSON.stringify({ sidecar: name, ...e })}\n\n`; for (const r of sseClients) r.write(line); });
  }

  async function handle(req, res) {
    try {
      const ip = req.socket.remoteAddress;
      if (!ipAllowed(ip, machine.allowedCallers ?? [])) return send(res, 403, { error: 'caller address not allowed' });
      if (req.headers.origin) return send(res, 403, { error: 'browsers are not allowed here' });
      if (Date.now() - lastReload > 30_000) { auth.reload(); lastReload = Date.now(); }
      const verdict = auth.check(req.headers.authorization, { roles: ['machine'], ip });
      if (!verdict.ok) return send(res, verdict.status, { error: verdict.status === 429 ? 'too many attempts' : 'unauthorized' });
      if (verdict.principal.machine !== machineId) return send(res, 403, { error: 'token belongs to another machine' });

      const url = new URL(req.url, 'http://agent');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/health') {
        return send(res, 200, { ok: true, machine: machineId, os: registry.ctx.os, version, uptimeSeconds: Math.round((Date.now() - started) / 1000), sidecars: Object.fromEntries(Object.entries(sidecars).map(([k, v]) => [k, v.status?.() ?? {}])) });
      }
      if (req.method === 'GET' && p === '/info') { info = await getInfo({ machine: { ...machine, workspaceDir: registry.ctx.workspaceDir }, jarvisDirs: [cfg.root, cfg.dataDir].filter(Boolean) }); registry.ctx.facts = info; return send(res, 200, info); }
      if (req.method === 'GET' && p === '/actions') return send(res, 200, { actions: registry.list(), missing: registry.missing() });
      const act = p.match(/^\/action\/([a-z][a-z0-9_]*)$/);
      if (req.method === 'POST' && act) {
        const body = await readJson(req);
        return send(res, 200, await registry.execute(act[1], { args: body.args ?? {}, dryRun: body.dryRun === true }));
      }
      if (req.method === 'GET' && p === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(': connected\n\n');
        sseClients.add(res);
        const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
        beat.unref?.();
        res.on('close', () => { clearInterval(beat); sseClients.delete(res); });
        return undefined;
      }
      const side = p.match(/^\/(opencode|browser|claude)(\/.*)?$/);
      if (side) {
        const sub = decodeURIComponent(side[2] ?? '/');
        if (SHELL_ROUTE.test(sub) || SHELL_ROUTE.test(side[2] ?? '')) return send(res, 403, { error: 'this route is never proxied' });
        const sc = sidecars[side[1]];
        if (!sc?.proxy) return send(res, 503, { error: `${side[1]} is not running on this machine` });
        return sc.proxy(req, res, sub + url.search);
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      log(`agent error: ${e.stack ?? e}`);
      return send(res, e.status ?? 500, { error: e.status ? e.message : 'internal error' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.requestTimeout = 0; // SSE and proxied streams are long
  return {
    server,
    listen: (port, host) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address())); }),
    close: () => new Promise((resolve) => { for (const r of sseClients) r.end(); registry.stopBackground(); server.closeAllConnections?.(); server.close(resolve); }),
  };
}

if (isMain(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
  const cfg = loadConfig();
  const machineId = arg('--machine') ?? (process.platform === 'darwin' ? 'mac' : 'pc');
  const machine = cfg.machines.machines[machineId];
  if (!machine) { console.error(`Unknown machine "${machineId}"`); process.exit(1); }
  if (machine.os !== process.platform) { console.error(`This computer is ${process.platform} but machine "${machineId}" is ${machine.os} in machines.json.`); process.exit(1); }
  const logFile = path.join(dataPath(cfg, 'logs'), `agent-${machineId}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (line) => { const l = `${new Date().toISOString()} ${line}\n`; process.stderr.write(l); try { fs.appendFileSync(logFile, l); } catch { /* disk full: keep running */ } };
  installProcessGuards(log);
  const tokens = loadTokens(cfg);
  if (!tokens.machines[machineId]) { console.error(`No token for ${machineId}. Run: npm run gen-tokens (and copy ${path.basename(tokenPath(cfg, machineId))} to this computer).`); process.exit(1); }
  const registry = createRegistry({ cfg, machineId });
  registry.ensureWorkspace();
  const { sidecars, stopSidecars } = await (await import('./sidecars/start.js')).startSidecars({ cfg, machineId, registry, log });
  const agent = createAgent({ cfg, machineId, registry, sidecars, tokens, log });
  const loopbackOnly = (machine.allowedCallers ?? []).every((c) => isLoopback(c));
  const bind = loopbackOnly ? { host: '127.0.0.1', reason: 'only local callers are allowed' } : resolveBind('auto');
  const addr = await agent.listen(machine.agentPort, bind.host);
  log(`agent ${machineId} listening on ${addr.address}:${addr.port} (${bind.reason})`);
  const stop = async () => { await stopSidecars(); await agent.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
