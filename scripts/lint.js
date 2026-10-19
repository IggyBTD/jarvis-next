// Syntax check of every JavaScript file the server, agent and tests use (node --check). Fast, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { runProgram } from '../agent/registry/common.js';
import { ROOT } from '../server/core/config.js';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (['node_modules', 'dist', 'data', '.git'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []));
let bad = 0;
for (const dir of ['server', 'agent', 'shared', 'scripts', 'sidecars/browser-guard', 'tests', 'src/core']) {
  for (const f of walk(path.join(ROOT, dir))) { const r = await runProgram({ file: process.execPath, args: ['--check', f] }); if (r.code !== 0) { bad += 1; console.error(`${path.relative(ROOT, f)}: ${r.stderr.split('\n')[0]}`); } }
}
console.log(bad ? `${bad} file(s) with syntax errors` : 'syntax check passed');
process.exit(bad ? 1 : 0);
