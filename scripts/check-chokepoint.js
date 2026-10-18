// Static check of the one rule that matters: every tool call goes tool-router -> policy -> gate -> audit -> agent.
//   1. Only server/core/tool-router.js may import agent-client.js (nothing else reaches an agent).
//   2. Only server/core/llm-client.js may use the model backend address (nothing else calls the model).
//   3. No string-built commands anywhere: no exec/execSync/eval/new Function, no shell:true.
//   4. child_process is imported only by agent/registry/common.js and agent/sidecars/*.js; the server never imports it.
// Name helpers runProgram, never exec: the scanner looks for the word.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../shared/util.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'data', 'tests']);
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) yield full;
  }
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

export function scan(root) {
  const problems = [];
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  for (const top of ['server', 'agent', 'shared', 'sidecars/browser-guard']) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const r = rel(file);
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      const add = (msg) => problems.push(`${r}: ${msg}`);
      if (/from\s+['"][^'"]*agent-client(\.js)?['"]|import\(\s*['"][^'"]*agent-client/.test(text) && r !== 'server/core/tool-router.js') add('imports agent-client; only tool-router may reach an agent');
      if (/\b(models|llm|modelCfg)\.baseUrl\b|\bbaseUrl\b[^\n]*\/chat\/completions/.test(text) && r !== 'server/core/llm-client.js') add('uses the model backend address; only llm-client may call the model');
      if (/\bexecSync\s*\(|\bexec\s*\(|\beval\s*\(|new\s+Function\s*\(|shell\s*:\s*true/.test(text)) add('string-built command or eval (use runProgram with an argument array)');
      if (/from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process/.test(text)
        && !(r === 'agent/registry/common.js' || r.startsWith('agent/sidecars/') || r.startsWith('sidecars/browser-guard/'))) add('imports child_process outside the agent run helper and the sidecar managers');
    }
  }
  return problems;
}

if (isMain(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = scan(root);
  if (problems.length) { console.error(`chokepoint check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`); process.exit(1); }
  console.log('chokepoint check passed');
}
