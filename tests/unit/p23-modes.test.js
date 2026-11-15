// The five permission modes: what each answers without asking. T3 and arming files are never answered by Auto, Accept edits or Bypass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeAnswer } from '../../server/core/opencode-bridge.js';
import { MODES } from '../../shared/permission-modes.js';

const edit = { kind: 'edit', tier: 'T2', armed: false };
const shell = { kind: 'bash', cls: { class: 'ask' }, tier: 'T2', armed: false };
const readOnly = { kind: 'bash', cls: { class: 'allow' }, tier: 'T0', armed: false };
const destructive = { kind: 'bash', cls: { class: 'destructive' }, tier: 'T3', armed: false };
const outside = { kind: 'edit', tier: 'T3', armed: false };
const armed = { kind: 'edit', tier: 'T2', armed: true };

test('modes', () => {
  assert.deepEqual(MODES, ['auto', 'manual', 'accept-edits', 'plan', 'bypass']);
  const row = (mode) => [edit, shell, readOnly, destructive, outside, armed].map((r) => modeAnswer(mode, r));
  assert.deepEqual(row('auto'), ['once', null, 'once', null, null, null]); // Auto runs only the read-only allowlist by itself (F1-1)
  assert.deepEqual(row('manual'), [null, null, 'once', null, null, null]);
  assert.deepEqual(row('accept-edits'), ['once', null, 'once', null, null, null]);
  assert.deepEqual(row('plan'), ['reject', 'reject', 'once', 'reject', 'reject', 'reject']);
  assert.deepEqual(row('bypass'), ['once', 'once', 'once', null, null, null]);
});
