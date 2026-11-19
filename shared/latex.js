// Typing maths the way Desmos lets you: "x^2/2 + sqrt(x)", "pi r^2", "sin(theta) <= 1" become LaTeX as you type.
// toLatex() is a small parser (numbers, letters, + - * / ^ _ ( ) | and the usual names). If words it does not know are left
// over ("integral of x squared from 0 to 1") it says so (`complete: false`) and the caller asks the model instead.
const GREEK = new Set('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' '));
const FUNCS = new Set('sin cos tan sec csc cot sinh cosh tanh arcsin arccos arctan ln log exp min max gcd det lim'.split(' '));
const REL = { '<=': '\\le', '>=': '\\ge', '!=': '\\ne', '==': '=', '->': '\\to', '=': '=', '<': '<', '>': '>', ',': ',\\,' };
const TOKEN = /^\s*(\d+\.?\d*|\.\d+|[A-Za-z]+|<=|>=|!=|==|->|[-+*/^_()|=<>,!])/;

export function toLatex(input) {
  const src = String(input ?? '').slice(0, 500);
  const toks = [];
  let complete = true;
  for (let rest = src; ;) {
    const m = rest.match(TOKEN);
    if (!m) { if (rest.trim()) complete = false; break; }
    toks.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const startsAtom = (t) => t !== undefined && /^([\d.A-Za-z(|])/.test(t);
  const strip = (x) => x.p ?? x.s;
  const cat = (a, b) => (/[A-Za-z}]$/.test(a) && /^[A-Za-z\\]/.test(b) ? `${a} ${b}` : `${a}${b}`);

  function expr() {
    let out = term().s;
    while (peek() !== undefined && (peek() in REL || peek() === '+' || peek() === '-')) {
      const op = take();
      if (op === '+' || op === '-') out += op; else out += ` ${REL[op]} `;
      if (peek() === undefined || peek() === ')' || peek() === '|') break;
      out += term().s;
    }
    return out;
  }
  function term() {
    let left = factor();
    for (;;) {
      const t = peek();
      if (t === '/') { take(); left = { s: `\\frac{${strip(left)}}{${strip(factor())}}` }; } else if (t === '*') { take(); left = { s: `${left.s} \\cdot ${factor().s}` }; } else if (startsAtom(t) && !(t === '|' && closing)) left = { s: cat(left.s, factor().s) };
      else break;
    }
    return left;
  }
  function factor() {
    if (peek() === '-' || peek() === '+') return { s: take() + factor().s };
    let base = atom();
    for (;;) {
      const t = peek();
      if (t === '^' || t === '_') {
        take();
        let arg;
        if (peek() === '(') { take(); arg = expr(); if (peek() === ')') take(); } else if (peek() === '-') { take(); arg = `-${atom().s}`; } else arg = atom().s;
        base = { s: `${base.s}${t}{${arg}}` };
      } else if (t === '!') { take(); base = { s: `${base.s}!` }; } else break;
    }
    return base;
  }
  let closing = false;
  function group() { // after "(": the inside, and the closing ")"
    const inner = expr();
    if (peek() === ')') take(); else complete = false;
    return inner;
  }
  function atom() {
    const t = take();
    if (t === undefined) { complete = false; return { s: '' }; }
    if (/^[\d.]/.test(t)) return { s: t };
    if (t === '(') { const inner = group(); return { s: `\\left(${inner}\\right)`, p: inner }; }
    if (t === '|') { const was = closing; closing = true; const inner = expr(); closing = was; if (peek() === '|') take(); else complete = false; return { s: `\\left|${inner}\\right|` }; }
    if (/^[A-Za-z]+$/.test(t)) return word(t);
    complete = false;
    return { s: t };
  }
  function word(w) {
    if (GREEK.has(w)) return { s: `\\${w}` };
    if (w === 'inf' || w === 'infinity') return { s: '\\infty' };
    if (w === 'sqrt' || w === 'abs') {
      let arg;
      if (peek() === '(') { take(); arg = group(); } else arg = atom().s;
      return { s: w === 'sqrt' ? `\\sqrt{${arg}}` : `\\left|${arg}\\right|` };
    }
    if (FUNCS.has(w)) {
      if (peek() === '(') { take(); const inner = group(); return { s: `\\${w}\\left(${inner}\\right)` }; }
      return { s: `\\${w}` };
    }
    if (w.length <= 3) return { s: w.split('').join(' ') }; // xy, abc: letters side by side, as in Desmos
    complete = false;
    return { s: `\\text{${w}}` };
  }

  let latex = expr();
  while (i < toks.length) { complete = false; latex += ` ${take()}`; if (i < toks.length) latex += expr(); }
  return { latex: latex.trim(), complete: complete && toks.length > 0 };
}

// The model's answer, cleaned to bare LaTeX: no fences, no $ signs, no "latex:" label, one line.
export function cleanLatex(text) {
  let t = String(text ?? '').trim().replace(/^```(?:latex|tex)?\s*|\s*```$/g, '').trim();
  t = t.replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '').replace(/^\$\$?|\$\$?$/g, '').replace(/^latex:\s*/i, '').trim();
  return t.replace(/\s*\n\s*/g, ' ').slice(0, 1000);
}
