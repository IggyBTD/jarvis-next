// Coding-agent tasks: one OpenCode task per computer at a time (others wait their turn). A task records a snapshot of the
// workspace repository first (a ref, no file touched), runs in an OpenCode session on the bound target, times out, can be
// aborted, and ends with a summary and the list of changed files. If OpenCode restarts, the task fails cleanly.
// Reaches the agents only through router.capabilities() (allowlisted proxy routes plus system actions).
import path from 'node:path';
import { readJson, writeJsonAtomic, newId, clip, wrapUntrusted } from '../../shared/util.js';
import { describeAgentTool, clipText } from '../../shared/steps.js';
import { discoverRoutes } from '../../shared/opencode-routes.js';
import { PLAN_NOTE } from '../../shared/permission-modes.js';
import { markTainted, stateOf } from './taint.js';

const ACTIVE = new Set(['queued', 'running']);
const WORKSPACE_RE = /^(?!.*\.\.)[\w .-]+(\/[\w .-]+)*$/;

export function createAgentTasks({ router, bus, audit, conversations, dataDir, taskTimeoutMs, modes, backend, onNote = null, now = () => new Date(), setTimer = setTimeout }) {
  const file = path.join(dataDir, 'agent-tasks.json');
  let tasks = readJson(file, []).map((t) => (ACTIVE.has(t.state) ? { ...t, state: 'failed', error: 'the server restarted while this task was running', endedAt: now().toISOString() } : t));
  const timers = new Map();   // task id -> timeout handle
  const running = new Map();  // target -> task id
  const lastText = new Map(); // task id -> latest text part
  const finishing = new Set();

  const save = () => { try { writeJsonAtomic(file, tasks.slice(-100)); } catch (e) { console.error(`[agent-tasks] cannot save: ${e.message}`); } };
  const view = (t) => ({ taskId: t.id, convId: t.convId ?? null, target: t.target, state: t.state, summary: t.summary ?? null, error: t.error ?? null, files: t.files ?? null, prompt: clip(t.prompt, 120), startedAt: t.startedAt ?? null, endedAt: t.endedAt ?? null });
  const publish = (t) => bus.publish('agent.status', view(t));
  let seq = 0;
  // One thing the coding agent did inside a task (a command, a file read or edited); the chat shows these under the task's step.
  const step = (t, s) => bus.publish('agent.step', { taskId: t.id, convId: t.convId ?? null, target: t.target, ...s });
  const byId = (id) => tasks.find((t) => t.id === id);
  save();

  async function routesFor(caps) {
    const doc = await caps.opencode('GET', '/doc');
    if (doc.status !== 200) throw new Error(`OpenCode is not available (${doc.json?.error ?? doc.status})`);
    return discoverRoutes(doc.json ?? JSON.parse(doc.text));
  }

  async function finish(t, state, { error = null } = {}) {
    if (!ACTIVE.has(t.state) || finishing.has(t.id)) return;
    finishing.add(t.id); // the state changes last, so anyone who sees "done" also sees the file list
    clearTimeout(timers.get(t.id));
    timers.delete(t.id);
    t.error = error;
    t.endedAt = now().toISOString();
    t.summary = lastText.get(t.id) ? clip(lastText.get(t.id), 1500) : null;
    lastText.delete(t.id);
    if (running.get(t.target) === t.id) running.delete(t.target);
    if (t.snapshot) {
      try {
        const r = await router.capabilities(t.target).call('git_changes', { path: t.workspace ?? '.', name: t.id });
        if (r.ok) t.files = r.data.files;
      } catch { /* the list is a courtesy */ }
    }
    t.state = state;
    finishing.delete(t.id);
    save();
    publish(t);
    audit.append({ component: 'agent-tasks', target: t.target, source: 'agent', action: 'agent_task', args: { taskId: t.id, state }, tier: 'T1', decision: 'auto', outcome: state, reason: error ?? undefined, taskId: t.id }).catch(() => {});
    const conv = t.convId ? conversations?.get(t.convId) : null;
    // what the coding agent reports is someone else's text (the repository, the tools it ran): the chat is tainted from here on
    if (conv) conv.taint = markTainted(stateOf(conv), 'agent task note', t.endedAt);
    if (conv && t.direct) {
      // a Code-page message answered by Claude Code: its result is the assistant's reply
      const text = state === 'done' ? (t.summary ?? '(no reply)') : `Claude Code ${state === 'aborted' ? 'was stopped' : 'did not finish'}${error ? `: ${error}` : ''}`;
      conversations.append(conv, { role: 'assistant', content: text, target: t.target });
      bus.publish('chat.delta', { convId: t.convId, target: t.target, text });
      bus.publish('chat.done', { convId: t.convId, target: t.target, text, stats: { requests: 1, tools: 0 } });
    } else if (conv) {
      // Everything the coding agent or its tools produced (summary, changed file names, the failure reason) goes inside one untrusted
      // block, each file name and the reason on one line of its own: a file named like an instruction is still only data.
      const line = (s, n) => clip(String(s ?? '').replace(/[\r\n\u2028\u2029]+/g, ' '), n);
      const report = [
        t.summary ? `Summary:\n${t.summary}` : '',
        t.files?.length ? `Changed files (${t.files.length}):\n${t.files.slice(0, 20).map((f) => `- ${line(f.status, 4)} ${line(f.path, 200)}`).join('\n')}` : '',
        error ? `Reason: ${line(error, 300)}` : '',
      ].filter(Boolean).join('\n');
      const note = `Agent task ${t.id} on ${t.target} ${state}.${report ? `\n${wrapUntrusted('agent task report', report, { max: 6000 })}` : ''}`;
      conversations.append(conv, { role: 'system', content: note, target: t.target });
      bus.publish('chat.note', { convId: t.convId, target: t.target, text: `Agent task ${state}${t.summary ? `: ${clip(t.summary, 200)}` : error ? `: ${error}` : ''}` });
      onNote?.(t.convId, note); // lets the model report back, instead of waiting for the user to ask
    }
    next(t.target);
  }

  async function run(t) {
    running.set(t.target, t.id);
    t.state = 'running';
    t.startedAt = now().toISOString();
    save();
    publish(t);
    const caps = router.capabilities(t.target);
    try {
      if (t.engine === 'claude') return await runClaude(t, caps);
      const routes = await routesFor(caps);
      const snap = await caps.call('git_snapshot', { path: t.workspace ?? '.', name: t.id }).catch(() => null);
      t.snapshot = !!(snap?.ok && snap.data?.snapshot);
      const made = await caps.opencode('POST', '/session', { title: clip(t.prompt, 60) });
      if (made.status !== 200 || !made.json?.id) throw new Error(`could not create a session (${made.json?.error ?? made.status})`);
      t.sessionID = made.json.id;
      save();
      timers.set(t.id, setTimer(() => { abort(t.id, 'timeout').catch(() => {}); }, taskTimeoutMs));
      timers.get(t.id)?.unref?.();
      const text = `${modes?.get?.() === 'plan' ? `${PLAN_NOTE}\n\n` : ''}${t.workspace ? `Work in the subfolder "${t.workspace}" of the workspace.\n\n` : ''}${t.prompt}`;
      const body = { parts: [{ type: 'text', text }] };
      if (routes.promptAsync) {
        const r = await caps.opencode('POST', `/session/${t.sessionID}/prompt_async`, body);
        if (r.status >= 300) throw new Error(`OpenCode refused the prompt (${r.status})`);
      } else {
        caps.opencode('POST', `/session/${t.sessionID}/message`, body, { timeoutMs: taskTimeoutMs }).then((r) => { if (r.status >= 300) finish(t, 'failed', { error: `OpenCode refused the prompt (${r.status})` }); }).catch((e) => finish(t, 'failed', { error: e.message }));
      }
    } catch (e) { await finish(t, 'failed', { error: e.message }); }
  }

  // The Claude Code backend: the agent starts the official program for this run and reports through events (claude.text, claude.done).
  async function runClaude(t, caps) {
    const snap = await caps.call('git_snapshot', { path: t.workspace ?? '.', name: t.id }).catch(() => null);
    t.snapshot = !!(snap?.ok && snap.data?.snapshot);
    t.sessionID = `claude-${t.id}`;
    save();
    timers.set(t.id, setTimer(() => { abort(t.id, 'timeout').catch(() => {}); }, taskTimeoutMs));
    timers.get(t.id)?.unref?.();
    const r = await caps.claude('POST', '/run', { runId: t.id, prompt: t.prompt, mode: modes?.get?.() ?? 'auto', ...(t.workspace ? { folder: t.workspace } : {}) });
    if (r.status !== 200) throw new Error(`Claude Code did not start (${r.json?.error ?? r.status})`);
  }

  function next(target) {
    if (running.has(target)) return;
    const waiting = tasks.find((t) => t.target === target && t.state === 'queued');
    if (waiting) run(waiting);
  }

  async function abort(id, why = 'aborted') {
    const t = byId(id);
    if (!t || !ACTIVE.has(t.state)) return false;
    if (t.state === 'running' && t.engine === 'claude') await router.capabilities(t.target).claude('POST', '/abort', { runId: t.id }).catch(() => {});
    else if (t.state === 'running' && t.sessionID) await router.capabilities(t.target).opencode('POST', `/session/${t.sessionID}/abort`, {}).catch(() => {});
    await finish(t, why === 'timeout' ? 'timeout' : 'aborted', { error: why === 'timeout' ? `stopped after ${Math.round(taskTimeoutMs / 60000)} minutes` : null });
    return true;
  }

  return {
    // tool handler for agent_task
    start({ prompt, workspace }, ctx) {
      if (workspace && !WORKSPACE_RE.test(workspace)) return { error: 'workspace must be a plain subfolder name inside the workspace' };
      const t = { id: newId('t-').slice(0, 14), target: ctx.target, convId: ctx.convId ?? null, prompt, workspace: workspace ?? null, state: 'queued', createdAt: now().toISOString(), sessionID: null, snapshot: false, engine: ctx.direct ? 'claude' : (backend?.get?.() ?? 'local'), direct: !!ctx.direct, summary: null, error: null, files: null };
      tasks.push(t);
      save();
      publish(t);
      next(t.target);
      return { taskId: t.id, state: t.state, note: t.state === 'queued' ? `Another task is running on ${t.target}; this one starts when it ends.` : 'Started. A summary is added to the conversation when it finishes.' };
    },
    abort, list: () => tasks.slice(-20).map(view), get: byId,
    bySession: (machine, sessionID) => tasks.find((t) => t.target === machine && t.sessionID === sessionID && ACTIVE.has(t.state)),
    onClaudeEvent(machine, ev) {
      const t = tasks.find((x) => x.target === machine && x.id === ev.runId && x.state === 'running');
      if (!t) return;
      if (ev.type === 'claude.text') lastText.set(t.id, ev.text);
      else if (ev.type === 'claude.tool') step(t, { id: `${t.id}-${++seq}`, text: describeAgentTool(ev.name, ev.input), status: 'running' });
      else if (ev.type === 'claude.done') {
        if (ev.result) lastText.set(t.id, ev.result);
        if (ev.ok && ev.denied) lastText.set(t.id, `${lastText.get(t.id) ?? ''}\n\n(${ev.denied} action${ev.denied === 1 ? ' was' : 's were'} refused by the permission mode and not run.)`);
        finish(t, ev.ok ? 'done' : 'failed', { error: ev.ok ? null : clip(ev.error ?? lastText.get(t.id) ?? 'Claude Code failed', 300) });
      }
    },
    onEvent(machine, ev) {
      const props = ev.properties ?? {};
      const sid = props.sessionID ?? props.part?.sessionID ?? props.info?.sessionID;
      const t = tasks.find((x) => x.target === machine && x.sessionID === sid && x.state === 'running');
      if (!t) return;
      if (ev.type === 'message.part.updated' && props.part?.type === 'tool') {
        const p = props.part, st = p.state ?? {};
        step(t, { id: p.callID ?? p.id, text: describeAgentTool(p.tool, st.input), status: st.status === 'completed' ? 'done' : st.status === 'error' ? 'failed' : 'running', output: clipText(st.status === 'error' ? st.error : st.output, 240) });
      } else if (ev.type === 'message.part.updated' && props.part?.type === 'text' && props.part.text) lastText.set(t.id, props.part.text);
      else if (ev.type === 'session.idle') finish(t, 'done');
      else if (ev.type === 'session.error') finish(t, 'failed', { error: clip(props.error?.message ?? props.error?.data?.message ?? 'OpenCode reported an error', 300) });
    },
    // OpenCode restarted or exited: whatever was running there is gone
    failRunning: (machine, reason) => Promise.all(tasks.filter((t) => t.target === machine && ACTIVE.has(t.state)).map((t) => finish(t, 'failed', { error: reason }))),
  };
}

// The model-facing tool. Starting a task is T1: the commands and edits inside it are gated one by one by the permission bridge.
export function registerAgentTaskTool(router, tasks) {
  router.register({
    name: 'agent_task', category: 'agent', tier: 'T1', alwaysOn: true,
    description: 'Run work that needs a terminal or real files on the active computer, in the workspace folder: builds, tests, scripts, installs, downloads, git, or writing code into project files. It is a command runner, not a subagent and not another model: never use it to write text, essays or answers, to save text to a file (use write_file), to research, or to think for you; do that yourself. It asks the user before anything risky. Returns a task id at once; the result is added to the conversation when it finishes.',
    params: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 8000 }, workspace: { type: 'string', maxLength: 120 } }, required: ['prompt'], additionalProperties: false },
    handler: (args, ctx) => tasks.start(args, ctx),
  });
}
