// The Background tasks tab: what runs without you watching. Each task has an icon for what it is:
//   terminal = the coding agent (it works in a terminal: edits files, runs commands)    bell = a reminder
//   mail = the morning digest                                                           globe = a task in the browser
// A running task shows how long it has run and a Stop button. The checklist the agent keeps (set_tasks) sits under the list.
import { state, serverMode, abortAgentTask, onLink, dismissReminder } from './server-link.js';
import { icon } from '../icons/index.js';
import { $, el, onTabPaint } from './panel-ui.js';

const FINAL = new Set(['done', 'failed', 'aborted', 'cancelled', 'completed']);
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};
const kindOf = (t) => (/\b(browser|website|web page|open the page|chrome)\b/i.test(t.prompt ?? '') ? 'globe' : 'terminal');

function item(iconName, title, meta, state, action) {
  const r = el('div', { className: 'bg-item' });
  r.dataset.state = state;
  r.append(el('span', { className: 'bg-icon', innerHTML: icon(iconName, { size: 18 }) }), el('span', { className: 'bg-main' }, el('span', { className: 'bg-title', textContent: title }), el('span', { className: 'bg-meta', textContent: meta })));
  r.append(action ?? el('span', { className: 'bg-state', textContent: state }));
  return r;
}

function paint() {
  const box = $('bg-list');
  if (!serverMode()) { box.replaceChildren(el('div', { className: 'info-note', textContent: 'Background tasks run on the JARVIS server. Turn it on in Settings.' })); $('bg-count').textContent = ''; return; }
  const items = [];
  const tasks = (state.agentTasks ?? []).slice().sort((a, b) => Date.parse(b.startedAt ?? b.createdAt ?? 0) - Date.parse(a.startedAt ?? a.createdAt ?? 0));
  let running = 0;
  for (const t of tasks.slice(0, 12)) {
    const live = !FINAL.has(t.state);
    if (live) running += 1;
    let action = null;
    if (live) {
      action = el('button', { type: 'button', className: 'av-btn', textContent: 'Stop', title: 'Stop this task' });
      action.addEventListener('click', () => abortAgentTask(t.taskId));
    }
    const when = t.startedAt ? (live ? `running for ${ago(t.startedAt)}` : t.endedAt ? `${Math.max(1, Math.round((Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 1000))} s` : '') : '';
    items.push(item(kindOf(t), t.prompt || t.taskId, [t.target ? t.target.toUpperCase() : null, when, !live && t.error ? t.error : null].filter(Boolean).join('  ·  '), t.state, action));
  }
  for (const r of state.reminders ?? []) {
    const dismiss = el('button', { type: 'button', className: 'av-btn', textContent: 'Dismiss' });
    dismiss.addEventListener('click', () => { dismissReminder(r.id); state.reminders = state.reminders.filter((x) => x.id !== r.id); paint(); });
    items.push(item('bell', r.text, `missed  ·  ${r.when}`, 'missed', dismiss));
  }
  if (state.digest?.date) items.push(item('mail', 'Morning digest', `last one ${state.digest.date}`, 'scheduled', null));
  $('bg-count').textContent = running ? `${running} running` : '';
  box.replaceChildren(...(items.length ? items : [el('div', { className: 'info-note', textContent: 'Nothing running. The coding agent, reminders and the morning digest are listed here.' })]));
}

const tab = onTabPaint('tasks', paint);
onLink(tab.poke);
setInterval(() => { if (tab.isActive() && (state.agentTasks ?? []).some((t) => !FINAL.has(t.state))) tab.poke(); }, 1000); // the running time ticks only while a task runs and the tab is open
