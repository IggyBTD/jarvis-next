// Long JARVIS-style tasks for the agent benchmark (node scripts/bench-agent.js --suite jarvis).
// Each folder in scripts/bench-jarvis/ is one task:
//   prompt.txt   what the user asks the agent
//   start/       the repo the agent sees (README.md, src/, test/ with the visible tests)
//   hidden/      extra tests, run after the agent stops, never shown (go to test-hidden/)
//   solution/    reference fix, used only to prove the task can be passed (tests/unit/p14-bench-jarvis.test.js)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bench-jarvis');

function tree(dir, base = dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, tree(p, base));
    else out[path.relative(base, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

export const JARVIS_TASKS = fs.readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .map((id) => {
    const d = path.join(DIR, id);
    return {
      id,
      prompt: fs.readFileSync(path.join(d, 'prompt.txt'), 'utf8').trim(),
      files: tree(path.join(d, 'start')),
      hidden: Object.fromEntries(Object.entries(tree(path.join(d, 'hidden'))).map(([f, s]) => [`test-hidden/${f}`, s])),
      solution: tree(path.join(d, 'solution')),
    };
  });
