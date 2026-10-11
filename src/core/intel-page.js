// The Intel page's Playwright tab: a live view of the sidecar's Chrome page. Click and scroll on the picture,
// type while it is focused, use the address bar. The same page is what the model's browser_* actions drive.
import { ensureBrowser, openUrl, doAction, health, shot } from './browser-client.js';
import { currentPage } from './whiteboard-mode.js';

const $ = (id) => document.getElementById(id);
const view = $('pw-view');
const img = $('pw-img');
const empty = $('pw-empty');
const url = $('pw-url');
const status = $('pw-status');
const VIEW = { width: 1280, height: 800 };

let running = false;
let busy = false;
let lastSrc = '';

const say = (text, bad = false) => { status.textContent = text; status.dataset.bad = bad ? '' : null; if (!bad) delete status.dataset.bad; };

function show(frame) {
  running = !!frame;
  img.hidden = !frame;
  empty.hidden = !!frame;
  $('pw-close').hidden = !frame;
  if (!frame) return;
  img.src = frame.src;
  if (lastSrc) URL.revokeObjectURL(lastSrc);
  lastSrc = frame.src;
  if (document.activeElement !== url) url.value = frame.url;
  say(frame.title ? `${frame.title}  |  ${frame.url}` : frame.url);
}

async function refresh() {
  if (busy || currentPage() !== 'intel' || document.hidden) return;
  busy = true;
  try { const f = await shot(); if (f !== undefined) show(f); } catch { /* sidecar not started yet: nothing to show */ } finally { busy = false; }
}

async function guarded(fn) {
  say('Working...');
  try { await flush(); await fn(); } catch (e) { say(e.message ?? String(e), true); return; }
  await refresh();
}

$('pw-go').addEventListener('click', () => { const v = url.value.trim(); if (v) guarded(() => openUrl(v)); });
url.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('pw-go').click(); });
$('pw-back').addEventListener('click', () => guarded(() => doAction({ type: 'back' })));
$('pw-forward').addEventListener('click', () => guarded(() => doAction({ type: 'forward' })));
$('pw-reload').addEventListener('click', () => guarded(() => doAction({ type: 'reload' })));
$('pw-close').addEventListener('click', async () => { try { await doAction({ type: 'close' }); } catch { /* already gone */ } show(null); say(''); });

// picture coordinates to page coordinates
const point = (e) => {
  const r = img.getBoundingClientRect();
  return { x: Math.round(((e.clientX - r.left) / r.width) * VIEW.width), y: Math.round(((e.clientY - r.top) / r.height) * VIEW.height) };
};
img.addEventListener('click', (e) => { view.focus(); guarded(() => doAction({ type: 'click', ...point(e) })); });
view.addEventListener('wheel', (e) => { if (!running || e.ctrlKey) return; e.preventDefault(); doAction({ type: 'scroll', dy: e.deltaY }).then(refresh).catch(() => {}); }, { passive: false });

// Letters typed within 80 ms of each other go out as one request, in order.
let typed = '';
let typeTimer = 0;
async function flush() {
  clearTimeout(typeTimer);
  const text = typed;
  typed = '';
  if (text) await doAction({ type: 'type', text }).catch(() => {});
}

const SPECIAL = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
view.addEventListener('keydown', (e) => {
  if (!running || e.ctrlKey || e.metaKey || e.altKey) return;
  if (SPECIAL.has(e.key)) flush().then(() => doAction({ type: 'press', key: e.key })).then(refresh).catch(() => {});
  else if (e.key.length === 1) { typed += e.key; clearTimeout(typeTimer); typeTimer = setTimeout(() => flush().then(refresh), 80); }
  else return;
  e.preventDefault();
  e.stopPropagation();
});

// start the sidecar when the page is first shown, then follow the page about twice a second
let started = false;
document.addEventListener('jarvis:page', async () => {
  if (currentPage() !== 'intel' || started) return;
  started = true;
  say('Starting the browser...');
  try { await ensureBrowser(); const h = await health(); say(h.running ? h.url : 'Ready'); } catch (e) { started = false; say(e.message ?? String(e), true); }
  refresh();
});
setInterval(refresh, 400);
