// Ctrl+L: LaTeX mode. A small "LaTeX" chip beside the input shows it is on; you type maths the way Desmos lets you ("x^2/2 + sqrt(x)")
// into the ordinary input, and when you send, symbol-only text becomes LaTeX between $ signs. Words are sent as they are.
import { toLatex } from '../../shared/latex.js';

const input = document.getElementById('hud-chat-input');
const chip = document.getElementById('latex-chip');
let on = false;

export function toggleLatexMode() {
  on = !on;
  chip.hidden = !on;
  input.dispatchEvent(new Event('input', { bubbles: true })); // the field re-measures: the chip takes room
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
chip.addEventListener('click', toggleLatexMode);
