// Security fix F1-4: the chokepoint holds by construction. Raw agent access is not handed out, and the static check catches what
// it used to miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../scripts/check-chokepoint.js';
import { tmpDir, rmDir, testConfig } from '../helpers.js';
import { createToolRouter } from '../../server/core/tool-router.js';
import { createPolicy } from '../../server/core/policy.js';
import { ROOT } from '../../server/core/config.js';

const planted = (files) => {
  const root = tmpDir('chk');
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
  return root;
};

test('F1-4: the check fails for a new file that reaches an agent through router.capabilities()', () => {
  const root = planted({ 'server/api/new-route.js': "export const go = (router) => router.capabilities('pc').call('kill_process', { pid: 1 });\n" });
  try { assert.ok(scan(root).some((p) => /new-route\.js.*capabilities/.test(p)), scan(root).join('\n')); } finally { rmDir(root); }
});

test('F1-4: the check sees shell options, Function(, code hidden after a string with //, and scripts/', () => {
  const root = planted({
    'server/a.js': "import { spawn } from 'x'; spawn('cmd', [], { shell: 'cmd.exe' });\n",
    'server/b.js': "const shell = true; spawnLike('x', [], { shell });\n",
    'server/c.js': "const f = Function('return 1');\n",
    'server/d.js': "const u = \"a//b\"; eval(u);\n",
    'scripts/e.js': "import cp from 'node:child_process'; cp.exec('dir');\n",
    'server/ok.js': '// a comment that says never exec( anything, and never shell: true\nexport const fine = 1;\n',
  });
  try {
    const found = scan(root).join('\n');
    for (const f of ['server/a.js', 'server/b.js', 'server/c.js', 'server/d.js', 'scripts/e.js']) assert.match(found, new RegExp(f.replace('.', '\\.')), f);
    assert.doesNotMatch(found, /ok\.js/, 'a comment alone is not a finding');
  } finally { rmDir(root); }
  assert.deepEqual(scan(ROOT), [], 'the repository itself passes');
});

test('F1-4: router.capabilities().call reaches only system actions; anything else goes through invoke', async () => {
  const t = testConfig();
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }); };
  const router = createToolRouter({ cfg: t.cfg, policy: createPolicy(t.cfg.policy), gate: { requestApproval: async () => ({ approved: false }), setExecutor() {} }, audit: { append: async () => {} }, tokens: () => 'x'.repeat(64), fetchImpl });
  try {
    const caps = router.capabilities('pc');
    const r = await caps.call('kill_process', { pid: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /system/);
    assert.equal(calls.length, 0, 'nothing reached the agent');
    assert.equal((await caps.call('git_changes', { path: '.', name: 'x' })).ok, true);
  } finally { t.cleanup(); }
});
