import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFormula, normalizeSpec, isFormulaSpec, sampleFormula, fitRange, growRange, formulaPoints } from '../../src/core/formula.js';

const run = (src, scope = {}, declared = []) => compileFormula(src, declared).fn({ x: 0, ...scope });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('arithmetic, precedence and powers', () => {
  assert.equal(run('1 + 2 * 3'), 7);
  assert.equal(run('(1 + 2) * 3'), 9);
  assert.equal(run('2^3^2'), 512); // right to left
  assert.equal(run('-2^2'), -4); // the minus is applied after the power
  assert.equal(run('2^-1'), 0.5);
  assert.equal(run('2**3'), 8);
  assert.equal(run('7 % 4'), 3);
  assert.equal(run('10 / 4'), 2.5);
  assert.equal(run('1e3 + 2.5e-1'), 1000.25);
});

test('x, constants, functions and implicit multiplication', () => {
  assert.equal(run('x^2', { x: 3 }), 9);
  close(run('sin(pi / 2)'), 1);
  close(run('2e'), 2 * Math.E); // 2 times the constant, not an exponent
  close(run('π'), Math.PI);
  assert.equal(run('2x', { x: 4 }), 8);
  assert.equal(run('2(x + 1)', { x: 4 }), 10);
  assert.equal(run('(x + 1)(x - 1)', { x: 4 }), 15);
  assert.equal(run('3 x^2', { x: 2 }), 12);
  assert.equal(run('max(1, 5, 3)'), 5);
  assert.equal(run('mod(-1, 5)'), 4);
  assert.equal(run('atan2(1, 1) * 4'), Math.PI);
  assert.equal(run('abs(-3) + sqrt(16) + ln(1)'), 7);
  assert.equal(run('2 × 3 − 1'), 5);
});

test('variables are the unknown names, in order of first use, never x or a constant', () => {
  const c = compileFormula('a*sin(b*x) + c + pi + a');
  assert.deepEqual(c.vars, ['a', 'b', 'c']);
  assert.equal(c.fn({ x: 0, a: 2, b: 1, c: 3 }), 5 + Math.PI);
  // a declared name wins over a constant
  assert.deepEqual(compileFormula('e * x', ['e']).vars, ['e']);
  assert.equal(compileFormula('e * x', ['e']).fn({ x: 2, e: 5 }), 10);
  // names that exist on every object are just variables
  assert.deepEqual(compileFormula('constructor + 1').vars, ['constructor']);
});

test('a formula can compute numbers and nothing else', () => {
  for (const bad of ['x.y', 'x[0]', 'a = 2', 'x;1', '"s"', '`s`', '1 +', '(1', 'sin', 'sin()', 'sin(1, 2)', 'atan2(1)', '', '   ']) {
    assert.throws(() => compileFormula(bad), Error, `${bad} should not parse`);
  }
  // names that look like code are only variables: whatever they hold, the result is a number
  for (const odd of ['alert(1)', '__proto__', 'this', 'constructor', 'toString(x)', 'process']) {
    const v = compileFormula(odd).fn({ x: 1 });
    assert.equal(typeof v, 'number', odd);
  }
  assert.throws(() => compileFormula('sin'), /needs brackets/);
  assert.throws(() => compileFormula('1 +'), /ends too early/);
  assert.throws(() => compileFormula('2 $ 3'), /Unexpected "\$"/);
});

test('normalizeSpec: functions, the y = prefix, the single expr form and defaults', () => {
  const n = normalizeSpec({ type: 'function', functions: ['y = a*sin(x)', { expr: 'f(x) = x^2', label: 'parabola' }] });
  assert.equal(n.fns.length, 2);
  assert.equal(n.fns[0].label, 'y = a*sin(x)');
  assert.equal(n.fns[1].label, 'parabola');
  assert.deepEqual(n.x, { min: -10, max: 10, label: '' });
  assert.equal(n.y.fixed, false);
  assert.deepEqual(n.params.map((p) => p.name), ['a']);
  assert.equal(normalizeSpec({ expr: 'sin(x)' }).fns.length, 1);
  assert.equal(normalizeSpec({ type: 'function', functions: [{ formula: 'x' }] }).fns.length, 1);
});

test('normalizeSpec: sliders from params, and the defaults for what is missing', () => {
  const n = normalizeSpec({
    functions: ['A*exp(-k*x)*sin(w*x + phi)'],
    params: { A: { min: 0, max: 5, value: 2, step: 0.5, label: 'Amplitude' }, k: 0.2, unused: 4 },
  });
  assert.deepEqual(n.params.map((p) => p.name), ['A', 'k', 'w', 'phi']); // declared ones first, the unused one is dropped
  const [A, k, w] = n.params;
  assert.deepEqual([A.min, A.max, A.value, A.step, A.label, A.decimals], [0, 5, 2, 0.5, 'Amplitude', 1]);
  assert.equal(k.value, 0.2);
  assert.ok(k.min < 0 && k.max > 0.2); // symmetric range around zero
  assert.equal(w.value, 1);
  assert.deepEqual([w.min, w.max], [-5, 5]);
  assert.equal(w.step, 0.05);
  assert.equal(w.decimals, 2);
  // value outside a given range is clamped; a reversed range falls back to the default one
  assert.equal(normalizeSpec({ functions: ['a*x'], params: { a: { min: 0, max: 2, value: 9 } } }).params[0].value, 2);
  const flipped = normalizeSpec({ functions: ['a*x'], params: { a: { min: 3, max: 1 } } }).params[0];
  assert.ok(flipped.min < flipped.max);
  // params as a list
  assert.equal(normalizeSpec({ functions: ['a*x'], params: [{ name: 'a', value: 3 }] }).params[0].value, 3);
});

test('normalizeSpec: a broken formula is reported and skipped; all broken throws', () => {
  const n = normalizeSpec({ functions: ['sin(x)', 'sin(', 'x^2 = y'] });
  assert.equal(n.fns.length, 1);
  assert.equal(n.errors.length, 2);
  assert.match(n.errors[0], /Formula 2/);
  assert.match(n.errors[1], /y = f\(x\)/);
  assert.throws(() => normalizeSpec({ functions: ['sin('] }), /Formula 1/);
  assert.throws(() => normalizeSpec({ type: 'function' }), /No formula/);
});

test('normalizeSpec: ranges', () => {
  const n = normalizeSpec({ functions: ['x'], x: [0, 6.28], y: { min: -1, max: 1, label: 'amplitude' } });
  assert.deepEqual([n.x.min, n.x.max], [0, 6.28]);
  assert.deepEqual([n.y.min, n.y.max, n.y.fixed, n.y.label], [-1, 1, true, 'amplitude']);
  assert.equal(normalizeSpec({ functions: ['x'], y: { min: 0 } }).y.fixed, false); // half a range is not a range
  assert.deepEqual(normalizeSpec({ functions: ['x'], x: { min: 5, max: 1 } }).x, { min: -10, max: 10, label: '' });
  assert.equal(normalizeSpec({ functions: Array(20).fill('x') }).fns.length, 8);
});

test('isFormulaSpec tells a function plot from a Chart.js config', () => {
  assert.equal(isFormulaSpec('{"type":"function","functions":["x"]}'), true);
  assert.equal(isFormulaSpec('{"functions":["x"]}'), true);
  assert.equal(isFormulaSpec('{"expr":"x"}'), true);
  assert.equal(isFormulaSpec('{"type":"line","data":{"labels":[],"datasets":[]}}'), false);
  assert.equal(isFormulaSpec('not json'), false);
  assert.equal(isFormulaSpec('null'), false);
});

test('sampling, fitting and breaking the line at an asymptote', () => {
  const scope = { a: 2 };
  const ys = sampleFormula(compileFormula('a*x', ['a']).fn, scope, -1, 1, 4);
  assert.deepEqual(ys, [-2, -1, 0, 1, 2]);
  assert.ok(Number.isNaN(sampleFormula(compileFormula('ln(x)').fn, {}, -1, 1, 2)[0])); // no value at -1
  const fit = fitRange(sampleFormula(compileFormula('sin(x)').fn, {}, -10, 10, 400));
  assert.deepEqual(fit, { min: -1.5, max: 1.5 }); // room around +-1, ending on a round number
  assert.deepEqual(fitRange(Array.from({ length: 101 }, (_, i) => i / 10)), { min: -2, max: 12 }); // 0 to 10
  assert.deepEqual(fitRange([]), { min: -1, max: 1 });
  assert.deepEqual(growRange({ min: -1, max: 1 }, { min: -0.5, max: 3 }), { min: -1, max: 3 });
  // tan: the pieces on either side of an asymptote are separate lines
  const tan = sampleFormula(compileFormula('tan(x)').fn, {}, -3, 3, 600);
  const view = { min: -10, max: 10 };
  const pts = formulaPoints(tan, -3, 3, view);
  assert.equal(pts.length, 601);
  assert.ok(pts.some((p) => p.y === null), 'a gap at pi/2');
  assert.ok(pts.filter((p) => p.y === null).length < 8, 'only a few points are cut');
  assert.equal(formulaPoints([0, 1, 0], 0, 2, view)[1].y, 1); // a smooth curve is not cut
  // a missing value is a gap, and a huge value stays finite
  const g = formulaPoints([1, NaN, 1e300], 0, 2, view);
  assert.equal(g[1].y, null);
  assert.ok(Number.isFinite(g[2].y));
});
