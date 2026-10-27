// Ctrl+L: LaTeX mode. A "LaTeX" chip beside the input shows it is on. You type maths the way Desmos lets you ("x^2/2 + sqrt(x)") into
// the ordinary input, and the input shows it typeset instead of the typed text (the real text is still there, under it, with the caret).
// When you send, symbol-only text becomes LaTeX between $ signs. Text with words in it stays as typed and is shown as typed.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { toLatex } from '../../shared/latex.js';

const input = document.getElementById('hud-chat-input');
const chip = document.getElementById('latex-chip');
const view = Object.assign(document.createElement('div'), { id: 'latex-view', hidden: true });
view.setAttribute('aria-hidden', 'true');
input.parentElement.append(view);
let on = false;

function render() {
  const typed = input.value;
  const r = on && typed.trim() && !typed.startsWith('/') ? toLatex(typed) : null;
  const typeset = !!(r?.complete && r.latex);
  input.classList.toggle('latex-hidden', typeset);
  view.hidden = !typeset;
  if (!typeset) return;
  Object.assign(view.style, { left: `${input.offsetLeft}px`, width: `${input.offsetWidth}px`, top: `${input.offsetTop}px`, height: `${input.offsetHeight}px` });
  try { katex.render(r.latex, view, { throwOnError: true }); } catch { input.classList.remove('latex-hidden'); view.hidden = true; }
}

export function toggleLatexMode() {
  on = !on;
  chip.hidden = !on;
  render();
  input.focus();
}

function convert() {
  const typed = input.value.trim();
  if (!on || !typed || typed.startsWith('/')) return;
  const r = toLatex(typed);
  if (r.complete && r.latex) { input.value = `$${r.latex}$`; input.dispatchEvent(new Event('input', { bubbles: true })); }
}
// capture: the conversion happens before the chat's own send handlers read the field
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) convert(); }, true);
document.getElementById('send-btn').addEventListener('click', convert, true);
input.addEventListener('input', render);
chip.addEventListener('click', toggleLatexMode);
