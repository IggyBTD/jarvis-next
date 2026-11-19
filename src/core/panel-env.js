// The Environment tab: the computer JARVIS is working on, its working folder, the git branch of that folder, and the remote control.
import { serverFetch, serverMode, state, onLink } from './server-link.js';
import { el } from './panel-ui.js';
import { $, row, note, fill, onTabPaint } from './panel-ui.js';

// the last part of a path: the folder's name (the full path stays in the row's tooltip)
const leaf = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() ?? p : '--');

let env = null;
let at = 0;
let asking = false;

async function load() {
  if (!serverMode() || asking || Date.now() - at < 4000) return;
  asking = true;
  try { const r = await serverFetch('/environment'); env = r.ok ? await r.json() : null; } catch { env = null; }
  at = Date.now();
  asking = false;
  paint();
}

function paint() {
  const server = serverMode();
  if (!server) {
    $('env-sum').textContent = '';
    fill('env-pc', [row('Computer', 'This computer', 'ok'), row('Model server', 'LM Studio on this PC')]);
    fill('env-folder', [note('Shown when the JARVIS server is on.')]);
    fill('env-branch', [note('Shown when the JARVIS server is on.')]);
    fill('env-remote', [row('Remote control', 'needs the JARVIS server', 'idle')]);
    return;
  }
  const m = state.machines?.[state.target];
  $('env-sum').textContent = env?.project ? leaf(env.project) : '';
  $('env-pc-title').textContent = env?.label ? `This ${env.label}` : 'This computer';
  fill('env-pc', env ? [row('Hostname', env.hostname ?? '--', m?.online ? 'ok' : 'bad'), row('Computer', env.label), row('System', env.os ?? '--'), row('User', env.user ?? '--')] : [note(state.status === 'online' ? 'Asking the PC...' : 'The server is not reachable.')]);
  const change = el('button', { type: 'button', className: 'link-btn', textContent: 'Change', title: 'Pick the project folder the branch is read from' });
  change.addEventListener('click', async () => {
    const folder = prompt('Project folder (on the PC), for example C:\\Users\\you\\my-project', env?.project ?? '');
    if (!folder?.trim()) return;
    const r = await serverFetch('/project', { method: 'POST', body: JSON.stringify({ folder: folder.trim() }) }).catch(() => null);
    if (!r?.ok) document.dispatchEvent(new CustomEvent('jarvis:toast', { detail: { text: (await r?.json().catch(() => null))?.error ?? 'Could not set the folder.' } }));
    at = 0; load();
  });
  const projectRow = row('Project', leaf(env?.project));
  projectRow.title = env?.project ?? '';
  if (env && env.machine === 'pc') projectRow.append(change);
  const folderRow = row('Working folder', leaf(env?.folder));
  folderRow.title = env?.folder ?? '';
  fill('env-folder', env ? [folderRow, ...(env.project || env.machine === 'pc' ? [projectRow] : [])] : [note('--')]);
  const branch = !env ? [note('--')]
    : env.repo === true ? [row('Current', env.branch ?? '--'), ...(env.dirty == null ? [] : [row('Uncommitted', env.dirty ? `${env.dirty} file${env.dirty === 1 ? '' : 's'}` : 'clean')])]
      : env.repo === false ? [note('The working folder is not a git repository.')]
        : [note('The branch of the other computer is not read from here.')];
  fill('env-branch', branch);
  const r = env?.remote;
  fill('env-remote', [row('Status', r?.on === false ? 'off' : 'on', r?.on === false ? 'idle' : 'ok'), ...(r?.url ? [row('Address', r.url)] : []), ...(r ? [row('Devices connected', String(r.devices ?? 0))] : [])]);
}

const tab = onTabPaint('env', () => { paint(); load(); });
onLink((e) => { if (e?.type === 'target' || e?.type === 'state') { at = 0; env = null; } tab.poke(); });
setInterval(() => { if (tab.isActive()) tab.poke(); }, 10000);
