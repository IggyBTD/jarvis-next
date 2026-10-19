import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runVerification } from '../../scripts/opencode-verify.js';

const BIN = path.resolve('tests/mocks/fake-opencode-bin.js');
const run = (shell) => runVerification({ command: process.execPath, argsPrefix: [BIN], extraEnv: { FAKE_OPENCODE_SHELL: shell }, pinned: '1.19.1', settleMs: 700 });

test('verification script detects a shell route that bypasses permissions, one that asks, and one that refuses', async () => {
  const bypass = await run('bypass');
  assert.match(bypass.shellRoute, /RAN WITHOUT ASKING/);
  assert.equal(bypass.versionOk, true);
  assert.equal(bypass.routes.permissionReply, 'new');
  assert.match(bypass.staleReply, /returns success and does nothing/);
  assert.match((await run('ask')).shellRoute, /asks permission first/);
  assert.match((await run('refuse')).shellRoute, /refused \(403\)/);
});
