import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../../scripts/launch-app.js';
import { packIco } from '../../scripts/make-icon.js';

test('launch: starts the agent and server only when they are down, waits for the server, opens the app window with the profile and the token fragment', async () => {
  const up = new Set();
  const started = [];
  let opened;
  const probe = async (_h, port) => up.has(port);
  const start = (script) => { started.push(script); up.add(script.startsWith('server') ? 7410 : 7421); };
  await launch({ platform: 'win32', probe, start, exists: (f) => /msedge/.test(f), open: (exe, args) => { opened = { exe, args }; }, wait: async () => {} });
  assert.deepEqual(started, ['agent/index.js', 'server/index.js']);
  assert.match(opened.exe, /msedge/);
  assert.match(opened.args[0], /^--app=http:\/\/127\.0\.0\.1:7410\/#token=\w{20,}/);
  assert.ok(opened.args.some((a) => /data[\\/]app-profile$/.test(a)));

  started.length = 0;
  await launch({ platform: 'win32', probe, start, exists: () => true, open: () => {}, wait: async () => {} });
  assert.deepEqual(started, []); // already running: only a window is opened

  await assert.rejects(launch({ platform: 'win32', probe: async () => false, start: () => {}, exists: () => true, open: () => {}, wait: async () => {} }), /did not start/);
  await assert.rejects(launch({ platform: 'win32', probe: async () => true, exists: () => false, open: () => {} }), /Edge or Chrome/);
});

test('the .ico packs each PNG with its size and offset', () => {
  const ico = packIco([{ size: 16, png: Buffer.from('aa') }, { size: 256, png: Buffer.from('bbb') }]);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico[6], 16);
  assert.equal(ico[22], 0); // 256 is written as 0
  assert.equal(ico.readUInt32LE(6 + 12), 38); // first image starts after the 6 + 2 x 16 byte header
  assert.equal(ico.subarray(38).toString(), 'aabbb');
});

test('launch-old: does nothing if the old dev server already answers, refuses a missing project, otherwise runs npm run tauri dev in the old folder', async () => {
  const { launchOld } = await import('../../scripts/launch-old.js');
  const calls = [];
  const run = (cmd, args, opts) => { calls.push([args.join(' '), opts.cwd]); return { unref() {} }; };
  assert.deepEqual(await launchOld({ dir: process.cwd(), probe: async () => true, run }), { already: true });
  assert.deepEqual(await launchOld({ dir: process.cwd(), probe: async () => false, run }), { already: false });
  assert.deepEqual(calls, [['/d /c npm run tauri dev', process.cwd()]]);
  await assert.rejects(launchOld({ dir: 'C:/nowhere-at-all', probe: async () => false, run }), /not at/);
});
