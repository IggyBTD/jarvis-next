// Ctrl+L: LaTeX mode. A "LaTeX" chip beside the input shows it is on. The input is swapped for a maths editor (MathLive): typing "^" opens
// the exponent slot right away with the caret inside it, "/" makes a fraction, "sqrt" a root, and everything is typeset as you type.
// The ordinary input stays underneath as the message the chat reads: while the editor is on it holds "$latex$". Turning the mode off
// puts that text back in the ordinary input.
import { MathfieldElement } from 'mathlive';
import 'katex/dist/katex.min.css'; // the maths fonts (MathLive uses the same ones), bundled locally
import { toLatex } from '../../shared/latex.js';

MathfieldElement.fontsDirectory = null; // the fonts come from the KaTeX stylesheet above
MathfieldElement.soundsDirectory = null;

const input = document.getElementById('hud-chat-input');
const chip = document.getElementById('latex-chip');
const field = new MathfieldElement();
field.id = 'latex-field';
field.hidden = true;
field.setAttribute('aria-label', 'Message JARVIS in maths. Enter sends.');
input.after(field); // in the textarea's place in the row, before the microphone and send buttons
// options can only be set once the field is on the page
field.mathVirtualKeyboardPolicy = 'manual';
field.smartMode = false;
field.menuItems = [];
let on = false;

// the chat reads the ordinary input: keep it in step with the editor
function sync() {
  const latex = field.value.trim();
  input.value = latex ? `$${latex}$` : '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function toggleLatexMode() {
  on = !on;
  chip.hidden = !on;
  field.hidden = !on;
  input.classList.toggle('latex-off', on);
  if (on) {
    // text already typed becomes the start of the formula
    const typed = input.value.trim();
    const r = typed && !typed.startsWith('/') && !typed.startsWith('$') ? toLatex(typed) : null;
    field.value = r?.latex ?? '';
    sync();
    field.focus();
  } else {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
}

field.addEventListener('input', sync);
field.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('send-btn').click();
  // the chat empties its input when the message goes out: empty the editor with it
  setTimeout(() => { if (!input.value) field.value = ''; }, 60);
}, true);
// something elsewhere in the app focuses the input (a new chat, a click on the card): the editor takes it
input.addEventListener('focus', () => { if (on) field.focus(); });
chip.addEventListener('click', toggleLatexMode);
