// The interface for the JARVIS server: target switcher (title strip) and target tag (composer), the approval dialog,
// the Server tab (connection, approvals waiting, agent tasks, digest, recent activity), reminders, and the settings card.
// Everything here reads server-link.js; nothing here talks to the network or decides anything.
import { isShown } from './models-shown.js';
import { setCodeBackend, state, onLink, serverMode, setTarget, replyGate, getSettings, saveSettings, requestDigest, fetchAudit, wakePc, abortAgentTask, dismissReminder, newConversation, isOnline, fetchModels, chooseModel } from './server-link.js';
import { reportService } from './service-status.js';
import { renderMarkdown } from './markdown.js';
import { openWidget } from './whiteboard.js';
import { setPage } from './whiteboard-mode.js';
import { prettyModelName } from './model-name.js';
import { setTasks } from './work-state.js';

const $ = (id) => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); if (dataset) Object.assign(n.dataset, dataset); n.append(...kids.filter((k) => k != null)); return n; };
const toast = (text) => document.dispatchEvent(new CustomEvent('jarvis:toast', { detail: { text } }));
const label = (id) => state.machines[id]?.label ?? (id === 'mac' ? 'Mac' : 'PC');

export { revealHidden } from '../../shared/reveal.js'; // codes for hidden characters (desktop dialog and phone sheet)
import { revealHidden, hasHidden } from '../../shared/reveal.js';

// ---- target switcher and tag ---------------------------------------------------------------------------------------
const sw = $('target-switch');
const tag = $('target-tag');
const navServer = $('nav-server');

// Model menu in server mode: the models LM Studio on the PC has installed, the loaded ones marked, the active one outlined.
// Picking one has the PC load it (the others are unloaded) and switch to that model's request settings (config/server/models.json, profiles).
// The rows carry state in attributes, not classes: shell.js re-reads the preset buttons whenever a class changes in the menu.
let switching = null;
const ctxK = (n) => (n ? ` · ${Math.round(n / 1024)}k context` : '');

async function renderModelList() {
  let box = $('model-server-list');
  if (!box) { box = document.createElement('div'); box.id = 'model-server-list'; $('model-menu').append(box); }
  const note = (text, withButton) => { const n = Object.assign(document.createElement('div'), { className: 'menu-note', textContent: text }); if (withButton) { const b = Object.assign(document.createElement('button'), { type: 'button', className: 'av-btn', textContent: 'Open the server settings' }); b.addEventListener('click', () => { $('model-menu').hidden = true; $('model-chip').setAttribute('aria-expanded', 'false'); setPage('settings'); }); n.append(b); } return n; };
  if (!box.childElementCount) box.replaceChildren(note('Asking the PC for its models...'));
  const data = await fetchModels();
  if (!data) { box.replaceChildren(note(isOnline() ? 'The PC did not answer the model list. Try again in a moment.' : 'The JARVIS server is not reachable, so there is no model to pick. Check the server address and token in Settings.', !isOnline())); return; }
  const claude = document.createElement('button');
  claude.type = 'button'; claude.className = 'matrix-btn'; claude.setAttribute('role', 'menuitem'); claude.id = 'model-claude';
  if (state.codeBackend === 'claude') claude.setAttribute('aria-current', 'true');
  claude.append(Object.assign(document.createElement('span'), { className: 'm-name', textContent: 'Claude Code' }), Object.assign(document.createElement('span'), { className: 'm-sub', textContent: 'Writes the code in Code, on your Claude subscription' }));
  claude.addEventListener('click', () => { setCodeBackend('claude'); $('model-menu').hidden = true; $('model-chip').setAttribute('aria-expanded', 'false'); paintModelChip(true); });
  box.replaceChildren(claude, ...data.models.filter((m) => isShown(m.key)).map((m) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'matrix-btn'; b.setAttribute('role', 'menuitem');
    b.dataset.loaded = String(m.loaded);
    if (m.key === data.active) b.setAttribute('aria-current', 'true');
    const name = document.createElement('span'); name.className = 'm-name'; name.textContent = prettyModelName(m.name);
    const sub = document.createElement('span'); sub.className = 'm-sub'; sub.textContent = `${m.key === data.active ? 'active, ' : ''}${m.loaded ? `loaded${ctxK(m.loadedContext)}` : 'not loaded'}`;
    b.append(name, sub);
    b.addEventListener('click', () => pickModel(m));
    return b;
  }));
}

async function pickModel(m) {
  setCodeBackend('local');
  $('model-menu').hidden = true; $('model-chip').setAttribute('aria-expanded', 'false');
  switching = prettyModelName(m.name); paintModelChip(true);
  toast(`Loading ${prettyModelName(m.name)} on the PC. This can take a minute.`);
  const r = await chooseModel(m.key);
  switching = null;
  if (r.ok && state.health?.model) Object.assign(state.health.model, { modelId: r.active, modelPresent: true, reachable: true }); // until the next health push (a few seconds)
  toast(r.ok ? `${prettyModelName(m.name)} is ready.` : `Could not switch: ${r.error}`);
  paintModelChip(true);
}

function paintModelChip(on) {
  const chipEl = $('model-chip');
  const menu = $('model-menu');
  menu.querySelectorAll('[data-preset]').forEach((b) => { b.hidden = on; });
  if (!on) {
    $('model-server-list')?.remove();
    if (chipEl.dataset.loaded !== undefined) { delete chipEl.dataset.loaded; chipEl.title = ''; $('model-chip-label').textContent = menu.querySelector('[data-preset].active-mode .m-name')?.textContent ?? 'General'; }
    return;
  }
  const m = state.health?.model;
  const name = m?.modelId ? prettyModelName(m.modelId) : isOnline() ? 'No model' : 'Server offline';
  const claudeCode = state.codeBackend === 'claude' && document.body.dataset.page === 'code';
  $('model-chip-label').textContent = switching ? `Loading ${switching}` : claudeCode ? 'Claude Code' : name;
  chipEl.dataset.loaded = switching ? 'loading' : m?.modelPresent ? 'yes' : 'no';
  chipEl.title = switching ? 'Loading on the PC' : m?.modelPresent ? 'Loaded on the PC. Click to pick another model.' : m?.reachable === false ? 'The PC cannot reach LM Studio' : 'Not loaded. Pick a model to load it.';
}
$('model-chip').addEventListener('click', () => { if (serverMode()) renderModelList(); });

function paintTarget() {
  const on = serverMode();
  paintModelChip(on);
  sw.hidden = !on;
  tag.hidden = !on;
  navServer.hidden = !on;
  if (!on) return;
  sw.dataset.link = isOnline() ? 'on' : 'off';
  sw.querySelectorAll('button').forEach((b) => {
    const id = b.dataset.target;
    b.setAttribute('aria-pressed', String(id === state.target));
    b.dataset.online = String(state.machines[id]?.online ?? false);
    b.title = `${label(id)}${state.machines[id]?.online ? '' : ' (not reachable)'}`;
  });
  tag.textContent = label(state.target).toUpperCase();
  tag.title = `JARVIS controls the ${label(state.target)}`;
}
sw.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setTarget(b.dataset.target)));

function paintService() {
  const s = getSettings();
  if (!serverMode()) { reportService('server', 'idle', s.enabled ? 'add the address and token in Settings' : 'not in use'); return; }
  if (state.status === 'online') {
    const pc = state.machines.pc?.online;
    const mac = state.machines.mac?.online;
    reportService('server', 'ok', `connected; PC ${pc ? 'up' : 'down'}, Mac ${mac ? 'up' : 'down'}`);
  } else reportService('server', state.status === 'refused' ? 'error' : 'idle', state.lastError || state.status);
}

// ---- approval dialog -------------------------------------------------------------------------------------------------
const dlg = $('gate-dialog');
const TIER = { T0: 'Read only', T1: 'Low risk', T2: 'Changes something', T3: 'Destructive or leaves the machine' };
const SOURCE = { user: 'You', voice: 'Voice', scheduled: 'A scheduled job', agent: 'The coding agent' };
let shownId = null;
// The PIN is typed once. After the server has accepted it, this window keeps it in memory only (never saved: a reload or closing the window forgets
// it) and sends it with the next risky approvals, until an hour passes without using it or Forget is pressed. The server still checks it every time.
const KEEP_MS = 60 * 60_000;
let kept = null; // { pin, at }
let trying = null; // { id, pin }: the PIN sent with the approval the server has not answered yet
const keptPin = () => (kept && Date.now() - kept.at < KEEP_MS ? kept.pin : '');

function paintGate() {
  const list = state.pending;
  if (!list.length) { if (dlg.open) dlg.close(); shownId = null; return; }
  const r = list.find((p) => p.id === shownId) ?? list[0];
  shownId = r.id;
  $('gate-target').textContent = label(r.target);
  $('gate-title').textContent = r.queued ? 'Approve a waiting action?' : 'Approve this action?';
  $('gate-count').textContent = list.length > 1 ? `${list.indexOf(r) + 1} of ${list.length}` : '';
  const summary = revealHidden(r.summary || r.action);
  $('gate-summary').textContent = r.queued ? `${summary} Waiting because nobody was connected to approve it.` : summary;
  $('gate-action').textContent = r.action;
  const tier = $('gate-tier');
  tier.textContent = `${r.tier}: ${TIER[r.tier] ?? ''}`;
  tier.dataset.tier = r.tier;
  $('gate-source').textContent = SOURCE[r.source] ?? r.source;
  const args = JSON.stringify(r.args ?? {}, null, 2);
  $('gate-args').textContent = `${revealHidden(args)}${hasHidden(args) ? '\n\nThis text contains hidden characters. They are shown as [U+....].' : ''}`;
  const dry = r.dryRun ? JSON.stringify(r.dryRun, null, 2) : '';
  $('gate-dry-wrap').hidden = !dry;
  $('gate-dry').textContent = revealHidden(dry);
  const shot = $('gate-shot');
  shot.hidden = !r.screenshot;
  if (r.screenshot) shot.src = String(r.screenshot).startsWith('data:image/') ? r.screenshot : '';
  // T3 away from the desktop on the PC needs the owner's PIN; the field is cleared for every request
  $('gate-pin-row').hidden = r.tier !== 'T3';
  const have = !!keptPin();
  $('gate-pin-row').querySelectorAll('label, #gate-pin').forEach((n) => { n.hidden = have; });
  $('gate-pin-kept').hidden = !have;
  if ($('gate-pin').dataset.for !== r.id) { $('gate-pin').value = ''; $('gate-pin').dataset.for = r.id; }
  if (!dlg.open) { dlg.showModal(); $('gate-deny').focus(); }
}
function answer(decision) {
  if (!shownId) return;
  const id = shownId;
  const r = state.pending.find((p) => p.id === id);
  if (decision !== 'approve') trying = null; // a PIN typed and then denied is never remembered
  // a T3 approval waits for the server's answer (a wrong PIN is refused and the dialog stays); everything else closes at once
  if (decision === 'approve' && r?.tier === 'T3') {
    const typed = $('gate-pin').value;
    const pin = typed || keptPin();
    trying = { id, pin };
    replyGate(id, decision, pin);
    $('gate-pin').value = '';
    // a remembered PIN the server refuses (it was changed) is dropped, and the field comes back
    if (!typed && pin) setTimeout(() => { if (state.pending.some((p) => p.id === id)) { kept = null; trying = null; paintGate(); } }, 2000);
    return;
  }
  state.pending = state.pending.filter((p) => p.id !== id);
  replyGate(id, decision);
  shownId = null;
  paintGate();
  if (state.pending.length) $('gate-deny').focus();
}
$('gate-approve').addEventListener('click', () => answer('approve'));
$('gate-pin-forget').addEventListener('click', () => { kept = null; paintGate(); $('gate-pin').focus(); });
$('gate-deny').addEventListener('click', () => answer('deny'));
dlg.addEventListener('cancel', (e) => { e.preventDefault(); answer('deny'); }); // Esc denies; it never approves

// ---- Server tab -------------------------------------------------------------------------------------------------------
const pane = $('ws-server');
let digestData = null;
const card = (title, sub, ...body) => el('section', { className: 'sys-card' }, el('h3', {}, title, sub ? el('span', { className: 'sub', textContent: sub }) : null), ...body);
const row = (k, v, st) => el('div', { className: 'srv-row' }, el('span', { className: 'k', textContent: k }), st ? el('span', { className: 'v srv-state', textContent: v, dataset: { state: st } }) : el('span', { className: 'v', textContent: v }));
const button = (text, onClick, cls = 'av-btn') => { const b = el('button', { type: 'button', className: cls, textContent: text }); b.addEventListener('click', onClick); return b; };
const ago = (ts) => { const s = Math.round((Date.now() - Date.parse(ts)) / 1000); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

function tabContent() {
  const out = [];
  const online = state.status === 'online';
  const h = state.health;
  const conn = [row('Server', online ? 'Connected' : state.status === 'connecting' ? 'Connecting' : state.status === 'refused' ? 'Refused' : 'Offline', online ? 'ok' : 'bad')];
  if (state.lastError) conn.push(el('div', { className: 'srv-banner', textContent: state.lastError }));
  if (online && h) {
    conn.push(row('Model', h.model?.reachable ? `${h.model.modelId}${h.model.modelPresent ? '' : ' (not loaded)'}` : `Not reachable${h.model?.error ? `: ${h.model.error}` : ''}`, h.model?.reachable ? 'ok' : 'bad'));
    conn.push(row('Speed', h.tokensPerSec ? `${h.tokensPerSec} tokens per second` : 'No reply yet'));
    conn.push(row('Waiting for the model', String(h.queueDepth ?? 0)));
    for (const [id, m] of Object.entries(h.machines ?? {})) conn.push(row(m.label, m.online ? 'Reachable' : 'Not reachable', m.online ? 'ok' : 'bad'));
    const mac = state.telemetry.mac;
    if (mac && !mac.offline) conn.push(row('Mac now', [mac.metrics.CPU_Load != null && `CPU ${Math.round(mac.metrics.CPU_Load)}%`, mac.metrics.Memory_Usage != null && `memory ${mac.metrics.Memory_Usage} of ${mac.metrics.Memory_Total} GB`, mac.metrics.Battery_Percent != null && `battery ${mac.metrics.Battery_Percent}%`].filter(Boolean).join(', ')));
    if (h.machines?.pc && !h.machines.pc.online) conn.push(button('Wake the PC', async () => toast((await wakePc()).message)));
  } else if (!serverMode()) conn.push(el('div', { className: 'srv-empty', textContent: 'Turn on "Use the JARVIS server" in Settings.' }));
  out.push(card('Connection', '', ...conn));

  const waiting = state.pending;
  out.push(card('Waiting for approval', waiting.length ? String(waiting.length) : '', ...(waiting.length
    ? waiting.map((p) => el('div', { className: 'srv-item' }, el('span', { textContent: revealHidden(p.summary || p.action) }), el('span', { className: 'meta', textContent: `${label(p.target)} | ${p.tier} | ${SOURCE[p.source] ?? p.source}${p.queued ? ' | queued' : ''}` }), el('div', { className: 'row' }, button('Deny', () => { replyGate(p.id, 'deny'); state.pending = state.pending.filter((x) => x.id !== p.id); paint(); }), button('Review', () => { shownId = p.id; paintGate(); }, 'av-btn primary'))))
    : [el('div', { className: 'srv-empty', textContent: 'Nothing is waiting.' })])));

  const tasks = state.agentTasks;
  out.push(card('Coding agent', tasks.length ? String(tasks.length) : '', ...(tasks.length
    ? tasks.slice(-5).reverse().map((t) => el('div', { className: 'srv-item' }, el('span', { textContent: `${label(t.target)}: ${t.state}${t.summary ? `. ${t.summary}` : ''}` }), el('span', { className: 'meta', textContent: t.taskId }), ['running', 'waiting'].includes(t.state) ? el('div', { className: 'row' }, button('Stop', () => abortAgentTask(t.taskId))) : null))
    : [el('div', { className: 'srv-empty', textContent: 'No tasks yet. Ask for code to be written and JARVIS hands it to OpenCode on the active computer.' })])));

  const dg = digestData;
  const digestBody = [];
  if (state.digest?.authError || dg?.authError) digestBody.push(el('div', { className: 'srv-banner', textContent: 'Google sign-in has expired, so the digest is missing mail and calendar. On the PC run: node scripts/google-auth.js' }));
  if (dg?.markdown) digestBody.push(el('div', { className: 'srv-md md', innerHTML: renderMarkdown(dg.markdown) }));
  else digestBody.push(el('div', { className: 'srv-empty', textContent: state.digest?.date ? `Latest digest: ${state.digest.date}.` : 'No digest yet. It runs every morning, or now.' }));
  digestBody.push(button('Run now', () => { requestDigest(); toast('Digest requested.'); }));
  out.push(card('Digest', dg?.date ?? state.digest?.date ?? '', ...digestBody));

  if (state.reminders.length) out.push(card('Reminders you missed', String(state.reminders.length), ...state.reminders.map((r) => el('div', { className: 'srv-item' }, el('span', { textContent: r.text }), el('span', { className: 'meta', textContent: r.when }), el('div', { className: 'row' }, button('Dismiss', () => { dismissReminder(r.id); state.reminders = state.reminders.filter((x) => x.id !== r.id); paint(); }))))));

  out.push(card('Recent activity', '', ...(state.audit.length
    ? state.audit.slice(-12).reverse().map((a) => el('div', { className: 'srv-item' }, el('span', { textContent: `${a.action ?? a.component}${a.target ? ` on ${label(a.target)}` : ''}: ${a.decision ?? ''}${a.outcome ? `, ${String(a.outcome).slice(0, 80)}` : ''}` }), el('span', { className: 'meta', textContent: `${ago(a.ts)} | ${a.tier ?? ''} | ${a.source ?? ''}` })))
    : [el('div', { className: 'srv-empty', textContent: 'Nothing recorded yet.' })])));
  return out;
}

let queued = 0;
function paint() {
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    paintTarget();
    paintService();
    paintSettingsStatus();
    if (!pane.hidden) pane.replaceChildren(...tabContent());
  });
}

async function refreshTab() {
  if (pane.hidden || !serverMode() || !isOnline()) return;
  fetchAudit(15);
  try {
    const s = getSettings();
    const base = s.url.trim().replace(/^ws/i, 'http').replace(/\/ws$/, '').replace(/\/+$/, '');
    const res = await fetch(`${base}/api/digest`, { headers: { authorization: `Bearer ${s.token}` } });
    if (res.ok) { const j = await res.json(); digestData = j.error ? null : j; paint(); }
  } catch { /* the tab keeps what it has */ }
}
// The Server tab polls only while it is on screen.
let pollTimer = 0;
new MutationObserver(() => {
  if (!pane.hidden) { paint(); refreshTab(); pollTimer ||= setInterval(refreshTab, 10_000); } else { clearInterval(pollTimer); pollTimer = 0; }
}).observe(pane, { attributes: true, attributeFilter: ['hidden'] });
navServer.addEventListener('click', () => openWidget('server'));

// ---- reminders -------------------------------------------------------------------------------------------------------
let audio = null;
function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.4);
  } catch { /* audio blocked: the toast still shows */ }
}

// ---- settings card ---------------------------------------------------------------------------------------------------
const f = { enabled: $('srv-enabled'), url: $('srv-url'), token: $('srv-token'), mac: $('srv-mac'), status: $('srv-status') };
function fillSettings() { const s = getSettings(); f.enabled.checked = s.enabled; f.url.value = s.url; f.token.value = s.token; f.mac.value = s.pcMac; }
function paintSettingsStatus() {
  f.status.textContent = !getSettings().enabled ? 'Off' : state.status === 'online' ? 'Connected' : state.status === 'connecting' ? 'Connecting...' : state.status === 'refused' ? state.lastError : 'Not connected. Retrying.';
}
// Pairing this window: the code from the PC (node scripts/devices.js pair desktop, or Add device on a paired desktop). The device token
// comes back once in the answer body and is kept in this window's settings.
$('srv-pair').addEventListener('click', async () => {
  const base = f.url.value.trim().replace(/^ws/i, 'http').replace(/\/ws$/, '').replace(/\/+$/, '');
  f.status.textContent = 'Pairing...';
  const r = await fetch(`${base}/api/devices/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('srv-code').value, name: 'desktop window' }) }).then((x) => x.json()).catch(() => ({ error: 'the server did not answer' }));
  if (!r.token) { f.status.textContent = `Not paired: ${r.error ?? 'try again'}`; return; }
  $('srv-code').value = '';
  f.token.value = r.token;
  saveSettings({ enabled: true, url: f.url.value.trim(), token: r.token, pcMac: f.mac.value.trim() });
  f.enabled.checked = true;
  paint();
});
$('srv-save').addEventListener('click', () => {
  saveSettings({ enabled: f.enabled.checked, url: f.url.value.trim(), token: f.token.value.trim(), pcMac: f.mac.value.trim() });
  paint();
});
fillSettings();

// The Code page's task list shows what the coding agent (OpenCode) is doing on the active computer.
const TASK_STATUS = { queued: 'todo', running: 'doing', done: 'done' };
function showCodingTasks() {
  if (!serverMode()) return;
  setTasks(state.agentTasks.slice(-8).map((t) => ({ text: `${t.prompt || t.taskId}${t.state === 'failed' || t.state === 'aborted' ? ` (${t.state})` : ''}`, status: TASK_STATUS[t.state] ?? 'done' })));
}

// ---- events ----------------------------------------------------------------------------------------------------------
onLink((e) => {
  switch (e.type) {
    case 'gate.request': case 'gate.queued': case 'state': paintGate(); break;
    case 'gate.resolved': if (trying && e.id === trying.id) { if (trying.pin) kept = { pin: trying.pin, at: Date.now() }; trying = null; } if (e.id === shownId) { shownId = null; } paintGate(); break;
    case 'target': if (e.rejected) toast(`The server kept the ${label(state.target)}: ${e.reason}`); break;
    case 'reminder.fire': toast(`Reminder: ${e.text}`); beep(); break;
    case 'digest.ready': toast('Your digest is ready.'); refreshTab(); break;
    case 'digest.error': toast(`Digest problem: ${e.reason}`); break;
    case 'auth.banner': digestData = { ...(digestData ?? {}), authError: true }; break;
    case 'server-error': toast(e.reason); break;
    case 'security.alert': toast(`Security: ${e.reason}`); break;
    default: break;
  }
  if (e.type === 'state' || e.type === 'agent.status') showCodingTasks();
  paint();
});
document.addEventListener('jarvis:cleared', () => { if (serverMode()) newConversation(); });
paint();
document.addEventListener('jarvis:page', () => paintModelChip(serverMode()));
