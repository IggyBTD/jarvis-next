// The harder suite for scripts/bench-coding.js: five tasks that separate models (precedence parsing, graph cycles, async
// concurrency, minimal diff, a four-bug fix). Hidden test cases may be async. REFERENCE holds a known-correct solution of each,
// used only by the grading tests, never shown to a model.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = async (f) => { try { await f(); return false; } catch { return true; } };

export const HARD_TASKS = [
  {
    name: 'expression evaluator',
    prompt: 'Write evaluate(expr) that evaluates an arithmetic expression string and returns a number. Support decimal numbers, + - * / % and ^ (power, RIGHT associative, binds tighter than unary minus so -2^2 is -4), parentheses, unary minus and plus (including "--3" and "2*-3"), and arbitrary spaces. Throw an Error for any invalid input: empty or incomplete expressions ("1+"), unbalanced parentheses ("(1"), two numbers in a row ("2 3"), unknown characters, and division or modulo by zero. Do not use eval, Function, or any library. Export as module.exports = { evaluate }.',
    cases: [
      ['precedence', (m) => m.evaluate('1+2*3') === 7], ['parens', (m) => m.evaluate('(1+2)*3') === 9], ['right assoc power', (m) => m.evaluate('2^3^2') === 512],
      ['unary vs power', (m) => m.evaluate('-2^2') === -4], ['mul unary', (m) => m.evaluate('2*-3') === -6], ['division', (m) => m.evaluate('10/4') === 2.5],
      ['modulo', (m) => m.evaluate('7%4') === 3], ['spaces', (m) => m.evaluate(' 1 +  1 ') === 2], ['decimals', (m) => m.evaluate('1.5*2') === 3], ['double minus', (m) => m.evaluate('--3') === 3],
      ['left assoc minus', (m) => m.evaluate('10-3-2') === 5], ['nested', (m) => m.evaluate('((2+3)*(4-1))^2') === 225],
      ['incomplete', async (m) => throws(() => m.evaluate('1+'))], ['unbalanced', async (m) => throws(() => m.evaluate('(1'))], ['two numbers', async (m) => throws(() => m.evaluate('2 3'))],
      ['bad char', async (m) => throws(() => m.evaluate('2 & 3'))], ['div zero', async (m) => throws(() => m.evaluate('1/0'))], ['empty', async (m) => throws(() => m.evaluate(''))],
    ],
  },
  {
    name: 'topoSort with cycles',
    prompt: 'Write topoSort(deps) where deps is an object mapping a node name to an array of the names it depends on, e.g. {app: ["lib","util"], lib: ["util"], util: []}. Return an array of ALL node names (including names that appear only as dependencies) such that every node comes after the nodes it depends on. Break ties alphabetically so the result is deterministic. If there is a cycle (including a node depending on itself) throw an Error whose message contains the word "cycle" and the names of the nodes in the cycle joined with " -> " (for example "cycle: a -> b -> a"). Export as module.exports = { topoSort }.',
    cases: [
      ['simple', (m) => same(m.topoSort({ app: ['lib', 'util'], lib: ['util'], util: [] }), ['util', 'lib', 'app'])], ['alphabetical ties', (m) => same(m.topoSort({ c: [], a: [], b: [] }), ['a', 'b', 'c'])],
      ['implicit nodes', (m) => same(m.topoSort({ a: ['z'] }), ['z', 'a'])], ['empty', (m) => same(m.topoSort({}), [])],
      ['diamond', (m) => same(m.topoSort({ d: ['b', 'c'], b: ['a'], c: ['a'], a: [] }), ['a', 'b', 'c', 'd'])],
      ['respects order', (m) => { const o = m.topoSort({ x: ['y'], y: ['w'], w: [], q: ['x'] }); return o.indexOf('w') < o.indexOf('y') && o.indexOf('y') < o.indexOf('x') && o.indexOf('x') < o.indexOf('q') && o.length === 4; }],
      ['cycle throws', async (m) => throws(() => m.topoSort({ a: ['b'], b: ['a'] }))], ['self cycle throws', async (m) => throws(() => m.topoSort({ a: ['a'] }))],
      ['cycle message', async (m) => { try { m.topoSort({ a: ['b'], b: ['c'], c: ['a'] }); return false; } catch (e) { return /cycle/i.test(e.message) && /a/.test(e.message) && /b/.test(e.message) && /c/.test(e.message) && /->/.test(e.message); } }],
      ['cycle beside ok nodes', async (m) => throws(() => m.topoSort({ ok: [], x: ['y'], y: ['x'] }))],
    ],
  },
  {
    name: 'mapLimit (async pool)',
    prompt: 'Write async function mapLimit(items, limit, fn) that calls the async function fn(item, index) for every item with at most `limit` calls running at the same time, and resolves to the array of results IN INPUT ORDER. If any call rejects (or fn throws synchronously) the returned promise must reject with that first error and no NEW calls may be started after the failure. An empty array resolves to []. A limit that is not a positive integer must reject with a RangeError. A limit larger than the number of items is fine. Do not use any library. Export as module.exports = { mapLimit }.',
    cases: [
      ['order', async (m) => same(await m.mapLimit([30, 10, 20], 2, async (x) => { await new Promise((r) => setTimeout(r, x)); return x * 2; }), [60, 20, 40])],
      ['index passed', async (m) => same(await m.mapLimit(['a', 'b'], 2, async (x, i) => `${x}${i}`), ['a0', 'b1'])],
      ['respects limit', async (m) => { let run = 0; let max = 0; await m.mapLimit([...Array(10).keys()], 3, async () => { run++; max = Math.max(max, run); await new Promise((r) => setTimeout(r, 15)); run--; }); return max === 3; }],
      ['uses full limit', async (m) => { let run = 0; let max = 0; await m.mapLimit([...Array(6).keys()], 6, async () => { run++; max = Math.max(max, run); await new Promise((r) => setTimeout(r, 15)); run--; }); return max === 6; }],
      ['limit above length', async (m) => same(await m.mapLimit([1, 2], 10, async (x) => x), [1, 2])], ['empty', async (m) => same(await m.mapLimit([], 3, async (x) => x), [])],
      ['rejects with first error', async (m) => { try { await m.mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('boom'); return x; }); return false; } catch (e) { return e.message === 'boom'; } }],
      ['no new calls after failure', async (m) => { let started = 0; try { await m.mapLimit([...Array(20).keys()], 2, async (x) => { started++; await new Promise((r) => setTimeout(r, 5)); if (x === 1) throw new Error('x'); }); } catch { /* expected */ } await new Promise((r) => setTimeout(r, 80)); return started <= 5; }],
      ['sync throw rejects', async (m) => { try { await m.mapLimit([1], 1, () => { throw new Error('sync'); }); return false; } catch (e) { return e.message === 'sync'; } }],
      ['bad limit', async (m) => { for (const l of [0, -1, 1.5, NaN]) { try { await m.mapLimit([1], l, async (x) => x); return false; } catch (e) { if (!(e instanceof RangeError)) return false; } } return true; }],
    ],
  },
  {
    name: 'minimal line diff',
    prompt: 'Write lineDiff(a, b) where a and b are arrays of strings (lines). Return an array of operations {type, line} where type is "same", "del" (a line only in a) or "add" (a line only in b), such that reading the "same" and "del" lines in order gives a, and reading the "same" and "add" lines in order gives b. The number of "add" plus "del" operations must be the MINIMUM possible (use the longest common subsequence). Export as module.exports = { lineDiff }.',
    cases: [
      ['identical', (m) => same(m.lineDiff(['a', 'b'], ['a', 'b']), [{ type: 'same', line: 'a' }, { type: 'same', line: 'b' }])], ['empty both', (m) => same(m.lineDiff([], []), [])],
      ['all added', (m) => same(m.lineDiff([], ['x', 'y']).map((o) => o.type), ['add', 'add'])], ['all deleted', (m) => same(m.lineDiff(['x', 'y'], []).map((o) => o.type), ['del', 'del'])],
      ['replace', (m) => { const o = m.lineDiff(['a', 'b', 'c'], ['a', 'x', 'c']); return o.length === 4 && o.filter((p) => p.type !== 'same').length === 2 && o[0].type === 'same' && o[3].type === 'same'; }],
      ['reconstructs a and b', (m) => { const a = ['the', 'cat', 'sat', 'on', 'mat']; const b = ['the', 'dog', 'sat', 'mat', 'now']; const o = m.lineDiff(a, b); return same(o.filter((p) => p.type !== 'add').map((p) => p.line), a) && same(o.filter((p) => p.type !== 'del').map((p) => p.line), b); }],
      ['minimal edits', (m) => { const a = ['a', 'b', 'c', 'a', 'b', 'b', 'a']; const b = ['c', 'b', 'a', 'b', 'a', 'c']; const o = m.lineDiff(a, b); return o.filter((p) => p.type !== 'same').length === 5; }],
      ['duplicates', (m) => { const o = m.lineDiff(['x', 'x', 'x'], ['x', 'x']); return o.filter((p) => p.type !== 'same').length === 1; }],
      ['reorder', (m) => { const o = m.lineDiff(['1', '2', '3'], ['3', '2', '1']); return o.filter((p) => p.type !== 'same').length === 4; }],
    ],
  },
  {
    name: 'fix deepMerge (4 bugs)',
    prompt: 'This deepMerge(target, source) should return a NEW object with source merged into target: plain objects are merged recursively, arrays and other values from source REPLACE the target value, keys whose value in source is undefined are ignored, neither input may be modified, and the keys "__proto__", "constructor" and "prototype" in source must be ignored (no prototype pollution). It has several bugs. Return the corrected full function exported as module.exports = { deepMerge }.\n\n```js\nfunction deepMerge(target, source) {\n  for (const key in source) {\n    if (typeof source[key] === "object" && typeof target[key] === "object") {\n      deepMerge(target[key], source[key]);\n    } else {\n      target[key] = source[key];\n    }\n  }\n  return target;\n}\n```',
    cases: [
      ['merges nested', (m) => same(m.deepMerge({ a: { x: 1 }, b: 1 }, { a: { y: 2 } }), { a: { x: 1, y: 2 }, b: 1 })], ['source wins', (m) => m.deepMerge({ a: 1 }, { a: 2 }).a === 2],
      ['arrays replaced', (m) => same(m.deepMerge({ a: [1, 2, 3] }, { a: [9] }).a, [9])], ['undefined ignored', (m) => m.deepMerge({ a: 1 }, { a: undefined }).a === 1],
      ['null replaces', (m) => m.deepMerge({ a: { x: 1 } }, { a: null }).a === null], ['no target mutation', (m) => { const t = { a: { x: 1 } }; m.deepMerge(t, { a: { y: 2 } }); return same(t, { a: { x: 1 } }); }],
      ['no source mutation', (m) => { const s = { a: { y: 2 } }; const r = m.deepMerge({ a: { x: 1 } }, s); r.a.y = 99; return s.a.y === 2; }],
      ['returns new object', (m) => { const t = { a: 1 }; return m.deepMerge(t, {}) !== t; }], ['no proto pollution', (m) => { m.deepMerge({}, JSON.parse('{"__proto__":{"polluted":true}}')); return ({}).polluted === undefined; }],
      ['constructor ignored', (m) => { const r = m.deepMerge({}, JSON.parse('{"constructor":{"prototype":{"p2":1}}}')); return ({}).p2 === undefined && Object.keys(r).length === 0; }],
      ['adds new nested object', (m) => same(m.deepMerge({}, { a: { b: { c: 1 } } }), { a: { b: { c: 1 } } })],
    ],
  },
];

export const REFERENCE = {
  'expression evaluator': `function evaluate(src){let i=0;const s=String(src);const ws=()=>{while(s[i]===' ')i++};
function num(){ws();const m=/^\\d+(\\.\\d+)?|^\\.\\d+/.exec(s.slice(i));if(!m)throw new Error('number expected');i+=m[0].length;return parseFloat(m[0])}
function prim(){ws();if(s[i]==='('){i++;const v=add();ws();if(s[i]!==')')throw new Error('unbalanced');i++;return v}return num()}
function unary(){ws();if(s[i]==='-'){i++;return -unary()}if(s[i]==='+'){i++;return unary()}return pow()}
function pow(){const b=prim();ws();if(s[i]==='^'){i++;return Math.pow(b,unary())}return b}
function mul(){let v=unary();for(;;){ws();const c=s[i];if(c==='*'){i++;v*=unary()}else if(c==='/'){i++;const d=unary();if(d===0)throw new Error('div0');v/=d}else if(c==='%'){i++;const d=unary();if(d===0)throw new Error('mod0');v%=d}else return v}}
function add(){let v=mul();for(;;){ws();const c=s[i];if(c==='+'){i++;v+=mul()}else if(c==='-'){i++;v-=mul()}else return v}}
const v=add();ws();if(i<s.length)throw new Error('unexpected '+s[i]);return v}module.exports={evaluate}`,
  'topoSort with cycles': `function topoSort(deps){const nodes=new Set(Object.keys(deps));for(const d of Object.values(deps))for(const x of d)nodes.add(x);const all=[...nodes].sort();const state={};const path=[];const out=[];
function visit(n){if(state[n]===2)return;if(state[n]===1){const c=path.slice(path.indexOf(n)).concat(n);throw new Error('cycle: '+c.join(' -> '))}state[n]=1;path.push(n);for(const d of [...(deps[n]||[])].sort())visit(d);path.pop();state[n]=2;out.push(n)}
const indeg={};for(const n of all)indeg[n]=0;for(const n of all)for(const d of deps[n]||[])indeg[n]++;
for(const n of all)visit(n);
// Kahn with alphabetical tie-break for determinism
const res=[];const done=new Set();const rem=new Set(all);while(rem.size){const ready=[...rem].filter(n=>(deps[n]||[]).every(d=>done.has(d))).sort();const n=ready[0];res.push(n);done.add(n);rem.delete(n)}return res}module.exports={topoSort}`,
  'mapLimit (async pool)': `async function mapLimit(items,limit,fn){if(!Number.isInteger(limit)||limit<1)throw new RangeError('limit');const res=new Array(items.length);let next=0,failed=false,err;
async function worker(){while(!failed&&next<items.length){const i=next++;try{res[i]=await fn(items[i],i)}catch(e){if(!failed){failed=true;err=e}return}}}
await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));if(failed)throw err;return res}module.exports={mapLimit}`,
  'minimal line diff': `function lineDiff(a,b){const n=a.length,m=b.length;const d=Array.from({length:n+1},()=>new Array(m+1).fill(0));for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)d[i][j]=a[i]===b[j]?d[i+1][j+1]+1:Math.max(d[i+1][j],d[i][j+1]);const out=[];let i=0,j=0;while(i<n&&j<m){if(a[i]===b[j]){out.push({type:'same',line:a[i]});i++;j++}else if(d[i+1][j]>=d[i][j+1]){out.push({type:'del',line:a[i++]})}else out.push({type:'add',line:b[j++]})}while(i<n)out.push({type:'del',line:a[i++]});while(j<m)out.push({type:'add',line:b[j++]});return out}module.exports={lineDiff}`,
  'fix deepMerge (4 bugs)': `const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);function clone(v){if(Array.isArray(v))return v.map(clone);if(isObj(v)){const o={};for(const k of Object.keys(v)){if(k==='__proto__'||k==='constructor'||k==='prototype')continue;o[k]=clone(v[k])}return o}return v}
function deepMerge(t,s){const out=clone(t);for(const k of Object.keys(s||{})){if(k==='__proto__'||k==='constructor'||k==='prototype')continue;const v=s[k];if(v===undefined)continue;out[k]=isObj(v)&&isObj(out[k])?deepMerge(out[k],v):clone(v)}return out}module.exports={deepMerge}`,
};
