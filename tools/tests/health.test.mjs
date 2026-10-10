// Model-health rows (health.js). Run: node --test tools/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth } from '../../src/core/health.js';

const by = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));
const telemetry = { GPU_VRAM_Usage: 17.64, GPU_VRAM_Total: 24, GPU_Compute_Load: 88.2, GPU_Temperature: 67.4 };

test('normal readings', () => {
  const r = by(buildHealth({ telemetry, model: { tps: 31.26, ctxUsed: 5400, ctxMax: 32768 } }));
  assert.equal(r.vram.text, '17.6 / 24 GB');
  assert.ok(Math.abs(r.vram.ratio - 17.64 / 24) < 1e-9);
  assert.equal(r.load.text, '88%');
  assert.equal(r.temp.text, '67°C');
  assert.ok(Math.abs(r.temp.ratio - 67.4 / 90) < 1e-9);
  assert.equal(r.speed.text, '31.3 t/s');
  assert.equal(r.speed.bar, false);
  assert.equal(r.context.text, '5.4K / 32.8K');
  assert.ok(Math.abs(r.context.ratio - 5400 / 32768) < 1e-9);
});

test('missing sensor values are N/A with no bar fill, never a healthy default', () => {
  const r = by(buildHealth({ telemetry: {}, model: {} }));
  for (const k of ['vram', 'load', 'temp']) { assert.equal(r[k].text, 'N/A'); assert.equal(r[k].ratio, null); }
  assert.equal(r.speed.text, '--');
  assert.equal(r.context.text, '--');
  assert.equal(r.context.ratio, null);
});

test('offline sensors blank every GPU row even with old data, model rows stay', () => {
  const r = by(buildHealth({ telemetry, offline: true, model: { tps: 20, ctxUsed: 100, ctxMax: 1000 } }));
  assert.deepEqual(['vram', 'load', 'temp'].map((k) => r[k].text), ['N/A', 'N/A', 'N/A']);
  assert.equal(r.speed.text, '20.0 t/s');
  assert.equal(r.context.ratio, 0.1);
});

test('ratios are clamped and bad numbers are treated as missing', () => {
  const r = by(buildHealth({ telemetry: { GPU_VRAM_Usage: 30, GPU_VRAM_Total: 24, GPU_Compute_Load: 140, GPU_Temperature: NaN }, model: { ctxUsed: 50000, ctxMax: 32768 } }));
  assert.equal(r.vram.ratio, 1);
  assert.equal(r.load.ratio, 1);
  assert.equal(r.temp.text, 'N/A');
  assert.equal(r.context.ratio, 1);
});

test('VRAM without a total still shows the usage', () => {
  const r = by(buildHealth({ telemetry: { GPU_VRAM_Usage: 9.5 } }));
  assert.equal(r.vram.text, '9.5 GB');
  assert.equal(r.vram.ratio, null);
});

test('context max known, nothing used yet', () => {
  const r = by(buildHealth({ model: { ctxMax: 32768 } }));
  assert.equal(r.context.text, '-- / 32.8K');
  assert.equal(r.context.ratio, null);
});
