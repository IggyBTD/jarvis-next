// The Outputs tab: every file JARVIS gave you in this session, sorted by type. Each type is a folder you can fold; a click on a file
// shows its raw code (with a Copy button, and for an artifact a button that opens it as a tab). Artifacts and files the agent
// created or wrote are listed; a file the agent only edited is in Changes.
import { listArtifacts, onArtifactsChange } from './artifacts.js';
import { fileNameFor, openArtifact } from './whiteboard.js';
import { highlightCode } from './markdown.js';
import { changedFiles } from './cli-page.js';
import { icon } from '../icons/index.js';
import { $, el, onTabPaint } from './panel-ui.js';

const TYPES = { html: 'HTML pages', svg: 'SVG images', md: 'Markdown', mmd: 'Mermaid diagrams', json: 'JSON', txt: 'Text', css: 'CSS', js: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript', py: 'Python', rs: 'Rust', sh: 'Shell', ps1: 'PowerShell', csv: 'CSV' };
const HLJS = { html: 'xml', svg: 'xml', md: 'markdown', mmd: '', json: 'json', txt: '', css: 'css', js: 'javascript', mjs: 'javascript', ts: 'typescript', py: 'python', rs: 'rust', sh: 'bash', ps1: 'powershell', csv: '' };
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : 'txt');

function files() {
  const out = listArtifacts().map((a) => {
    const name = fileNameFor(a);
    const v = a.versions.at(-1);
    return { key: `a:${a.id}`, name, ext: extOf(name), content: v.content, at: v.time, note: a.versions.length > 1 ? `${a.versions.length} versions` : null, artifactId: a.id };
  });
  for (const f of changedFiles()) {
    if (f.kind === 'EDIT') continue;
    const name = f.path.split(/[\\/]/).pop();
    out.push({ key: `f:${f.path}`, name, ext: extOf(name), content: f.after ?? '', at: Date.now(), note: f.path.includes('/') || f.path.includes('\\') ? f.path : null, artifactId: null });
  }
  return out;
}

const folded = new Set(); // type folders the person closed
let viewing = null;      // key of the file open in the viewer

function listView() {
  const all = files();
  $('out-count').textContent = String(all.length);
  const box = $('out-list');
  if (!all.length) { box.replaceChildren(el('div', { className: 'info-note', textContent: 'Nothing yet. Ask for a page, a chart, a diagram, a document or a script and it is listed here, sorted by type.' })); return; }
  const groups = new Map();
  for (const f of all) { if (!groups.has(f.ext)) groups.set(f.ext, []); groups.get(f.ext).push(f); }
  box.replaceChildren(...[...groups].sort((a, b) => (TYPES[a[0]] ?? a[0]).localeCompare(TYPES[b[0]] ?? b[0])).map(([ext, items]) => {
    const d = el('details', { className: 'out-group' });
    d.open = !folded.has(ext);
    d.addEventListener('toggle', () => { if (d.open) folded.delete(ext); else folded.add(ext); });
    d.append(el('summary', {}, el('span', { className: 'out-type', textContent: TYPES[ext] ?? `.${ext}` }), el('span', { className: 'out-n', textContent: String(items.length) })));
    items.sort((a, b) => b.at - a.at).forEach((f) => {
      const b = el('button', { type: 'button', className: 'out-file', title: f.note ?? f.name });
      b.innerHTML = icon('file', { size: 16 });
      b.append(el('span', { className: 'out-fname', textContent: f.name }), el('span', { className: 'out-fnote', textContent: f.note && !f.note.includes('/') && !f.note.includes('\\') ? f.note : '' }));
      b.addEventListener('click', () => show(f));
      d.append(b);
    });
    return d;
  }));
}

function show(f) {
  viewing = f.key;
  $('out-list-view').hidden = true;
  $('out-viewer').hidden = false;
  $('out-name').textContent = f.name;
  const pre = el('pre', { className: 'wb-source' });
  const code = el('code', { className: 'hljs' });
  code.innerHTML = highlightCode(f.content, HLJS[f.ext] ?? '');
  pre.append(code);
  $('out-body').replaceChildren(pre);
  $('out-body').scrollTop = 0;
  // an artifact can also open as a tab with its preview
  $('out-viewer').querySelector('.out-open')?.remove();
  if (f.artifactId) {
    const b = el('button', { type: 'button', className: 'av-btn av-act out-open', title: 'Open it as a tab with its preview' });
    b.innerHTML = `${icon('artifacts', { size: 16 })}<span>Open as tab</span>`;
    b.addEventListener('click', () => openArtifact(f.artifactId));
    $('out-copy').before(b);
  }
  $('out-copy').onclick = async () => {
    let ok = true;
    try { await navigator.clipboard.writeText(f.content); } catch { ok = false; }
    const label = $('out-copy').querySelector('span:not(.icon)');
    label.textContent = ok ? 'Copied' : 'Failed';
    setTimeout(() => { label.textContent = 'Copy'; }, 1200);
  };
}

function back() { viewing = null; $('out-viewer').hidden = true; $('out-list-view').hidden = false; listView(); }
$('out-back').addEventListener('click', back);

const tab = onTabPaint('outputs', () => { if (!viewing) listView(); });
onArtifactsChange(tab.poke);
document.addEventListener('jarvis:changes', tab.poke);
