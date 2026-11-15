// The steps row on the phone: everything JARVIS did before or between pieces of its answer, as ONE quiet line ("Searched your email, read 2
// emails"). While it works the line says what is happening now and the node mesh sits in front of it; when it is over it folds. Tapping it
// lists the steps, one short plain line each; tapping a step shows where it ran, how long it took, the request and a preview of the answer.
// The same wording as the desktop (shared/steps.js).
import { describeCall, summarizeKinds } from '../../shared/steps.js';
import { hydrateIcons } from '../icons/index.js';

const STATE_WORD = { running: '', ok: '', failed: 'failed', queued: 'waiting for your OK', denied: 'not approved', stopped: 'stopped' };
const secs = (ms) => (ms == null ? '' : ms < 950 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(ms < 9500 ? 1 : 0)} s`);
const agentRows = new Map(); // coding-agent task id -> its row, so what the agent does later still lands under that step

export function createSteps(parent) {
  const el = document.createElement('details');
  el.className = 'm-steps live';
  el.open = true; // while it works, every step is on show; it folds when the turn ends
  el.innerHTML = '<summary class="m-steps-head"><span class="m-steps-lead"></span><span class="m-steps-label"></span><span class="icon" data-icon="chevron-right" aria-hidden="true"></span></summary><ol class="m-steps-list"></ol>';
  parent.append(el);
  hydrateIcons(el);
  const label = el.querySelector('.m-steps-label');
  const list = el.querySelector('.m-steps-list');
  const rows = [];
  let touched = false;
  el.querySelector('.m-steps-head').addEventListener('click', () => { touched = true; });

  const refresh = () => {
    const running = rows.find((r) => r.state === 'running');
    const bad = rows.some((r) => r.state === 'failed' || r.state === 'denied');
    el.classList.toggle('live', !!running);
    el.classList.toggle('bad', !running && bad);
    const only = rows[0];
    label.textContent = running ? `${running.doing}...` : rows.length === 1 ? (only.state === 'ok' ? only.did : `${only.doing} (${STATE_WORD[only.state]})`) : summarizeKinds(rows.map((r) => ({ name: r.name, args: r.args, failed: r.state !== 'ok' })));
  };

  const add = (name, machine, state = 'running', args = {}) => {
    const { doing, did } = describeCall(name, args);
    const li = document.createElement('li');
    li.innerHTML = '<details class="m-step"><summary class="m-step-line"><span class="m-step-name"></span><span class="m-step-flag"></span></summary>'
      + '<div class="m-step-body"><div class="m-step-facts"></div><pre class="m-step-args"></pre><pre class="m-step-detail"></pre></div></details><ol class="m-step-sub"></ol>';
    const q = (s) => li.querySelector(s);
    q('.m-step-name').textContent = doing;
    let argText = '';
    try { argText = Object.keys(args ?? {}).length ? JSON.stringify(args, null, 1).slice(0, 700) : ''; } catch { /* arguments that cannot be shown */ }
    q('.m-step-args').textContent = argText ? `Request\n${argText}` : '';
    const subs = new Map();
    const row = {
      name, args, state, li, doing, did, ms: null, summary: '', note: '',
      set(s, r = {}) {
        row.state = s;
        li.dataset.state = s;
        if (r.ms != null) row.ms = r.ms;
        q('.m-step-name').textContent = s === 'ok' ? did : doing;
        q('.m-step-flag').textContent = STATE_WORD[s];
        if (r.summary !== undefined) row.summary = r.summary;
        row.facts();
        if (r.detail) q('.m-step-detail').textContent = `Result\n${r.detail}`;
        q('details.m-step').classList.toggle('plain', !argText && !r.detail && !q('.m-step-facts').textContent);
        refresh();
      },
      facts() { q('.m-step-facts').textContent = [machine ? `on ${machine}` : '', secs(row.ms), row.summary, row.note].filter(Boolean).join(' · '); },
      // something the coding agent did inside this step: a command, a file read or edited
      sub({ id, text, status = 'running', output }) {
        let item = subs.get(id);
        if (!item) { item = document.createElement('li'); item.innerHTML = '<span class="m-sub-text"></span>'; subs.set(id, item); q('.m-step-sub').append(item); }
        item.dataset.state = status === 'done' ? 'ok' : status;
        item.querySelector('.m-sub-text').textContent = output && status === 'failed' ? `${text}: ${output}` : text;
      },
      endSubs() { for (const item of subs.values()) if (item.dataset.state === 'running') item.dataset.state = 'ok'; },
    };
    rows.push(row);
    list.append(li);
    row.set(state);
    return row;
  };

  return {
    el,
    lead: el.querySelector('.m-steps-lead'),
    add,
    finish(state, r) {
      const row = rows.find((x) => x.state === 'running');
      row?.set(state, r);
      if (row && r?.taskId) agentRows.set(r.taskId, row);
    },
    settle() { // the turn ended: anything still running was stopped; the list folds to its one line
      rows.filter((r) => r.state === 'running').forEach((r) => r.set('stopped'));
      if (!touched) el.open = false;
    },
  };
}

// What the coding agent does inside a task shows under that task's step, also after the turn that started it has ended.
export function agentEvent(e) {
  if (e.type === 'agent.step') agentRows.get(e.taskId)?.sub(e);
  else if (e.type === 'agent.status' && ['done', 'failed', 'aborted', 'timeout'].includes(e.task?.state)) {
    const row = agentRows.get(e.task.taskId);
    if (!row) return;
    row.endSubs();
    row.note = e.task.state === 'done' ? `Finished${e.task.summary ? `: ${e.task.summary.replace(/\s+/g, ' ').slice(0, 160)}` : ''}` : `Task ${e.task.state}${e.task.error ? `: ${e.task.error}` : ''}`;
    row.facts();
    row.li.querySelector('details.m-step').classList.remove('plain');
    agentRows.delete(e.task.taskId);
  }
}
