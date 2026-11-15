// The permission bridge (the safety-critical part of OpenCode integration). Every permission OpenCode asks for on a machine
// goes through policy.decide (source "agent", with the permission mode and the request's class) and, when policy says ask, becomes a
// gate request with the exact command and the bound target. The answer goes back as "once" or "reject" and nothing else: never
// "always", and OpenCode's direct shell route is never called (the agent client does not even allow the path). Pending permissions
// do not survive an OpenCode restart, so a restart voids every in-flight approval and fails the running task.
import { parsePermission, replyRequest, discoverRoutes } from '../../shared/opencode-routes.js';
import { classifyCommand, createPolicy, modeAnswer } from './policy.js';
import { clip } from '../../shared/util.js';
import { isArming } from '../../shared/opencode-arming.js';

const EDIT_KINDS = new Set(['edit', 'write', 'patch', 'multiedit']);
export { modeAnswer }; // lives in policy.js; re-exported for callers that read the bridge

// trusted(machine) -> folders the person has allowed the coding agent to use besides its workspace (the chosen project folder, policy.json trustedFolders)
export function createOpencodeBridge({ router, gate, audit, tasks, policyCfg, policy = createPolicy(policyCfg), machines, modes, trusted = () => [], log = () => {}, reconnectDelayMs = 500 }) {
  const state = new Map();     // machine -> { routes, inflight: Map<permissionId, AbortController>, seen: Set }
  const stop = new AbortController();
  const get = (m) => { if (!state.has(m)) state.set(m, { routes: null, inflight: new Map(), seen: new Set() }); return state.get(m); };

  // A path is outside when it is absolute and under none of the roots (the workspace and the folders the person trusts). A pattern may
  // end in a wildcard (C:\proj\src\*), which names the folder itself.
  const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/?\*+$/, '').replace(/\/+$/, '').toLowerCase();
  const under = (p, root) => { const r = norm(root); return !!r && (norm(p) === r || norm(p).startsWith(`${r}/`)); };
  const outsideWorkspace = (paths, machine) => {
    const roots = [machines[machine].workspaceDir, ...trusted(machine)].filter(Boolean);
    return paths.some((p) => /^([a-z]:[\\/]|[\\/]|~)/i.test(p) && !roots.some((r) => under(p, r)));
  };

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
      cls = classifyCommand(p.command, policyCfg.opencode);
      args = { command: p.command ?? '' };
      tier = cls.tier;
      summary = `The coding agent wants to run a command on ${machines[machine].label}: ${clip(p.command ?? '(empty)', 300)}`;
    } else if (EDIT_KINDS.has(p.kind)) {
      args = { paths: p.patterns.slice(0, 10), ...(p.metadata?.filepath ? { file: p.metadata.filepath } : {}) };
      const paths = [...p.patterns, p.metadata?.filepath].filter(Boolean);
      armed = paths.some(isArming);
      tier = outsideWorkspace(paths, machine) ? 'T3' : 'T2';
      summary = `The coding agent wants to change ${p.patterns.slice(0, 3).join(', ') || 'a file'} on ${machines[machine].label}${tier === 'T3' ? ' (outside the workspace)' : ''}.`;
    } else if (p.kind === 'webfetch') {
      args = { url: p.patterns[0] ?? p.metadata?.url ?? '' };
      summary = `The coding agent wants to fetch ${clip(args.url, 200)} on ${machines[machine].label}.`;
    } else if (p.kind === 'external_directory') {
      tier = outsideWorkspace(p.patterns, machine) ? 'T3' : 'T2'; // a trusted folder is not "outside"
      args = { paths: p.patterns.slice(0, 10) };
      summary = `The coding agent wants to use a folder outside the workspace and your trusted folders on ${machines[machine].label}: ${p.patterns.slice(0, 3).join(', ')}`;
    } else {
      args = { patterns: p.patterns.slice(0, 10), title: p.title };
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
