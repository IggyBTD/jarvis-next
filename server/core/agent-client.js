// HTTP client for the machine agents. Imported ONLY by tool-router.js (scripts/check-chokepoint.js enforces it). It never
// falls back to another machine: an unreachable target is an error naming that target. Proxy paths to OpenCode and the
// browser sidecar are checked against an allowlist and refuse dot segments, control characters, encoded separators and
// the /session/:id/shell route.
import { SseParser } from './llm-client.js';
import { sleep } from '../../shared/util.js';
import { checkPath, checkProxy, isReplyRoute, replyBodyOk } from '../../shared/proxy-routes.js';

export class AgentUnreachable extends Error {
  constructor(machine, label, cause) { super(`${label} is not reachable (${cause}). Nothing was run, and no other computer was tried.`); this.name = 'AgentUnreachable'; this.machine = machine; }
}

// Returns the cleaned path or throws: shared/proxy-routes.js checks (no encodings, queries, dot segments or the shell route) plus
// a list of path patterns. The sidecar calls below use the shared route and method list, which the agent enforces as well.
export function safeProxyPath(sub, routes) {
  const raw = checkPath(sub);
  if (!routes.some((re) => re.test(raw))) throw new Error('that route is not on the allowlist');
  return raw;
}
const toSidecar = (sidecar, method, sub, body) => {
  const p = checkProxy(sidecar, method, sub);
  if (isReplyRoute(sidecar, p) && !replyBodyOk(body)) throw new Error('a permission answer may only be once or reject');
  return `/${sidecar}${p}`;
};

export function createAgentClient({ machines, tokens, fetchImpl = fetch, sleepFn = sleep }) {
  const base = (id) => {
    const m = machines[id];
    if (!m) throw new Error(`unknown machine ${id}`);
    return `http://${m.host}:${m.agentPort}`;
  };
  const headers = (id, extra = {}) => ({ authorization: `Bearer ${tokens(id)}`, ...extra });

  async function req(id, method, path, { body, signal, timeoutMs = 30_000, raw = false } = {}) {
    const ctl = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
    let res;
    try {
      res = await fetchImpl(`${base(id)}${path}`, { method, headers: headers(id, body !== undefined ? { 'content-type': 'application/json' } : {}), body: body === undefined ? undefined : JSON.stringify(body), signal: ctl });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new AgentUnreachable(id, machines[id].label, e.cause?.code ?? e.name ?? e.message);
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  }

  return {
    health: (id, o) => req(id, 'GET', '/health', { timeoutMs: 4000, ...o }).then((r) => (r.status === 200 ? r.json : { ok: false, status: r.status })),
    info: (id, o) => req(id, 'GET', '/info', { timeoutMs: 6000, ...o }).then((r) => { if (r.status !== 200) throw new Error(`info failed (${r.status})`); return r.json; }),
    actions: (id, o) => req(id, 'GET', '/actions', o).then((r) => r.json),
    async call(id, name, args, { dryRun = false, signal, timeoutMs = 60_000 } = {}) {
      const r = await req(id, 'POST', `/action/${encodeURIComponent(name)}`, { body: { args, dryRun }, signal, timeoutMs });
      if (r.status === 200 && r.json) return r.json;
      return { ok: false, error: r.json?.error ?? `agent answered ${r.status}`, durationMs: 0 };
    },
    async opencode(id, method, sub, body, o = {}) { return req(id, method, toSidecar('opencode', method, sub, body), { body, ...o }); },
    async claude(id, method, sub, body, o = {}) { return req(id, method, toSidecar('claude', method, sub, body), { body, ...o }); },
    async browser(id, method, sub, body, o = {}) { return req(id, method, toSidecar('browser', method, sub, body), { body, timeoutMs: 60_000, ...o }); },
    // Agent event stream (OpenCode permission requests, task events). Reconnects with backoff until the signal aborts.
    async events(id, onEvent, { signal, onState = () => {} } = {}) {
      let delay = 500;
      while (!signal?.aborted) {
        try {
          const res = await req(id, 'GET', '/events', { raw: true, signal, timeoutMs: 24 * 3600_000 });
          if (res.status !== 200) throw new Error(`events answered ${res.status}`);
          onState({ connected: true });
          delay = 500;
          const sse = new SseParser();
          const dec = new TextDecoder();
          for await (const chunk of res.body) for (const data of sse.push(dec.decode(chunk, { stream: true }))) { try { onEvent(JSON.parse(data)); } catch { /* malformed event */ } }
        } catch (e) { if (signal?.aborted) return; }
        onState({ connected: false });
        await sleepFn(delay, signal);
        delay = Math.min(delay * 2, 15_000);
      }
    },
  };
}
