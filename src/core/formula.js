// Formulas for function plots. A small expression parser (no eval, no Function constructor), so a formula the model writes can
// only ever compute a number, plus the pure helpers that sample and fit a plot. It is inlined into the chart frame as plain
// script (artifact-renderer.js strips the `export` words), so it has no imports and its top-level names stay unlikely to clash
// with the frame's own script. Tested in tools/tests/formula.test.mjs.

const FORMULA_FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => a - b * Math.floor(a / b),
  sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v), cot: (v) => 1 / Math.tan(v),
};
const FORMULA_CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
const FORMULA_TWO = new Set(['atan2', 'pow', 'mod']); // two arguments; min and max take any number, the rest take one
const FORMULA_MAX = { functions: 8, params: 12, length: 400 };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function formulaTokens(source) {
  const s = source.trim();
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_π][A-Za-z_0-9]*)|(\*\*|[-+*/^%(),×·÷−])|(\S))/y;
  const out = [];
  for (let i = 0; i < s.length;) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) break;
    i = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] === 'π' ? 'pi' : m[2] });
    else if (m[3] !== undefined) out.push({ t: 'op', v: { '×': '*', '·': '*', '÷': '/', '−': '-', '**': '^' }[m[3]] ?? m[3] });
    else throw new Error(`Unexpected "${m[4]}"`);
  }
  return out;
}

// Parses one formula in x (and any other names, which become variables). `declared` are names that must be variables even
// when they look like constants (a slider called e). Returns { fn(scope) -> number, vars: [names other than x] }.
export function compileFormula(source, declared = []) {
  const toks = formulaTokens(source);
  const decl = new Set(declared);
  const vars = new Set();
  let p = 0;
  const isOp = (o) => toks[p] && toks[p].t === 'op' && toks[p].v === o;
  const expect = (o) => { if (!isOp(o)) throw new Error(toks[p] ? `Expected "${o}" before "${toks[p].v}"` : `Missing "${o}" at the end`); p += 1; };

  function sum() {
    let l = product();
    while (isOp('+') || isOp('-')) {
      const plus = toks[p++].v === '+';
      const a = l, b = product();
      l = plus ? (s) => a(s) + b(s) : (s) => a(s) - b(s);
    }
    return l;
  }
  function product() {
    let l = unary();
    for (;;) {
      const t = toks[p];
      if (!t) break;
      if (t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        p += 1;
        const a = l, b = unary();
        l = t.v === '*' ? (s) => a(s) * b(s) : t.v === '/' ? (s) => a(s) / b(s) : (s) => a(s) % b(s);
      } else if (t.t === 'id' || (t.t === 'op' && t.v === '(')) { // 2x, 2(x+1), (x+1)(x-1), x sin(x)
        const a = l, b = unary();
        l = (s) => a(s) * b(s);
      } else break;
    }
    return l;
  }
  function unary() {
    if (isOp('-')) { p += 1; const a = unary(); return (s) => -a(s); }
    if (isOp('+')) { p += 1; return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (!isOp('^')) return base;
    p += 1;
    const exp = unary(); // right to left, and 2^-x works
    return (s) => Math.pow(base(s), exp(s));
  }
  function primary() {
    const t = toks[p++];
    if (!t) throw new Error('The formula ends too early');
    if (t.t === 'num') { const v = t.v; return () => v; }
    if (t.t === 'id') {
      const name = t.v;
      if (has(FORMULA_FUNCS, name) && !decl.has(name)) {
        if (!isOp('(')) throw new Error(`${name} needs brackets, like ${name}(x)`);
        p += 1;
        const args = [];
        if (!isOp(')')) { args.push(sum()); while (isOp(',')) { p += 1; args.push(sum()); } }
        expect(')');
        const want = FORMULA_TWO.has(name) ? 2 : 1;
        if (name === 'min' || name === 'max' ? args.length < 1 : args.length !== want) throw new Error(`${name} takes ${want} argument${want === 1 ? '' : 's'}`);
        const f = FORMULA_FUNCS[name];
        return args.length === 1 ? (s) => f(args[0](s)) : (s) => f(...args.map((a) => a(s)));
      }
      if (name === 'x') return (s) => s.x;
      if (!decl.has(name) && has(FORMULA_CONSTS, name)) { const v = FORMULA_CONSTS[name]; return () => v; }
      vars.add(name);
      return (s) => { const v = s[name]; return typeof v === 'number' ? v : NaN; }; // a name like __proto__ finds nothing
    }
    if (t.v === '(') { const e = sum(); expect(')'); return e; }
    throw new Error(`Unexpected "${t.v}"`);
  }

  if (!toks.length) throw new Error('The formula is empty');
  const fn = sum();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return { fn, vars: [...vars] };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined));

// 1, 2 or 5 times a power of ten near range / 200: the step of a slider
function niceStep(range) {
  const raw = range / 200;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

// One slider: from a bare number (the starting value) or {min, max, value, step, label}; whatever is missing is filled in.
function paramSpec(name, d) {
  const o = typeof d === 'number' || typeof d === 'string' ? { value: d } : (d && typeof d === 'object' ? d : {});
  let min = num(o.min), max = num(o.max);
  let value = num(o.value ?? o.default ?? o.initial);
  if (value === undefined) value = min !== undefined && max !== undefined ? (min <= 1 && 1 <= max ? 1 : (min + max) / 2) : 1;
  const span = Math.max(5, 3 * Math.abs(value));
  if (min === undefined && max === undefined) { min = -span; max = span; }
  else if (min === undefined) min = Math.min(-span, max - span);
  else if (max === undefined) max = Math.max(span, min + span);
  if (!(min < max)) { min = -span; max = span; }
  value = Math.min(max, Math.max(min, value));
  const step = num(o.step) > 0 ? num(o.step) : niceStep(max - min);
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  return { name, label: typeof o.label === 'string' ? o.label.slice(0, 40) : '', min, max, step, decimals, value, initial: value };
}

const range = (r, dmin, dmax) => {
  const a = Array.isArray(r) ? r : [r?.min, r?.max];
  const min = num(a[0]), max = num(a[1]);
  return { min: min ?? dmin, max: max ?? dmax };
};

// The spec of a function plot, as the model writes it, into what the frame draws:
//   {"type":"function","functions":["a*sin(b*x)", {"expr":"x^2","label":"parabola"}],
//    "x":{"min":-10,"max":10,"label":"t"}, "y":{"min":-5,"max":5},
//    "params":{"a":{"min":0,"max":5,"value":2}, "b":1}}
// Variables in a formula (anything but x, the constants pi, e, tau and the function names) each get a slider; "params" sets their
// range, step and starting value. Formulas that do not parse are listed in `errors` and left out; with none left it throws.
export function normalizeSpec(spec) {
  const raw = spec.functions ?? spec.expressions ?? (spec.expr ?? spec.formula ? [spec.expr ?? spec.formula] : []);
  const list = (Array.isArray(raw) ? raw : [raw]).slice(0, FORMULA_MAX.functions);
  const given = spec.params ?? spec.variables ?? spec.sliders ?? {};
  const declared = new Map();
  if (Array.isArray(given)) given.forEach((g) => { if (g && typeof g.name === 'string') declared.set(g.name, g); });
  else if (given && typeof given === 'object') Object.entries(given).forEach(([k, v]) => declared.set(k, v));
  declared.delete('x');

  const fns = [], errors = [], order = [];
  list.forEach((item, i) => {
    const o = typeof item === 'string' ? { expr: item } : (item ?? {});
    const text = String(o.expr ?? o.formula ?? '').slice(0, FORMULA_MAX.length);
    const body = text.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    try {
      if (body.includes('=')) throw new Error('Write the formula as y = f(x); equations with y on both sides cannot be plotted');
      const c = compileFormula(body, [...declared.keys()]);
      c.vars.forEach((v) => { if (!order.includes(v)) order.push(v); });
      fns.push({ fn: c.fn, src: body.trim(), label: typeof o.label === 'string' && o.label ? o.label : `y = ${body.trim()}` });
    } catch (e) {
      errors.push(`Formula ${i + 1} (${text.trim() || 'empty'}): ${e.message}`);
    }
  });
  if (!fns.length) throw new Error(errors[0] ?? 'No formula to plot: give "functions": ["sin(x)"]');

  const names = [...new Set([...[...declared.keys()].filter((k) => order.includes(k)), ...order])].slice(0, FORMULA_MAX.params);
  const params = names.map((n) => paramSpec(n, declared.get(n)));
  let x = range(spec.x ?? spec.domain, -10, 10);
  if (!(x.min < x.max)) x = { min: -10, max: 10 };
  const y = spec.y ?? spec.range;
  const yr = y ? range(y, undefined, undefined) : {};
  return {
    x: { ...x, label: String(spec.x?.label ?? spec.xLabel ?? '') },
    y: { ...yr, label: String(spec.y?.label ?? spec.yLabel ?? ''), fixed: yr.min !== undefined && yr.max !== undefined && yr.min < yr.max },
    fns, params, errors,
  };
}

// True when a chart artifact's text is a function plot rather than a Chart.js config.
export function isFormulaSpec(text) {
  try {
    const s = JSON.parse(text);
    return !!s && typeof s === 'object' && (s.type === 'function' || Array.isArray(s.functions) || typeof s.expr === 'string' || typeof s.formula === 'string');
  } catch { return false; }
}

// y at n + 1 evenly spaced x (NaN where the formula has no value there). `scope` holds the slider values; x is set on it.
export function sampleFormula(fn, scope, xmin, xmax, n) {
  const ys = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    scope.x = xmin + ((xmax - xmin) * i) / n;
    let y;
    try { y = fn(scope); } catch { y = NaN; }
    ys[i] = Number.isFinite(y) ? y : NaN;
  }
  return ys;
}

// The range most of the samples sit in (the central 98 %, so a tan() asymptote does not squash the rest), with a little room.
export function fitRange(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { min: -1, max: 1 };
  const q = (f) => v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))];
  let lo = q(0.01), hi = q(0.99);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  const step = niceStep((hi - lo + 2 * pad) * 25); // a gridline every eighth or so of the view; the view ends on one, so no half-cut label at the edge
  return { min: Math.floor((lo - pad) / step) * step, max: Math.ceil((hi + pad) / step) * step };
}

// A view only ever grows while a slider moves (so a smaller amplitude looks smaller); Reset starts it again.
export const growRange = (view, fit) => ({ min: Math.min(view.min, fit.min), max: Math.max(view.max, fit.max) });

// The points to draw: y is null where the line must break (no value, or a jump across the view that changes sign, like tan at
// its asymptotes), and is kept near the view so a huge value cannot upset the canvas.
export function formulaPoints(ys, xmin, xmax, view) {
  const n = ys.length - 1, span = view.max - view.min, far = span * 100;
  const out = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    let y = ys[i];
    const a = i > 0 ? ys[i - 1] : NaN;
    const cut = Number.isNaN(y) || (!Number.isNaN(a) && Math.sign(a) !== Math.sign(y) && Math.abs(y - a) > span * 0.6);
    if (!cut) y = Math.min(view.max + far, Math.max(view.min - far, y));
    out[i] = { x: xmin + ((xmax - xmin) * i) / n, y: cut ? null : y };
  }
  return out;
}
