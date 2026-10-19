// Runs the enabled actions for real on THIS machine. Only with JARVIS_REAL_ACTIONS=1 (npm run test:real). Read-only actions only;
// anything that changes the machine (volume, lock, game mode) is listed in HUMAN_TODO.md for you to try by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/core/config.js';
import { createRegistry } from '../../agent/registry/mod.js';

const on = process.env.JARVIS_REAL_ACTIONS === '1';
test('read-only actions work on this machine', { skip: !on && 'set JARVIS_REAL_ACTIONS=1' }, async () => {
  const cfg = loadConfig();
  const id = process.platform === 'darwin' ? 'mac' : 'pc';
  const reg = createRegistry({ cfg, machineId: id });
  for (const name of ['get_system_info', 'cpu_usage', 'memory_usage', 'disk_usage', 'uptime', 'get_volume']) {
    const r = await reg.execute(name);
    assert.equal(r.ok, true, `${name}: ${r.error}`);
  }
});
