// Ctrl+L: a small pad where you type maths the way Desmos lets you ("x^2/2 + sqrt(x)", "pi r^2") and see it typeset as you
// type. Enter copies the LaTeX (and puts it between $ signs into the message field if you came from there). If what you typed
// is words ("integral of x squared from 0 to 1") the first Enter asks the model, the second one copies.
import katex from 'katex';
import { toLatex, cleanLatex } from '../../shared/latex.js';
import { serverMode, serverFetch } from './server-link.js';

let dlg;
let field;
let preview;
let code;
let hint;
let from = null;       // the element that had focus before the pad opened
let modelResult = null; // { typed, latex }: what the model made for exactly this text
let busy = false;

function build() {
  dlg = Object.assign(document.createElement('dialog'), { id: 'latex-pad' });
  dlg.setAttribute('aria-label', 'Type maths');
  field = Object.assign(document.createElement('input'), { className: 'set-input latex-in', type: 'text', spellcheck: false, autocomplete: 'off', placeholder: 'x^2/2 + sqrt(x)   or   integral of x squared from 0 to 1' });
  field.setAttribute('aria-label', 'Maths to typeset');
  preview = Object.assign(document.createElement('div'), { className: 'latex-preview' });
  preview.setAttribute('aria-live', 'polite');
  code = Object.assign(document.createElement('code'), { className: 'latex-code' });
  hint = Object.assign(document.createElement('div'), { className: 'latex-hint' });
  dlg.append(field, preview, code, hint);
  document.body.append(dlg);
  field.addEventListener('input', () => { modelResult = null; paint(); });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); accept(); } });
  dlg.addEventListener('close', () => { try { from?.focus(); } catch { /* gone */ } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

function current() {
  if (modelResult && modelResult.typed === field.value) return { latex: modelResult.latex, complete: true, viaModel: true };
  return toLatex(field.value);
}

function paint() {
  const r = current();
  code.textContent = r.latex;
  try { katex.render(r.latex || '\\;', preview, { throwOnError: true, displayMode: true }); preview.dataset.bad = ''; } catch { preview.textContent = r.latex; preview.dataset.bad = '1'; }
  preview.style.opacity = r.complete ? '1' : '0.55';
  hint.textContent = !field.value.trim() ? 'Esc closes.'
    : busy ? 'Asking JARVIS...'
      : r.complete ? 'Enter copies the LaTeX.' : 'Not just symbols. Enter asks JARVIS to write it.';
}

async function ask(text) {
  if (serverMode()) {
    const res = await serverFetch('/latex', { method: 'POST', body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(`The server said ${res.status}.`);
    return cleanLatex((await res.json()).latex);
  }
  const { chat } = await import('./llm-client.js');
  const { reply } = await chat([{ role: 'system', content: 'Convert the maths the user describes into LaTeX. Reply with the LaTeX only: no dollar signs, no code fences, no explanation.' }, { role: 'user', content: text }], { tools: null });
  return cleanLatex(reply);
}

async function accept() {
  const typed = field.value;
  if (!typed.trim() || busy) return;
  let r = current();
  if (!r.complete) {
    busy = true;
    paint();
    try { modelResult = { typed, latex: await ask(typed) }; } catch (e) { hint.textContent = `Could not ask JARVIS: ${e.message ?? e}`; busy = false; return; }
    busy = false;
    if (field.value !== typed) return; // typed on while waiting: the answer is for the old text
    paint();
    return;
  }
  const latex = r.latex;
  try { await navigator.clipboard.writeText(latex); } catch { /* the field below still has it */ }
  if (from && from.matches?.('textarea, input[type="text"], #hud-chat-input') && from !== field) {
    const text = `$${latex}$`;
    const a = from.selectionStart ?? from.value.length;
    from.setRangeText(text, a, from.selectionEnd ?? a, 'end');
    from.dispatchEvent(new Event('input', { bubbles: true }));
  }
  dlg.close();
}

export function openLatexPad() {
  if (!dlg) build();
  if (dlg.open) { field.focus(); return; }
  from = document.activeElement;
  modelResult = null;
  field.value = '';
  paint();
  dlg.showModal();
  field.focus();
}
