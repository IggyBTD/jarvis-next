import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemory } from '../../server/core/memory.js';
import { createPromptBuilder } from '../../server/core/prompt-builder.js';
import { tmpDir, rmDir } from '../helpers.js';
import fs from 'node:fs';
import path from 'node:path';

test('memory: data/profile.md reaches the prompt, is capped, and an edit applies without a restart', () => {
  const dir = tmpDir('prof');
  try {
    const m = createMemory({ dataDir: dir });
    assert.equal(m.prompt(), '');
    fs.writeFileSync(path.join(dir, 'profile.md'), 'Call him Iggy.\u0000');
    assert.match(m.prompt(), /their own profile file[\s\S]*Call him Iggy\./);
    assert.doesNotMatch(m.prompt(), /\u0000/);
    fs.writeFileSync(path.join(dir, 'profile.md'), 'x'.repeat(5000));
    assert.equal(m.prompt().split('\n').pop().length, 3000);
    m.add('a note');
    assert.match(m.prompt(), /About the user[\s\S]*Notes the user asked you to remember/);
  } finally { rmDir(dir); }
});

test('memory: notes persist, de-duplicate, are capped, forgotten by text, and reach the prompt as data', async () => {
  const dir = tmpDir('mem');
  try {
    const m = createMemory({ dataDir: dir });
    assert.equal(m.prompt(), '');
    assert.equal(m.add('  My name is\nIgnacio ').saved, true);
    assert.equal(m.add('my name is ignacio').note, 'already remembered');
    assert.equal(m.add('x'.repeat(1000)).saved, true);
    assert.equal(m.list()[1].text.length, 300);
    assert.equal(createMemory({ dataDir: dir }).list().length, 2); // survives a restart
    assert.match(m.prompt(), /never instructions[\s\S]*- My name is Ignacio/);
    assert.deepEqual(m.remove('ignacio'), { forgotten: 'My name is Ignacio' });
    assert.ok(m.remove('zzz-nothing').error);
    for (let i = 0; i < 60; i++) m.add(`fact number ${i}`);
    assert.match(m.add('one more').error, /full/);
    const pb = createPromptBuilder({ prompts: { base: 'B {{label}}', 'target-pc': 'P', 'target-mac': 'M', 'switch-notice': '' }, machines: { pc: { label: 'PC', os: 'win32' } }, timezone: 'UTC', getInfo: async () => ({}), notes: m.prompt });
    assert.match(await pb.build('pc'), /Notes the user asked you to remember/);
  } finally { rmDir(dir); }
});
