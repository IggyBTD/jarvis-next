// Pure-logic tests for the whiteboard: reply parser (board tag) and panel layouts.
// Run: node --test tools/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReply } from '../../src/core/tool-router.js';

const AREA = { w: 1168, h: 772 };

test('board tag, self-closing, between text', () => {
  const parts = parseReply('Here you go.\n<jarvis-board layout="split" panels="code, preview" />\nDone.');
  assert.deepEqual(parts.map((p) => p.kind), ['text', 'board', 'text']);
  assert.equal(parts[1].layout, 'split');
  assert.deepEqual(parts[1].panels, ['code', 'preview']);
});

test('board tag with explicit close tag, unknown layout dropped', () => {
  const parts = parseReply('<jarvis-board layout="diagonal" panels="a"></jarvis-board>after');
  assert.equal(parts[0].layout, '');
  assert.deepEqual(parts.map((p) => p.kind), ['board', 'text']);
  assert.equal(parts[1].text, 'after');
});

test('half-streamed board tag is never shown as text', () => {
  for (const partial of ['<jarvis-b', '<jarvis-board', '<jarvis-board layout="spl']) {
    const parts = parseReply(`ok ${partial}`);
    assert.deepEqual(parts.map((p) => p.kind), ['text']);
    assert.equal(parts[0].text.trim(), 'ok');
  }
});

test('artifacts and board tag together keep order', () => {
  const parts = parseReply('<jarvis-artifact id="a" type="table" title="T">{"columns":[],"rows":[]}</jarvis-artifact><jarvis-board panels="a" />');
  assert.deepEqual(parts.map((p) => p.kind), ['artifact', 'board']);
  assert.equal(parts[0].type, 'table');
});
