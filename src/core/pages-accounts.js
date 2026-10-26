// The Accounts page: the services JARVIS can be connected to, with as many accounts of each as you like (personal, school, work).
// Sign-in is not wired yet: an added account is saved on this device as "waiting for sign-in" and connects once a provider's
// OAuth client id is put in PROVIDERS below (clientId). Nothing leaves the device until then.
import { currentPage } from './whiteboard-mode.js';

const KEY = 'jarvis.accounts';
const KINDS = ['Personal', 'School', 'Work'];
// clientId: null = OAuth not set up yet. `gives` is what the account would be used for.
export const PROVIDERS = [
  { id: 'google', name: 'Google', gives: 'Gmail, Calendar, Drive', clientId: null },
  { id: 'microsoft', name: 'Microsoft', gives: 'Outlook, Calendar, OneDrive, Teams', clientId: null },
  { id: 'apple', name: 'Apple', gives: 'iCloud Mail, Calendar, Drive', clientId: null },
  { id: 'github', name: 'GitHub', gives: 'Repositories, issues, pull requests', clientId: null },
  { id: 'slack', name: 'Slack', gives: 'Channels and messages', clientId: null },
  { id: 'notion', name: 'Notion', gives: 'Pages and databases', clientId: null },
  { id: 'dropbox', name: 'Dropbox', gives: 'Files', clientId: null },
];

const root = document.getElementById('acct-root');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: the list lasts until the page closes */ } };
let accounts = load();
let adding = null; // provider id whose form is open

function form(p) {
  const kind = el('select', { className: 'av-select', ariaLabel: 'Account type' }, ...KINDS.map((k) => el('option', { value: k, textContent: k })));
  const email = el('input', { type: 'email', className: 'av-input', placeholder: 'Email or username (optional)', ariaLabel: 'Email or username' });
  const name = el('input', { type: 'text', className: 'av-input', placeholder: 'Name, e.g. University', ariaLabel: 'Account name' });
  const ok = el('button', { type: 'button', className: 'av-btn', textContent: 'Add account' });
  const no = el('button', { type: 'button', className: 'av-btn', textContent: 'Cancel' });
  ok.addEventListener('click', () => {
    accounts = [...accounts, { id: `${p.id}-${Date.now().toString(36)}`, provider: p.id, kind: kind.value, name: name.value.trim() || kind.value, email: email.value.trim(), added: Date.now() }];
    save(accounts); adding = null; paint();
  });
  no.addEventListener('click', () => { adding = null; paint(); });
  return el('div', { className: 'acct-form' }, kind, name, email, ok, no);
}

function account(a, p) {
  const rm = el('button', { type: 'button', className: 'av-btn danger', textContent: 'Remove', ariaLabel: `Remove ${a.name}` });
  rm.addEventListener('click', () => { accounts = accounts.filter((x) => x.id !== a.id); save(accounts); paint(); });
  return el('div', { className: 'set-row' },
    el('span', {}, el('b', { textContent: a.name }), el('span', { className: 'acct-kind', textContent: a.kind }), a.email ? el('span', { className: 'does', textContent: ` ${a.email}` }) : ''),
    el('span', { className: 'does', textContent: p.clientId ? 'Connected' : 'Waiting for sign-in setup' }), rm);
}

function paint() {
  if (currentPage() !== 'accounts') return;
  const cards = PROVIDERS.map((p) => {
    const mine = accounts.filter((a) => a.provider === p.id);
    const add = el('button', { type: 'button', className: 'av-btn', textContent: mine.length ? 'Add another account' : 'Add account' });
    add.addEventListener('click', () => { adding = p.id; paint(); });
    return el('div', { className: 'set-card' },
      el('div', { className: 'acct-head' }, el('span', { className: 'acct-mark', textContent: p.name[0] }), el('div', {}, el('h2', { textContent: p.name }), el('p', { textContent: p.gives })), el('span', { className: 'grow' }), adding === p.id ? '' : add),
      ...mine.map((a) => account(a, p)), adding === p.id ? form(p) : '');
  });
  root.replaceChildren(el('h1', { textContent: 'Accounts' }), el('p', { className: 'hint', textContent: 'Connect as many accounts as you need: personal, school or work. Sign-in is not set up yet, so accounts you add are kept on this device and connect once it is.' }), ...cards);
}

document.addEventListener('jarvis:page', paint);
