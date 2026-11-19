// Proves each task is sound: the seed must NOT be solved, seed + solution overlay must be solved.
const fs = require('fs'), path = require('path'), os = require('os'); const { spawnSync } = require('child_process');
const only = process.argv[2] ? process.argv[2].split(',') : null;
const sh = (c, cwd) => spawnSync(c, { cwd, shell: true, encoding: 'utf8', timeout: 300000 });
function score(work, dir, task) {
  fs.cpSync(path.join(dir, 'hidden'), path.join(work, '__hidden__'), { recursive: true });
  if (task.pre) sh(task.pre, work);
  const r = sh(`node ${task.scorer || '--test --test-reporter=tap "__hidden__/*.test.js"'}`, work); const o = r.stdout + r.stderr;
  const g = (k) => Number((o.match(new RegExp('# ' + k + ' (\\d+)')) || [])[1] || 0);
  return { pass: g('pass'), fail: g('fail'), solved: g('fail') === 0 && g('pass') > 0 && r.status === 0, tail: o.slice(-300) };
}
for (const id of fs.readdirSync(path.join(__dirname, 'tasks')).sort()) {
  if (only && !only.some((o) => id.startsWith(o))) continue;
  const dir = path.join(__dirname, 'tasks', id), task = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8'));
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'val-')); fs.cpSync(path.join(dir, 'seed'), a, { recursive: true });
  const s = score(a, dir, task);
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'val-')); fs.cpSync(path.join(dir, 'seed'), b, { recursive: true }); fs.cpSync(path.join(dir, 'solution'), b, { recursive: true });
  const v = score(b, dir, task);
  const ok = !s.solved && v.solved;
  console.log(ok ? 'OK  ' : 'BAD ', id, `seed ${s.pass}p/${s.fail}f`, `solution ${v.pass}p/${v.fail}f`); if (!ok) console.log(!s.solved ? v.tail : s.tail);
}
