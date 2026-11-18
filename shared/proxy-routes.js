// The sidecar routes the JARVIS server uses on a machine agent, each with its one method. Both ends enforce the same list: the
// server before it sends (server/core/agent-client.js) and the agent before it forwards (agent/index.js), so a machine token by
// itself reaches nothing else on the machine: no OpenCode terminal, no direct command route, no other kind of permission answer.
export const PROXY_ROUTES = {
  opencode: [
    ['GET', /^\/doc$/], ['GET', /^\/permission$/], ['POST', /^\/session$/],
    ['POST', /^\/session\/[\w.-]+\/(message|prompt_async|abort)$/],
    ['POST', /^\/permission\/[\w.-]+\/reply$/], ['POST', /^\/session\/[\w.-]+\/permissions\/[\w.-]+$/],
  ],
  claude: [['GET', /^\/status$/], ['POST', /^\/(run|abort)$/]],
  browser: [
    ['GET', /^\/(health|read|screenshot|state|view_state|view_screenshot)$/], ['POST', /^\/(navigate|click|type|press|back|close|resume|confirm)$/],
    ['POST', /^\/view_(navigate|click|type|press|scroll|back|forward|reload|close)$/],
  ],
};

// The raw path (before any decoding): no percent encodings at all, no query or fragment, no control characters or backslashes,
// no empty, dot or dot-dot segments, never the session command route. Returns it or throws.
export function checkPath(sub) {
  const raw = String(sub ?? '');
  if (!raw.startsWith('/') || raw.length > 300) throw new Error('bad proxy path');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\?#%]/.test(raw)) throw new Error('bad proxy path: no encodings, queries or control characters');
  if (raw.includes('//') || raw.split('/').some((s) => s === '.' || s === '..')) throw new Error('dot segments are not allowed in proxy paths');
  if (/(^|\/)shell(\/|$)/i.test(raw)) throw new Error('the shell route is never used');
  return raw;
}

// Throws unless the method and path are on the list for that sidecar; returns the path.
export function checkProxy(sidecar, method, sub) {
  const raw = checkPath(sub);
  if (!(PROXY_ROUTES[sidecar] ?? []).some(([m, re]) => m === method && re.test(raw))) throw new Error('that route is not on the allowlist');
  return raw;
}

// OpenCode permission answers: only "once" or "reject", in whichever field the installed version reads, and nothing else in the body.
export const isReplyRoute = (sidecar, sub) => sidecar === 'opencode' && (/^\/permission\/[\w.-]+\/reply$/.test(sub) || /^\/session\/[\w.-]+\/permissions\/[\w.-]+$/.test(sub));
export function replyBodyOk(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && (keys[0] === 'reply' || keys[0] === 'response') && (body[keys[0]] === 'once' || body[keys[0]] === 'reject');
}
