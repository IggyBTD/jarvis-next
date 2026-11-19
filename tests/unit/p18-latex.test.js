import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLatex, cleanLatex } from '../../shared/latex.js';

const r = String.raw;
const cases = [
  ['x^2/2 + sqrt(x)', r`\frac{x^{2}}{2}+\sqrt{x}`],
  ['(a+b)/(c-d)', r`\frac{a+b}{c-d}`],
  ['pi r^2', r`\pi r^{2}`],
  ['sin(theta) <= 1', r`\sin\left(\theta\right) \le 1`],
  ['e^(-x^2)', r`e^{-x^{2}}`],
  ['2x*3', r`2x \cdot 3`],
  ['|x-1| >= abs(y)', r`\left|x-1\right| \ge \left|y\right|`],
  ['x_1 + x_2 = inf', r`x_{1}+x_{2} = \infty`],
  ['xy/z', r`\frac{x y}{z}`],
];
test('toLatex turns Desmos-style typing into LaTeX', () => {
  for (const [typed, want] of cases) { const out = toLatex(typed); assert.deepEqual([typed, out.latex, out.complete], [typed, want, true]); }
});
test('words it does not know make the result incomplete, so the model is asked', () => {
  for (const t of ['integral of x squared from 0 to 1', 'derivative of sin x', '']) assert.equal(toLatex(t).complete, false, t);
  assert.equal(toLatex('(1+2').complete, false);
});
test('cleanLatex strips fences, dollars and labels', () => {
  assert.equal(cleanLatex('```latex\n' + r`\int_0^1 x^2\,dx` + '\n```'), r`\int_0^1 x^2\,dx`);
  assert.equal(cleanLatex('$$a+b$$'), 'a+b');
  assert.equal(cleanLatex(r`LaTeX: \frac{1}{2}`), r`\frac{1}{2}`);
});
