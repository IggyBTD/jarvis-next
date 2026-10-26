// Effort: medium adds nothing, the other levels add one note, and an unknown level is ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFORTS, DEFAULT_EFFORT, effortNote } from '../../shared/effort.js';
import { prettyModelName } from '../../src/core/model-name.js';

test('effort notes', () => {
  assert.deepEqual(EFFORTS, ['low', 'medium', 'high', 'max']);
  assert.equal(DEFAULT_EFFORT, 'medium');
  assert.equal(effortNote('medium'), '');
  assert.equal(effortNote('bogus'), '');
  assert.match(effortNote('low'), /briefly/);
  assert.match(effortNote('high'), /Research[\s\S]*check it briefly/);
  assert.match(effortNote('max'), /plan[\s\S]*thoroughly/);
});

test('the abliterated model is named without its maker', () => assert.equal(prettyModelName('huihui-ai_qwen3-14b-abliterated'), 'Qwen 3 14B Abliterated'));
