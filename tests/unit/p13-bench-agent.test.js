// The agent benchmark tasks are fair: each starts failing, the reference fix passes every visible and hidden test, and the prompt's test command finds the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AGENT_TASKS } from '../../scripts/bench-agent-tasks.js';
import { gradeDir } from '../../scripts/bench-agent.js';

const put = (dir, files) => { for (const [f, s] of Object.entries(files)) { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); } };

for (const task of AGENT_TASKS) {
  test(`agent task ${task.id}: fails at the start, passes with the reference fix`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-check-'));
    try {
      put(dir, task.files);
      const before = gradeDir(dir, task);
      assert.ok(before.passed < before.total, `${task.id} must start failing (${before.passed}/${before.total})`);
      const cmd = spawnSync(process.execPath, ['--test', 'test'], { cwd: dir, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
      assert.match(cmd.stdout + cmd.stderr, /(pass|tests) \d+/, '`node --test test` from the prompt must find the tests');
      put(dir, task.solution);
      const after = gradeDir(dir, task);
      assert.equal(after.passed, after.total, `${task.id} reference fix must pass everything (${after.passed}/${after.total})`);
      put(dir, { 'test/extra.test.js': "const test = require('node:test'); test('extra', () => {}); test('extra 2', () => {});\n" });
      assert.deepEqual(gradeDir(dir, task), after, 'tests added by the agent must not change the score');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
