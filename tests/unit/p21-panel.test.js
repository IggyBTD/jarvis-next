// What the panel's tabs rest on: the name of a model as a person says it, and the PC readings that need no sensor program.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettyModelName } from '../../src/core/model-name.js';
import { createBasicProvider, createPcProvider } from '../../server/telemetry/index.js';

test('model names lose their quantisation and packaging tags', () => {
  const cases = {
    'unsloth/qwen3.8-27b': 'Qwen 3.8 27B',
    'Qwen3.8 27B UD': 'Qwen 3.8 27B',
    'Qwen3.8-27B-UD-Q3_K_XL.gguf': 'Qwen 3.8 27B',
    'qwen/qwen3-coder-30b': 'Qwen 3 Coder 30B',
    'qwen/qwen3-coder-30b-a3b-instruct-q4_k_m.gguf': 'Qwen 3 Coder 30B',
    'openai/gpt-oss-20b': 'GPT OSS 20B',
    'qwen/qwen3-vl-8b': 'Qwen 3 VL 8B',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(prettyModelName(from), to, from);
  assert.equal(prettyModelName(''), '');
});

test('basic readings: load, memory and free space', async () => {
  const p = createBasicProvider();
  await p.sample(); // the first sample has no load yet: it needs two readings
  await new Promise((r) => setTimeout(r, 30));
  const m = await p.sample();
  assert.ok(m.Memory_Total > 0 && m.Memory_Usage > 0 && m.Memory_Usage <= m.Memory_Total);
  assert.ok(m.Storage_Total_Space > 0 && m.Storage_Free_Space >= 0);
  assert.ok(m.CPU_Load >= 0 && m.CPU_Load <= 100);
});

test('the PC provider adds the sensor program\'s numbers, and says when it is not running', async () => {
  const basic = { sample: async () => ({ CPU_Load: 5, Memory_Usage: 10, Memory_Total: 32 }) };
  const down = createPcProvider({ lhm: { sample: async () => { throw new Error('refused'); } }, basic });
  assert.deepEqual(await down.sample(), { CPU_Load: 5, Memory_Usage: 10, Memory_Total: 32, Sensors_Basic: 1 });
  const up = createPcProvider({ lhm: { sample: async () => ({ CPU_Load: 7, GPU_Temperature: 50 }) }, basic });
  assert.deepEqual(await up.sample(), { CPU_Load: 7, Memory_Usage: 10, Memory_Total: 32, GPU_Temperature: 50, Sensors_Basic: 0 });
});
