// The permission bridge (the safety-critical part of OpenCode integration). Every permission OpenCode asks for on a machine
// becomes a gate request with source "agent", the exact command and the bound target. The answer goes back as "once" or
// "reject" and nothing else: never "always", and OpenCode's direct shell route is never called (the agent client does
// not even allow the path). Read-only commands on the allowlist are approved automatically and logged. Pending permissions do
// not survive an OpenCode restart, so a restart voids every in-flight approval and fails the running task.
import { parsePermission, replyRequest, discoverRoutes } from '../../shared/opencode-routes.js';
import { classifyCommand } from './policy.js';
import { clip } from '../../shared/util.js';

const EDIT_KINDS = new Set(['edit', 'write', 'patch', 'multiedit']);

export function createOpencodeBridge({ router, gate, audit, tasks, policyCfg, machines, log = () => {}, reconnectDelayMs = 500 }) {
  const state = new Map();     // machine -> { routes, inflight: Map<permissionId, AbortController>, seen: Set }
  const stop = new AbortController();
  const get = (m) => { if (!state.has(m)) state.set(m, { routes: null, inflight: new Map(), seen: new Set() }); return state.get(m); };

  const outsideWorkspace = (paths, workspaceDir) => paths.some((p) => (/^([a-z]:[\\/]|[\\/]|~)/i.test(p)) && !String(p).toLowerCase().replace(/\\/g, '/').startsWith(String(workspaceDir ?? '').toLowerCase().replace(/\\/g, '/')));

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
    if (p.kind === 'bash' || p.kind === 'shell') {
      const cls = classifyCommand(p.command, policyCfg.opencode);
      args = { command: p.command ?? '' };
      if (cls.class === 'allow') {
        await audit.append({ ...base, action, args, tier: 'T0', decision: 'auto', outcome: 'approved', reason: cls.reason });
        await respond(machine, p, 'once');
        return;
      }
      tier = cls.tier;
      summary = `The coding agent wants to run a command on ${machines[machine].label}: ${clip(p.command ?? '(empty)', 300)}`;
    } else if (EDIT_KINDS.has(p.kind)) {
      args = { paths: p.patterns.slice(0, 10), ...(p.metadata?.filepath ? { file: p.metadata.filepath } : {}) };
      tier = outsideWorkspace([...p.patterns, p.metadata?.filepath].filter(Boolean), machines[machine].workspaceDir) ? 'T3' : 'T2';
      summary = `The coding agent wants to change ${p.patterns.slice(0, 3).join(', ') || 'a file'} on ${machines[machine].label}${tier === 'T3' ? ' (outside the workspace)' : ''}.`;
    } else if (p.kind === 'webfetch') {
      args = { url: p.patterns[0] ?? p.metadata?.url ?? '' };
      summary = `The coding agent wants to fetch ${clip(args.url, 200)} on ${machines[machine].label}.`;
    } else if (p.kind === 'external_directory') {
      tier = 'T3';
      args = { paths: p.patterns.slice(0, 10) };
      summary = `The coding agent wants to use a folder outside the workspace on ${machines[machine].label}: ${p.patterns.slice(0, 3).join(', ')}`;
    } else {
      args = { patterns: p.patterns.slice(0, 10), title: p.title };
      summary = `The coding agent asks for permission "${p.kind}" on ${machines[machine].label}.`;
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
