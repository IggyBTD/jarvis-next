// Static check of the one rule that matters: every tool call goes tool-router -> policy -> gate -> audit -> agent.
//   1. Only server/core/tool-router.js may import agent-client.js (nothing else reaches an agent).
//   2. Only server/core/llm-client.js may use the model backend address (nothing else calls the model).
//   3. No string-built commands anywhere: no exec/execSync/eval/Function, no shell option of any kind.
//   4. child_process is imported only by the agent's run helper, the sidecar managers and the two launchers; the server never imports it.
//   5. router.capabilities() (sidecar routes and system actions) is used only by the files that are built on it; anything new goes
//      through router.invoke.
// It reads code lines whole (a line that is only a comment is skipped), so code after a string that holds "//" is still read.
// Name helpers runProgram, never exec: the scanner looks for the word.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../shared/util.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'data', 'tests', 'bench-jarvis']);
// Developer tools in scripts/ that are not part of the running system (icons, benchmarks, probes, a dev-server killer): not scanned.
const DEV_TOOL = /^scripts\/(bench-|build-icons|finalise-icons|versions|make-icon|make-shortcut|gen-actions|audit-css|contrast|measure-ui|phone-preview|probe-|launch-old)/;
const CHILD_PROCESS_OK = (r) => r === 'agent/registry/common.js' || r.startsWith('agent/sidecars/') || r.startsWith('sidecars/browser-guard/') || r === 'scripts/launch-app.js' || r === 'scripts/open-mac.js';
const CAPABILITIES_OK = new Set(['server/core/tool-router.js', 'server/core/agent-tasks.js', 'server/core/opencode-bridge.js', 'server/index.js']);
const MODEL_ADDRESS_OK = new Set(['server/core/llm-client.js', 'server/core/config-schemas.js']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) yield full;
  }
}
const codeOf = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

export function scan(root) {
  const problems = [];
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  for (const top of ['server', 'agent', 'shared', 'sidecars/browser-guard', 'scripts']) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const r = rel(file);
      if (DEV_TOOL.test(r) || r === 'scripts/check-chokepoint.js') continue; // the check itself is made of the patterns
      const text = codeOf(fs.readFileSync(file, 'utf8'));
      const add = (msg) => problems.push(`${r}: ${msg}`);
      if (/from\s+['"][^'"]*agent-client(\.js)?['"]|import\(\s*['"][^'"]*agent-client/.test(text) && r !== 'server/core/tool-router.js') add('imports agent-client; only tool-router may reach an agent');
      if (/\bbaseUrl\b/.test(text) && !MODEL_ADDRESS_OK.has(r)) add('uses the model backend address; only llm-client may call the model');
      if (/(?<![.\w$])(exec|execSync|eval)\s*\(|\bFunction\s*\(|\bshell\s*:\s*(true|['"`])|[{,]\s*shell\s*[,}]/.test(text)) add('string-built command, eval or a shell option (use runProgram with an argument array)');
      if (/from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process/.test(text) && !CHILD_PROCESS_OK(r)) add('imports child_process outside the agent run helper, the sidecar managers and the launchers');
      if (/\.capabilities\s*\(/.test(text) && !CAPABILITIES_OK.has(r)) add('calls router.capabilities(); go through router.invoke (policy, gate, audit) instead');
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
