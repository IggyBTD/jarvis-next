// The Scheduled page: what runs by itself (the morning digest, reminders, the coding agent's background tasks). The data is the
// JARVIS server's, so without it the page says so. Customize is plain markup in index.html and is wired by shell.js.
import { state, serverMode, requestDigest, onLink, dismissReminder } from './server-link.js';
import { currentPage } from './whiteboard-mode.js';

const root = document.getElementById('sched-root');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const card = (title, ...kids) => el('div', { className: 'set-card' }, el('h2', { textContent: title }), ...kids);
const line = (k, v) => el('div', { className: 'set-row' }, el('span', { textContent: k }), el('span', { className: 'does', textContent: v }));
const act = (text, fn) => { const b = el('button', { type: 'button', className: 'av-btn', textContent: text }); b.addEventListener('click', fn); return b; };

function paint() {
  if (currentPage() !== 'scheduled') return;
  const head = el('h1', { textContent: 'Scheduled' });
  if (!serverMode()) {
    root.replaceChildren(head, el('div', { className: 'empty-note', textContent: 'Scheduled work runs on the JARVIS server. Turn the server on in Settings to see the morning digest, reminders and background tasks here.' }));
    return;
  }
  const d = state.digest;
  const tasks = (state.agentTasks ?? []).slice(-8).reverse();
  const reminders = state.reminders ?? [];
  root.replaceChildren(
    head,
    card('Morning digest', line('Last one', d?.date ? `${d.date}${d.at ? ` at ${d.at}` : ''}` : 'none yet'), el('div', { className: 'set-row' }, el('span', { className: 'does', textContent: 'Calendar, mail and the night\'s sensor readings in one page.' }), act('Run now', () => requestDigest()))),
    card('Reminders you missed', ...(reminders.length ? reminders.map((r) => el('div', { className: 'set-row' }, el('span', { textContent: r.text }), el('span', { className: 'does', textContent: r.when }), act('Dismiss', () => { dismissReminder(r.id); state.reminders = state.reminders.filter((x) => x.id !== r.id); paint(); }))) : [el('div', { className: 'set-row' }, el('span', { className: 'does', textContent: 'None.' }))])),
    card('Background tasks', ...(tasks.length ? tasks.map((t) => line(t.prompt || t.taskId, t.state)) : [el('div', { className: 'set-row' }, el('span', { className: 'does', textContent: 'The coding agent has nothing running.' }))])),
  );
}

document.addEventListener('jarvis:page', paint);
onLink(paint);
paint();
