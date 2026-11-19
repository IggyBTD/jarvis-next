// Plain text with maths in it: "$x^2$" inside a name or a message is typeset, everything else stays text (set as text, never as HTML).
// A formula is $...$ on one line, not starting or ending with a space, so "costs $5 and $6" stays as written.
import katex from 'katex';
import 'katex/dist/katex.min.css';

const FORMULA = /\$\$([^\n]+?)\$\$|\$(?! )([^$\n]*[^$\s\n])\$(?!\d)/g;

// Fills el with the text; returns true when it holds at least one typeset formula.
export function setMathText(el, text) {
  const s = String(text ?? '');
  delete el.dataset.raw;
  if (!s.includes('$')) { el.textContent = s; return false; }
  const parts = [];
  let at = 0;
  let any = false;
  for (const m of s.matchAll(FORMULA)) {
    const tex = m[1] ?? m[2];
    const span = document.createElement('span');
    span.className = 'inline-math';
    try { katex.render(tex, span, { throwOnError: true, displayMode: false }); } catch { continue; } // a formula that does not parse stays as typed
    if (m.index > at) parts.push(s.slice(at, m.index));
    parts.push(span);
    at = m.index + m[0].length;
    any = true;
  }
  if (!any) { el.textContent = s; return false; }
  if (at < s.length) parts.push(s.slice(at));
  el.replaceChildren(...parts);
  el.dataset.raw = s; // the typed text, for copying and for naming a chat (the typeset spans read as glyphs)
  return true;
}
