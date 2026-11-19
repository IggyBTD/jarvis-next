import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_TASKS, gradeCode, extractCode, gradeTools, report } from '../../scripts/bench-coding.js';

const GOOD = {
  parseDuration: "const U={d:864e5,h:36e5,m:6e4,s:1e3,ms:1};function parseDuration(s){if(typeof s!=='string')return null;const t=s.trim();if(!t)return null;const re=/(\\d+(?:\\.\\d+)?)\\s*(ms|d|h|m|s)/gi;let m,sum=0,end=0;while((m=re.exec(t))){if(t.slice(end,m.index).trim())return null;sum+=parseFloat(m[1])*U[m[2].toLowerCase()];end=re.lastIndex}if(end===0||t.slice(end).trim())return null;return Math.round(sum)}module.exports={parseDuration}",
  'fix mergeIntervals': 'function mergeIntervals(list){const a=list.map(x=>[...x]).sort((x,y)=>x[0]-y[0]);const out=[];for(const i of a){const l=out[out.length-1];if(l&&i[0]<=l[1])l[1]=Math.max(l[1],i[1]);else out.push(i)}return out}module.exports={mergeIntervals}',
  LRUCache: 'class LRUCache{constructor(c){this.c=c;this.m=new Map()}get size(){return this.m.size}get(k){if(!this.m.has(k))return undefined;const v=this.m.get(k);this.m.delete(k);this.m.set(k,v);return v}put(k,v){if(this.c<=0)return;this.m.delete(k);this.m.set(k,v);if(this.m.size>this.c)this.m.delete(this.m.keys().next().value)}}module.exports={LRUCache}',
};

test('the hidden tests accept a correct solution and reject a wrong or broken one', () => {
  for (const t of CODE_TASKS) {
    const g = gradeCode(GOOD[t.name], t.cases);
    assert.deepEqual([g.passed, g.total], [t.cases.length, t.cases.length], `${t.name}: ${g.failed}`);
    const bad = gradeCode('module.exports = {};', t.cases);
    assert.ok(bad.passed < bad.total);
    assert.equal(gradeCode('this is not javascript', t.cases).passed, 0);
    assert.equal(gradeCode('while(true){}', t.cases).passed, 0); // an endless loop is stopped, not waited for
  }
});

test('the original buggy mergeIntervals scores low', () => {
  const buggy = 'function mergeIntervals(list){list.sort();const out=[list[0]];for(let i=1;i<list.length;i++){const last=out[out.length-1];if(list[i][0]<last[1])last[1]=list[i][1];else out.push(list[i])}return out}module.exports={mergeIntervals}';
  const t = CODE_TASKS[1];
  const g = gradeCode(buggy, t.cases);
  assert.ok(g.passed <= 3, `buggy passed ${g.passed}`);
});

test('code extraction, tool grading and the report', () => {
  assert.equal(extractCode('Here:\n```js\nconst a = 1;\n```\nDone'), 'const a = 1;');
  assert.equal(extractCode('const b = 2;'), 'const b = 2;');
  const ok = gradeTools([{ name: 'set_volume', args: { level: 15 } }, { name: 'open_app', args: { app: 'Spotify' } }]);
  assert.deepEqual([ok.passed, ok.total], [5, 5]);
  const one = gradeTools([{ name: 'set_volume', args: { level: '15' } }]);
  assert.ok(one.passed < 5 && one.failed.includes('level is the integer 15'));
  assert.equal(gradeTools([]).passed, 0);
  const t = (p) => ({ name: 'x', passed: p, total: 10, score: p * 2.5 });
  const md = report([{ key: 'a', total: 90, tokensPerSec: 10, tasks: [t(9)] }, { key: 'b', total: 70, tokensPerSec: 25, tasks: [t(7)] }]);
  assert.match(md, /a is clearly better \(90 vs 70\)/);
  assert.match(report([{ key: 'a', total: 80, tokensPerSec: 10, tasks: [t(8)] }, { key: 'b', total: 80, tokensPerSec: 25, tasks: [t(8)] }]), /tie on quality/);
});
