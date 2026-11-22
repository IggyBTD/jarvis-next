// The server's project list: whole-list replace, every field checked and cut, bad entries and duplicates dropped, change announced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjects } from '../../server/core/projects.js';

test('set keeps good entries, cuts long fields, drops bad and duplicate ones, and announces the change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  let changes = 0;
  const p = createProjects({ dir, onChange: () => { changes += 1; } });
  assert.deepEqual(p.list(), []);
  const out = p.set([{ id: 'p1', name: 'A'.repeat(100), instructions: 'x', created: 5 }, { id: 'p1', name: 'dup' }, { id: '../evil', name: 'bad' }, null, { id: 'p2', name: '' }]);
  assert.deepEqual(out.map((x) => x.id), ['p1', 'p2']);
  assert.equal(out[0].name.length, 60);
  assert.equal(out[1].name, 'Untitled');
  assert.equal(changes, 1);
  assert.deepEqual(p.list().map((x) => x.id), ['p1', 'p2']); // read back from the file
  assert.throws(() => p.set('nope'), /at most 200/);
  assert.throws(() => p.set(Array.from({ length: 201 }, (_, i) => ({ id: `p${i}` }))), /at most 200/);
  fs.rmSync(dir, { recursive: true, force: true });
});
