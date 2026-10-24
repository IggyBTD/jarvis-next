// HTTP client for the machine agents. Imported ONLY by tool-router.js (scripts/check-chokepoint.js enforces it). It never
// falls back to another machine: an unreachable target is an error naming that target. Proxy paths to OpenCode and the
// browser sidecar are checked against an allowlist and refuse dot segments, control characters, encoded separators and
// the /session/:id/shell route.
import { SseParser } from './llm-client.js';
import { sleep } from '../../shared/util.js';

export class AgentUnreachable extends Error {
  constructor(machine, label, cause) { super(`${label} is not reachable (${cause}). Nothing was run, and no other computer was tried.`); this.name = 'AgentUnreachable'; this.machine = machine; }
}

const OPENCODE_ROUTES = [
  /^\/doc$/, /^\/global\/health$/, /^\/global\/event$/, /^\/event$/, /^\/path$/, /^\/config$/, /^\/project(\/current)?$/,
  /^\/session$/, /^\/session\/[\w.-]+$/, /^\/session\/[\w.-]+\/(message|prompt_async|abort|diff|children)$/,
  /^\/session\/[\w.-]+\/permissions\/[\w.-]+$/, /^\/permission$/, /^\/permission\/[\w.-]+(\/reply)?$/,
];
const BROWSER_ROUTES = [/^\/(health|navigate|click|type|press|read|screenshot|back|close|resume|confirm|state)$/, /^\/view_(navigate|click|type|press|scroll|back|forward|reload)$/];
const SHELL = /(^|\/)shell(\/|$)/i;

// Returns the cleaned path or throws. No query strings: the agent sets the workspace itself.
export function safeProxyPath(sub, routes) {
  const raw = String(sub ?? '');
  if (!raw.startsWith('/') || raw.length > 300) throw new Error('bad proxy path');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\?#]/.test(raw)) throw new Error('bad proxy path');
  if (/%(2f|5c|2e|00|3f|23)/i.test(raw)) throw new Error('encoded separators are not allowed in proxy paths');
  if (raw.includes('//')) throw new Error('bad proxy path');
  if (raw.split('/').some((s) => s === '.' || s === '..')) throw new Error('dot segments are not allowed in proxy paths');
  if (SHELL.test(raw)) throw new Error('the shell route is never used');
  if (!routes.some((re) => re.test(raw))) throw new Error('that route is not on the allowlist');
  return raw;
}

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
    async opencode(id, method, sub, body, o = {}) {
      const p = safeProxyPath(sub, OPENCODE_ROUTES);
      const r = await req(id, method, `/opencode${p}`, { body, ...o });
      return r;
    },
    async browser(id, method, sub, body, o = {}) {
      const p = safeProxyPath(sub, BROWSER_ROUTES);
      return req(id, method, `/browser${p}`, { body, timeoutMs: 60_000, ...o });
    },
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
