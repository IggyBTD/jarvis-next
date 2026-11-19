// OpenCode's HTTP API differs between versions (where a permission reply goes, whether prompt_async exists). Both the agent
// and the server read GET /doc and bind to what the installed version advertises instead of assuming a path.
export function discoverRoutes(doc) {
  const paths = Object.keys(doc?.paths ?? {}).filter((p) => doc.paths[p]);
  const has = (re) => paths.some((p) => re.test(p));
  return {
    version: doc?.info?.version ?? null,
    permissionReply: has(/^\/permission\/\{[^}]+\}\/reply$/) ? 'new' : has(/^\/session\/\{[^}]+\}\/permissions\/\{[^}]+\}$/) ? 'old' : null,
    permissionList: paths.includes('/permission'),
    promptAsync: has(/^\/session\/\{[^}]+\}\/prompt_async$/),
    abort: has(/^\/session\/\{[^}]+\}\/abort$/),
    // informational: the direct shell route exists in the API, and JARVIS never calls it (a test asserts that)
    shellRoutePresent: has(/\/shell$/),
  };
}

// Path and body for answering a permission, per discovered variant. Only "once" and "reject" are ever sent.
export function replyRequest(routes, { id, sessionID }, answer) {
  if (answer !== 'once' && answer !== 'reject') throw new Error('only once or reject may be sent');
  if (routes.permissionReply === 'new') return { method: 'POST', path: `/permission/${encodeURIComponent(id)}/reply`, body: { reply: answer } };
  if (routes.permissionReply === 'old' && sessionID) return { method: 'POST', path: `/session/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(id)}`, body: { response: answer } };
  throw new Error('this OpenCode version does not advertise a permission reply route');
}

// One permission request in either event shape, reduced to what the gate needs.
export function parsePermission(properties = {}) {
  const meta = properties.metadata ?? {};
  const kind = String(properties.permission ?? properties.type ?? 'unknown').toLowerCase();
  const patterns = [].concat(properties.patterns ?? properties.pattern ?? []).map(String);
  const command = meta.command ?? meta.cmd ?? (kind === 'bash' ? patterns[0] : undefined);
  return { id: String(properties.id ?? ''), sessionID: properties.sessionID ? String(properties.sessionID) : null, kind, patterns, command: command == null ? null : String(command), title: properties.title ?? null, metadata: meta };
}
