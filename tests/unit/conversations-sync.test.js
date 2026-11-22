// A chat saved, renamed, pinned or deleted tells the server (onChange), which tells every device to refresh its list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConversations } from '../../server/core/conversations.js';

test('onChange fires on create, append, patch and remove', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-sync-'));
  const seen = [];
  const c = createConversations({ dir, onChange: (id) => seen.push(id) });
  const conv = c.create('c-sync1');
  c.append(conv, { role: 'user', content: 'hi' });
  c.patch('c-sync1', { title: 'Renamed' });
  c.remove('c-sync1');
  assert.deepEqual(seen, ['c-sync1', 'c-sync1', 'c-sync1', 'c-sync1']);
  fs.rmSync(dir, { recursive: true, force: true });
});
