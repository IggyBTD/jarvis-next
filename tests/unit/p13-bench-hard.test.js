import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeCode } from '../../scripts/bench-coding.js';
import { HARD_TASKS, REFERENCE } from '../../scripts/bench-hard-tasks.js';

test('every hard task: the reference solution passes all hidden cases, an empty module does not', () => {
  for (const t of HARD_TASKS) {
    const g = gradeCode(REFERENCE[t.name], t.cases);
    assert.deepEqual([g.passed, g.total], [t.cases.length, t.cases.length], `${t.name} failed: ${g.failed}${g.error ? ` (${g.error})` : ''}`);
    const none = gradeCode('module.exports = {};', t.cases);
    assert.ok(none.passed <= Math.ceil(none.total * 0.3), `${t.name}: empty module passed ${none.passed}/${none.total}`);
  }
});

test('the hard suite catches typical wrong answers', () => {
  const t = (name) => HARD_TASKS.find((x) => x.name === name);
  // eval-based, left-associative power: wrong on 2^3^2 and -2^2
  const naive = 'function evaluate(s){ if(!/^[-+*/%^().\\d\\s]+$/.test(s)) throw new Error("bad"); return Function("return " + s.replace(/\\^/g,"**"))(); } module.exports={evaluate}';
  assert.ok(gradeCode(naive, t('expression evaluator').cases).passed < t('expression evaluator').cases.length);
  // unbounded concurrency
  const greedy = 'async function mapLimit(i,l,f){return Promise.all(i.map(f))} module.exports={mapLimit}';
  assert.ok(gradeCode(greedy, t('mapLimit (async pool)').cases).passed < t('mapLimit (async pool)').cases.length);
  // the original buggy deepMerge
  const buggy = 'function deepMerge(t,s){for(const k in s){if(typeof s[k]==="object"&&typeof t[k]==="object")deepMerge(t[k],s[k]);else t[k]=s[k]}return t} module.exports={deepMerge}';
  assert.ok(gradeCode(buggy, t('fix deepMerge (4 bugs)').cases).passed <= 4);
  // a diff that is correct but not minimal (delete everything, add everything)
  const dumb = 'function lineDiff(a,b){return [...a.map(l=>({type:"del",line:l})),...b.map(l=>({type:"add",line:l}))]} module.exports={lineDiff}';
  assert.ok(gradeCode(dumb, t('minimal line diff').cases).passed < t('minimal line diff').cases.length);
});
