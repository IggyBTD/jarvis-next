// HTTP side of the server. Every route needs a bearer token (UI, machine or model token, per route); /v1 is the authenticated
// OpenAI-compatible proxy for OpenCode. Browser pages may call the REST routes only from the configured origins.
import { ipAllowed } from '../../shared/net.js';

const json = (res, status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };

export function createHealth({ llm, queue, router, machines, ttlMs = 4000, now = Date.now }) {
  let cached = null;
  return async function health({ fresh = false } = {}) {
    if (!fresh && cached && now() - cached.at < ttlMs) return cached.value;
    const ids = Object.keys(machines);
    const [model, ...agents] = await Promise.all([llm.health(), ...ids.map((id) => router.health(id).then((h) => ({ online: h?.ok === true, os: h?.os ?? machines[id].os, sidecars: h?.sidecars ?? {} })).catch(() => ({ online: false, os: machines[id].os, sidecars: {} })))]);
    const value = { model: { reachable: model.reachable, modelId: model.modelId ?? null, modelPresent: model.modelPresent ?? false, error: model.error ?? null }, queueDepth: queue.depth(), tokensPerSec: model.tokensPerSec, machines: Object.fromEntries(ids.map((id, i) => [id, { label: machines[id].label, ...agents[i] }])), ts: now() };
    cached = { at: now(), value };
    return value;
  };
}

export function createHttpHandler({ cfg, auth, llmProxy, health, audit, conversations, digest, buildState, log = () => {} }) {
  const origins = cfg.machines.server.origins ?? [];
  return async function handle(req, res) {
    try {
      const ip = req.socket.remoteAddress;
      const origin = req.headers.origin;
      const cors = origin && origins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
      if (req.method === 'OPTIONS') {
        if (!cors['access-control-allow-origin']) return json(res, 403, { error: 'origin not allowed' });
        res.writeHead(204, { ...cors, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST', 'access-control-max-age': '600' });
        return res.end();
      }
      if (origin && !cors['access-control-allow-origin']) return json(res, 403, { error: 'origin not allowed' });

      const url = new URL(req.url, 'http://server');
      const p = url.pathname;
      const need = p.startsWith('/v1/') || p === '/v1' ? ['machine', 'model'] : ['ui', 'machine'];
      const verdict = auth.check(req.headers.authorization, { roles: need, ip });
      if (!verdict.ok) return json(res, verdict.status, { error: verdict.status === 429 ? 'too many attempts' : verdict.status === 403 ? 'this token cannot use this route' : 'unauthorized' }, cors);

      if (need.includes('model') && (p.startsWith('/v1/') || p === '/v1')) return llmProxy.handle(req, res, verdict.principal);
      if (req.method === 'GET' && p === '/health') return json(res, 200, await health({ fresh: url.searchParams.get('fresh') === '1' }), cors);
      if (verdict.principal.role !== 'ui') return json(res, 403, { error: 'this token cannot use this route' }, cors);
      if (req.method === 'GET' && p === '/api/state') return json(res, 200, await buildState(), cors);
      if (req.method === 'GET' && p === '/api/audit') return json(res, 200, { entries: audit.tail(Math.min(200, Number(url.searchParams.get('n')) || 50)), verify: url.searchParams.get('verify') === '1' ? audit.verify() : undefined }, cors);
      if (req.method === 'GET' && p === '/api/conversations') return json(res, 200, { conversations: conversations.list() }, cors);
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
