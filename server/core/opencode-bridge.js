// The permission bridge (the safety-critical part of OpenCode integration). Every permission OpenCode asks for on a machine
// goes through policy.decide (source "agent", with the permission mode and the request's class) and, when policy says ask, becomes a
// gate request with the exact command and the bound target. The answer goes back as "once" or "reject" and nothing else: never
// "always", and OpenCode's direct shell route is never called (the agent client does not even allow the path). Pending permissions
// do not survive an OpenCode restart, so a restart voids every in-flight approval and fails the running task.
import { parsePermission, replyRequest, discoverRoutes } from '../../shared/opencode-routes.js';
import { classifyCommand, createPolicy, modeAnswer, pathsOutside, pathsProtected, resolveRequestPath } from './policy.js';
import { resolveLexical, pathsOf, within } from '../../shared/command-scope.js';
import { clip } from '../../shared/util.js';
import { isArming } from '../../shared/opencode-arming.js';

const EDIT_KINDS = new Set(['edit', 'write', 'patch', 'multiedit']);
export { modeAnswer }; // lives in policy.js; re-exported for callers that read the bridge

// trusted(machine) -> folders the person has allowed the coding agent to use besides its workspace (the chosen project folder, policy.json trustedFolders)
// protect(machine) -> JARVIS's own folder and data folder there: T3 in every mode, trusted or not (the agent's /info adds its own)
export function createOpencodeBridge({ router, gate, audit, tasks, policyCfg, policy = createPolicy(policyCfg), machines, modes, trusted = () => [], protect = () => [], log = () => {}, reconnectDelayMs = 500 }) {
  const state = new Map();     // machine -> { routes, inflight: Map<permissionId, AbortController>, seen: Set }
  const stop = new AbortController();
  const get = (m) => { if (!state.has(m)) state.set(m, { routes: null, inflight: new Map(), seen: new Set() }); return state.get(m); };

  // Where a machine's requests are checked against: its OS, its workspace and the folders the person trusts, as absolute paths. A
  // folder written with ~ needs that machine's home (from its /info); until it is known the folder cannot be resolved, so everything
  // counts as outside (it asks).
  const homes = new Map();
  const reported = new Map(); // machine -> JARVIS folders its agent reported (/info jarvis_dirs)
  const abs = (machine, p) => {
    const os = machines[machine].os ?? 'win32';
    const s = String(p ?? '');
    const expanded = s.startsWith('~') ? (homes.has(machine) ? `${homes.get(machine)}${s.slice(1)}` : null) : s;
    return expanded ? resolveLexical(expanded, { os, cwd: expanded }) : null;
  };
  const scopeOf = (machine) => ({
    os: machines[machine].os ?? 'win32', workspace: abs(machine, machines[machine].workspaceDir), trusted: trusted(machine).map((t) => abs(machine, t)).filter(Boolean),
    protected: [...protect(machine), ...(reported.get(machine) ?? [])].map((t) => abs(machine, t)).filter(Boolean),
  });
  // Arming files are matched as sent and as resolved (package.json. is package.json on Windows).
  const arming = (paths, sc) => paths.some((p) => isArming(p) || isArming(sc.workspace ? resolveRequestPath(p, sc) : null));

  // What only the machine itself can see: links, junctions and 8.3 short names. Its agent resolves the paths (system action
  // resolve_paths, no side effects); a path it cannot resolve, or no answer at all, counts as outside.
  async function realCheck(machine, paths, sc) {
    const list = [...paths, ...sc.trusted, ...sc.protected];
    const no = { outside: true, own: false, arm: false };
    if (!paths.length) return { outside: false, own: false, arm: false };
    if (list.length > 200) return no;
    let r;
    try { r = await router.capabilities(machine).call('resolve_paths', { paths: list }, { timeoutMs: 5000 }); } catch { return no; }
    const got = r?.ok && Array.isArray(r.data?.paths) && r.data.paths.length === list.length && typeof r.data.workspace === 'string' ? r.data.paths : null;
    if (!got) return no;
    const real = got.slice(0, paths.length);
    const roots = [r.data.workspace, ...got.slice(paths.length, paths.length + sc.trusted.length)].filter(Boolean);
    const own = [...got.slice(paths.length + sc.trusted.length).filter(Boolean), ...sc.protected];
    return {
      outside: real.some((p) => !p || !roots.some((x) => within(p, x, sc.os))),
      own: real.some((p) => p && own.some((x) => within(p, x, sc.os, { loose: true }))),
      arm: real.some((p) => p && isArming(p)),
    };
  }

  // Paths of an edit, a folder request or any other path permission: { tier, armed, own }. T3 when outside the workspace and trusted
  // folders (as written or as the machine resolves them) or under JARVIS's own folders, which also arm (even Bypass asks).
  async function classifyPaths(machine, paths) {
    const sc = scopeOf(machine);
    const real = await realCheck(machine, paths, sc);
    const own = pathsProtected(paths, sc) || real.own;
    return { own, armed: own || real.arm || arming(paths, sc), tier: own || real.outside || pathsOutside(paths, sc) ? 'T3' : 'T2' };
  }

  async function respond(machine, p, answer) {
    const s = get(machine);
    try {
      const req = replyRequest(s.routes ?? discoverRoutes(null), p, answer);
      const r = await router.capabilities(machine).opencode(req.method, req.path, req.body);
      if (r.status >= 300) log(`OpenCode refused the permission reply (${r.status})`);
      return r.status < 300;
    } catch (e) { log(`permission reply failed: ${e.message}`); return false; }
  }

  async function handle(machine, props) {
    const p = parsePermission(props);
    const s = get(machine);
    if (!p.id || s.seen.has(p.id)) return;
    s.seen.add(p.id);
    if (s.seen.size > 500) s.seen.delete(s.seen.values().next().value);
    const task = tasks?.bySession(machine, p.sessionID);
    const base = { component: 'opencode-bridge', target: machine, source: 'agent', taskId: task?.id };

    let tier = 'T2';
    let action = `opencode_${p.kind}`;
    let args;
    let summary;
    let cls = null;
    let armed = false;
    if (p.kind === 'bash' || p.kind === 'shell') {
      const sc = scopeOf(machine);
      cls = classifyCommand(p.command, policyCfg.opencode, sc);
      if (cls.tier !== 'T3') {
        // the words that resolve inside the workspace on paper: does any of them lead out through a link or junction?
        const named = pathsOf(p.command ?? '', sc).paths.filter(Boolean);
        const real = await realCheck(machine, named, sc);
        if (real.outside || real.own) cls = { class: 'destructive', tier: 'T3', reason: real.own ? 'leads into JARVIS\'s own folder' : 'a path in it leads outside the workspace (a link or junction), or could not be checked' };
      }
      args = { command: p.command ?? '' };
      tier = cls.tier;
      summary = `The coding agent wants to run a command on ${machines[machine].label}: ${clip(p.command ?? '(empty)', 300)}`;
    } else if (EDIT_KINDS.has(p.kind)) {
      args = { paths: p.patterns.slice(0, 10), ...(p.metadata?.filepath ? { file: p.metadata.filepath } : {}) };
      const paths = [...p.patterns, p.metadata?.filepath].filter(Boolean);
      const c = await classifyPaths(machine, paths);
      const own = c.own;
      ({ armed, tier } = c);
      summary = `The coding agent wants to change ${p.patterns.slice(0, 3).join(', ') || 'a file'} on ${machines[machine].label}${own ? ' (JARVIS\'s own folder)' : tier === 'T3' ? ' (outside the workspace)' : ''}.`;
    } else if (p.kind === 'webfetch') {
      args = { url: p.patterns[0] ?? p.metadata?.url ?? '' };
      if (!/^https?:\/\//i.test(args.url)) tier = 'T3'; // file:, data: and anything else that is not the web
      summary = `The coding agent wants to fetch ${clip(args.url, 200)} on ${machines[machine].label}.`;
    } else if (p.kind === 'external_directory') {
      ({ armed, tier } = await classifyPaths(machine, p.patterns)); // a trusted folder is not "outside"; JARVIS's own folders always are
      args = { paths: p.patterns.slice(0, 10) };
      summary = `The coding agent wants to use a folder outside the workspace and your trusted folders on ${machines[machine].label}: ${p.patterns.slice(0, 3).join(', ')}`;
    } else {
      args = { patterns: p.patterns.slice(0, 10), title: p.title };
      // read, list, glob, grep and kinds this version does not know: their patterns are paths too
      if (p.patterns.length) ({ armed, tier } = await classifyPaths(machine, p.patterns));
      summary = `The coding agent asks for permission "${p.kind}" on ${machines[machine].label}.`;
    }

    const mode = modes?.get?.() ?? 'manual';
    const verdict = policy.decide({ name: action, tier, source: 'agent', permission: { mode, kind: p.kind, cls, armed } });
    if (verdict.mode !== 'ask') {
      const once = verdict.mode === 'auto';
      await audit.append({ ...base, action, args, tier, decision: once ? 'auto' : 'deny', outcome: once ? 'approved' : 'rejected', reason: cls?.class === 'allow' && once ? `${verdict.reason}, ${cls.reason}` : verdict.reason });
      await respond(machine, p, once ? 'once' : 'reject');
      return;
    }
    const ctl = new AbortController();
    s.inflight.set(p.id, ctl);
    const answer = await gate.requestApproval({ action, args, tier, target: machine, source: 'agent', taskId: task?.id, summary, signal: ctl.signal });
    const voided = ctl.signal.aborted;
    s.inflight.delete(p.id);
    if (voided) return; // OpenCode restarted: the id is stale, and a reply to a stale id would do nothing anyway
    await respond(machine, p, answer.approved ? 'once' : 'reject');
  }

  function voidInFlight(machine, reason) {
    const s = get(machine);
    for (const ctl of s.inflight.values()) ctl.abort(new Error(reason));
    s.inflight.clear();
    s.seen.clear();
  }

  async function onConnected(machine) {
    const caps = router.capabilities(machine);
    router.info?.(machine).then((i) => {
      if (typeof i?.home === 'string' && i.home) homes.set(machine, i.home);
      if (Array.isArray(i?.jarvis_dirs)) reported.set(machine, i.jarvis_dirs.filter((d) => typeof d === 'string' && d));
    }).catch(() => {});
    try {
      const doc = await caps.opencode('GET', '/doc');
      if (doc.status === 200 && doc.json) get(machine).routes = discoverRoutes(doc.json);
      if (get(machine).routes?.permissionList) {
        const list = await caps.opencode('GET', '/permission');
        for (const props of Array.isArray(list.json) ? list.json : []) handle(machine, props).catch((e) => log(`permission failed: ${e.message}`));
      }
    } catch { /* OpenCode is not running on that machine; events will say when it is */ }
  }

  function onEvent(machine, ev) {
    if (ev.sidecar === 'claude') { tasks?.onClaudeEvent?.(machine, ev); return; }
    if (ev.sidecar !== 'opencode') return;
    if (ev.type === 'permission.asked' || ev.type === 'permission.updated') { handle(machine, ev.properties).catch((e) => log(`permission failed: ${e.message}`)); return; }
    if (ev.type === 'permission.replied') { get(machine).inflight.get(ev.properties?.requestID ?? ev.properties?.permissionID)?.abort(new Error('answered elsewhere')); return; }
    if (ev.type === 'opencode.restarted' || ev.type === 'opencode.exited') {
      voidInFlight(machine, 'OpenCode restarted');
      tasks?.failRunning(machine, 'OpenCode restarted, so the task was stopped');
      if (ev.type === 'opencode.restarted') onConnected(machine);
      return;
    }
    if (ev.type === 'opencode.ready') { onConnected(machine); return; }
    tasks?.onEvent(machine, ev);
  }

  return {
    start() {
      for (const machine of Object.keys(machines)) {
        router.capabilities(machine).events((ev) => onEvent(machine, ev), {
          signal: stop.signal,
          onState: ({ connected }) => { if (connected) onConnected(machine); else { voidInFlight(machine, 'lost the connection to the agent'); } },
        }).catch(() => {});
      }
    },
    stop() { stop.abort(); for (const m of Object.keys(machines)) voidInFlight(m, 'stopping'); },
    onEvent, handle, state,
  };
}
