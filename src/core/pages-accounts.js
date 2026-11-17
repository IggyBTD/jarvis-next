// The Accounts page: the services JARVIS can be connected to, with as many accounts of each as you like (personal, school, work).
// Google and Microsoft sign in through the server (server/accounts/*-accounts.js): Connect opens the consent page in the browser.
// The other providers are not wired yet: an added account is saved on this device as "waiting for sign-in".
import { currentPage } from './whiteboard-mode.js';
import { serverFetch } from './server-link.js';
import { BRAND } from './brand-icons.js';

const KEY = 'jarvis.accounts';
const KINDS = ['Personal', 'School', 'Work'];
// clientId: null = OAuth not set up yet. `gives` is what the account would be used for.
export const PROVIDERS = [
  { id: 'google', name: 'Google', gives: 'Gmail, Calendar, Drive (read only)', clientId: null },
  { id: 'microsoft', name: 'Microsoft', gives: 'Outlook, Calendar, OneDrive (read only)', clientId: null },
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
let remote = []; // Google and Microsoft accounts, kept by the server (tokens never reach this window)
let notice = ''; // why the last Connect did not start
let poll = null;
const isRemote = (p) => p.id === 'google' || p.id === 'microsoft';
const STATUS = { connected: 'Connected', pending: 'Waiting for you to approve in the browser', error: 'Sign-in failed' };

async function loadRemote() {
  try {
    const both = await Promise.all(['google', 'microsoft'].map(async (id) => ((await (await serverFetch(`/accounts/${id}`)).json()).accounts ?? []).map((a) => ({ ...a, provider: id }))));
    remote = both.flat();
  } catch { remote = []; }
  const wait = remote.some((a) => a.status === 'pending');
  if (wait && !poll) poll = setInterval(async () => { await loadRemote(); }, 2000);
  if (!wait && poll) { clearInterval(poll); poll = null; }
  paint();
}

// Asks the server for the provider's consent link and opens it in the default browser; the server catches the redirect.
// tab: a blank tab opened straight from the click (a browser only allows a new tab from a click, not after the wait for the server)
async function connectRemote(provider, kind, name, tab = null) {
  notice = '';
  try {
    const res = await serverFetch(`/accounts/${provider}/start`, { method: 'POST', body: JSON.stringify({ kind, name }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? 'could not start sign-in');
    if (window.__TAURI_INTERNALS__) await (await import('@tauri-apps/api/core')).invoke('open_signin', { url: j.url });
    else if (tab && !tab.closed) tab.location.href = j.url;
    else if (!window.open(j.url, '_blank')) notice = 'The browser blocked the sign-in tab. Allow pop-ups for this page and try again.';
  } catch (e) { tab?.close(); notice = e.message; }
  await loadRemote();
}

function form(p) {
  const kind = el('select', { className: 'av-select', ariaLabel: 'Account type' }, ...KINDS.map((k) => el('option', { value: k, textContent: k })));
  const email = el('input', { type: 'email', className: 'av-input', placeholder: 'Email or username (optional)', ariaLabel: 'Email or username' });
  if (isRemote(p)) email.hidden = true; // Google tells us the address after sign-in
  const name = el('input', { type: 'text', className: 'av-input', placeholder: 'Name, e.g. University', ariaLabel: 'Account name' });
  const ok = el('button', { type: 'button', className: 'av-btn', textContent: isRemote(p) ? 'Connect in browser' : 'Add account' });
  const no = el('button', { type: 'button', className: 'av-btn', textContent: 'Cancel' });
  ok.addEventListener('click', () => {
    if (isRemote(p)) { adding = null; connectRemote(p.id, kind.value, name.value.trim(), window.__TAURI_INTERNALS__ ? null : window.open('about:blank', '_blank')); return; }
    accounts = [...accounts, { id: `${p.id}-${Date.now().toString(36)}`, provider: p.id, kind: kind.value, name: name.value.trim() || kind.value, email: email.value.trim(), added: Date.now() }];
    save(accounts); adding = null; paint();
  });
  no.addEventListener('click', () => { adding = null; paint(); });
  return el('div', { className: 'acct-form' }, kind, name, email, ok, no);
}

function account(a, p) {
  const rm = el('button', { type: 'button', className: 'av-btn danger', textContent: 'Remove', ariaLabel: `Remove ${a.name}` });
  rm.addEventListener('click', async () => {
    if (isRemote(p)) { await serverFetch(`/accounts/${p.id}/${a.id}`, { method: 'DELETE' }).catch(() => {}); return loadRemote(); }
    accounts = accounts.filter((x) => x.id !== a.id); save(accounts); paint();
  });
  return el('div', { className: 'acct-row' },
    el('span', { className: 'acct-who' }, el('b', { textContent: a.name }), el('span', { className: 'acct-kind', textContent: a.kind })),
    ...(a.email ? [el('span', { className: 'does', textContent: a.email })] : []),
    el('span', { className: 'does', textContent: isRemote(p) ? (a.status === 'error' && a.error ? a.error : STATUS[a.status] ?? '') : p.clientId ? 'Connected' : 'Waiting for sign-in setup' }), rm);
}

// the service's logo. Google, Microsoft, Slack and Dropbox use their own colour logo (src/assets/brands, from the Iconify "logos"
// set); Apple, GitHub and Notion are black or white by design, so they stay in the text colour and work in both themes.
const COLOUR = { google: 'google', microsoft: 'microsoft', slack: 'slack', dropbox: 'dropbox' };
const logo = (id) => new URL(`../assets/brands/${COLOUR[id]}.svg`, import.meta.url).href;
function mark(p) {
  if (COLOUR[p.id]) return el('span', { className: 'acct-mark' }, el('img', { src: logo(p.id), alt: '', width: 24, height: 24 }));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', BRAND[p.id]);
  svg.append(path);
  return el('span', { className: 'acct-mark' }, svg);
}

function paint() {
  if (currentPage() !== 'accounts') return;
  const cards = PROVIDERS.map((p) => {
    const mine = isRemote(p) ? remote.filter((a) => a.provider === p.id) : accounts.filter((a) => a.provider === p.id);
    const add = el('button', { type: 'button', className: 'av-btn', textContent: mine.length ? 'Add another account' : 'Add account' });
    add.addEventListener('click', () => { adding = p.id; paint(); });
    return el('div', { className: 'set-card acct-card' },
      el('div', { className: 'acct-head' }, mark(p), el('h2', { textContent: p.name }), el('p', { textContent: p.gives })),
      el('div', { className: 'acct-list' }, ...mine.map((a) => account(a, p))), adding === p.id ? form(p) : el('div', { className: 'acct-foot' }, add));
  });
  root.replaceChildren(el('h1', { textContent: 'Accounts' }), el('p', { className: 'hint', textContent: 'Connect as many accounts as you need: personal, school or work. Google and Microsoft connect through your browser: approve access there and it shows up here. The other services are not connected yet, so accounts you add for them are only kept on this device.' }), ...(notice ? [el('p', { className: 'hint', role: 'alert', textContent: notice })] : []), el('div', { className: 'acct-grid' }, ...cards));
}

document.addEventListener('jarvis:page', () => { paint(); if (currentPage() === 'accounts') loadRemote(); });
