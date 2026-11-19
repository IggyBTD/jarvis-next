// Security fixes, stage C: per-device pairing (server/core/devices.js, docs/security/pairing-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDevices, LOCAL, DEFAULT_SCOPES, CODE_ALPHABET } from '../../server/core/devices.js';
import { tmpDir, rmDir } from '../helpers.js';

const LAN = '100.80.1.2';
const LOOP = '127.0.0.1';
const OLD = 'f'.repeat(64); // stands in for data/tokens/ui.token
const PIN = '271828';

// A fresh store in a temp dir with a clock the test moves. scryptN is low so the file runs fast.
function setup(t, opts = {}) {
  const dataDir = tmpDir('devices');
  t.after(() => rmDir(dataDir));
  const clock = { t: 1_800_000_000_000 };
  const devices = createDevices({ dataDir, now: () => clock.t, scryptN: 1024, ...opts });
  const pair = (kind, scopes) => {
    const { code } = devices.startPairing({ by: LOCAL, kind, scopes });
    const r = devices.completePairing({ code, name: `my ${kind}`, ip: LAN });
    return { ...r, who: devices.authenticate(r.token, { ip: LAN }) };
  };
  return { devices, clock, dataDir, pair, file: path.join(dataDir, 'devices.json') };
}
const wrongCode = (code) => (code[0] === 'A' ? 'B' : 'A') + code.slice(1);

test('two paired devices; revoking one leaves the other working', (t) => {
  const { devices, pair } = setup(t);
  const phone = pair('phone');
  const mac = pair('browser');
  assert.equal(phone.who.role, 'ui');
  assert.equal(phone.who.kind, 'phone');
  assert.deepEqual(phone.who.scopes, DEFAULT_SCOPES.phone);
  assert.deepEqual(mac.who.scopes, DEFAULT_SCOPES.browser);
  assert.notEqual(phone.token, mac.token);
  assert.deepEqual(devices.revoke(phone.device.id, { by: LOCAL }), { ok: true, id: phone.device.id });
  assert.equal(devices.authenticate(phone.token, { ip: LAN }), null);
  assert.equal(devices.can(phone.who, 'chat').ok, false, 'a socket that was open before the revoke is refused too');
  assert.equal(devices.authenticate(mac.token, { ip: LAN }).deviceId, mac.device.id);
  assert.equal(devices.can(mac.who, 'chat').ok, true);
  assert.ok(devices.list().find((d) => d.id === phone.device.id).revokedAt);
});

test('rotate has no grace, for one device and for all; a second instance on the same folder sees it at once', (t) => {
  const { devices, pair, dataDir } = setup(t);
  const starter = createDevices({ dataDir }); // what the starter on 7411 holds
  const phone = pair('phone');
  const mac = pair('browser');
  assert.ok(starter.authenticate(phone.token));
  const one = devices.rotate(phone.device.id, { by: LOCAL }).tokens;
  assert.equal(one.length, 1);
  assert.equal(devices.authenticate(phone.token), null);
  assert.equal(starter.authenticate(phone.token), null);
  assert.equal(starter.authenticate(one[0].token).deviceId, phone.device.id);
  assert.ok(devices.authenticate(mac.token), 'the other device is untouched');
  const all = devices.rotate('all', { by: LOCAL }).tokens;
  assert.equal(all.length, 2);
  for (const old of [one[0].token, mac.token]) assert.equal(starter.authenticate(old), null);
  for (const fresh of all) assert.equal(starter.authenticate(fresh.token).deviceId, fresh.id);
  // a device may renew its own token, not another one's
  const me = devices.authenticate(all[0].token);
  assert.ok(devices.rotate(me.deviceId, { by: me, ip: LAN }).tokens);
  assert.ok(devices.rotate(all[1].id, { by: me, ip: LAN }).error);
  assert.ok(devices.rotate('all', { by: me, ip: LAN }).error);
});

test('scopes: chat cannot approve; approve needs the PIN for T3; settings and admin are apart', (t) => {
  const { devices, pair } = setup(t);
  const chatOnly = pair('phone', ['chat']);
  const phone = pair('phone');
  const mac = pair('browser');
  assert.ok(devices.setPin({ by: LOCAL, newPin: PIN }).ok);

  assert.equal(devices.can(chatOnly.who, 'chat').ok, true);
  assert.equal(devices.can(chatOnly.who, 'target').ok, true);
  assert.equal(devices.can(chatOnly.who, 'deny').ok, true);
  for (const tier of ['T0', 'T1', 'T2', 'T3']) assert.equal(devices.can(chatOnly.who, 'approve', { tier, pin: PIN, ip: LOOP }).ok, false);
  assert.equal(devices.can(chatOnly.who, 'settings').ok, false);

  for (const tier of ['T0', 'T1', 'T2']) assert.equal(devices.can(phone.who, 'approve', { tier, ip: LAN }).ok, true);
  assert.equal(devices.can(phone.who, 'approve', { tier: 'T3', ip: LAN }).ok, false);
  assert.equal(devices.can(phone.who, 'approve', { tier: 'T3', ip: LOOP }).ok, false, 'loopback alone is not the desktop');
  assert.equal(devices.can(phone.who, 'approve', { ip: LAN }).ok, false, 'a missing tier is rated T3');
  assert.equal(devices.can(phone.who, 'approve', { tier: 'T9', ip: LAN }).ok, false);
  assert.equal(devices.can(phone.who, 'approve', { tier: 'T3', pin: PIN, ip: LAN }).ok, true);
  assert.equal(devices.can(phone.who, 'settings').ok, false);
  assert.equal(devices.can(phone.who, 'admin', { pin: PIN, ip: LAN }).ok, false, 'the PIN does not add a scope');

  assert.equal(devices.can(mac.who, 'settings').ok, true);
  assert.equal(devices.can(mac.who, 'admin', { ip: LAN }).ok, false);
  assert.equal(devices.can(mac.who, 'admin', { pin: PIN, ip: LAN }).ok, true);
  assert.equal(devices.can(mac.who, 'device', { id: mac.device.id }).ok, true, 'its own id');
  assert.equal(devices.can(mac.who, 'device', { id: phone.device.id, ip: LAN }).ok, false);
  // a forged principal gets what the store says, not what the object says
  assert.equal(devices.can({ ...chatOnly.who, scopes: ['chat', 'approve', 'settings'], kind: 'desktop' }, 'approve', { tier: 'T0', ip: LOOP }).ok, false);
});

test('a desktop on loopback approves T3 without the PIN; from elsewhere it needs the PIN; only the local command pairs one', (t) => {
  const { devices, pair } = setup(t);
  const desk = pair('desktop');
  assert.equal(desk.who.kind, 'desktop');
  for (const ip of [LOOP, '::1', '::ffff:127.0.0.1']) assert.equal(devices.can(desk.who, 'approve', { tier: 'T3', ip }).ok, true);
  assert.equal(devices.can(desk.who, 'admin', { ip: LOOP }).ok, true);
  for (const ip of [LAN, undefined, 'proxied', {}]) assert.equal(devices.can(desk.who, 'approve', { tier: 'T3', ip }).ok, false);
  // the desktop sets the first PIN, starts pairings and revokes; it cannot mint another desktop
  assert.ok(devices.setPin({ by: desk.who, newPin: PIN, ip: LOOP }).ok);
  assert.equal(devices.can(desk.who, 'approve', { tier: 'T3', pin: PIN, ip: LAN }).ok, true);
  assert.ok(devices.startPairing({ by: desk.who, kind: 'phone', ip: LOOP }).code);
  assert.ok(devices.startPairing({ by: desk.who, kind: 'desktop', ip: LOOP }).error);
  assert.ok(devices.startPairing({ by: desk.who, kind: 'phone', ip: LAN }).error, 'not from the network without the PIN');
  assert.ok(devices.startPairing({ by: desk.who, kind: 'phone', ip: LAN, pin: PIN }).code);
  const phone = pair('phone');
  assert.ok(devices.startPairing({ by: phone.who, kind: 'phone', ip: LAN, pin: PIN }).error, 'a phone has no settings scope');
  assert.ok(devices.revoke(desk.device.id, { by: phone.who, pin: PIN, ip: LAN }).error);
  assert.ok(devices.revoke(phone.device.id, { by: desk.who, ip: LOOP }).ok);
  assert.ok(devices.revoke(desk.device.id, { by: desk.who, ip: LAN }).ok, 'a device may sign itself out');
});

test('PIN: wrong ones lock it, the right one is refused while locked, the lock ends and grows', (t) => {
  const { devices, pair, clock, file } = setup(t);
  const phone = pair('phone');
  assert.equal(devices.checkPin(PIN).ok, false, 'no PIN set yet');
  assert.ok(devices.setPin({ by: LOCAL, newPin: '123' }).error, 'too short');
  assert.ok(devices.setPin({ by: phone.who, newPin: PIN, ip: LAN }).error, 'a phone cannot set it');
  assert.ok(devices.setPin({ by: LOCAL, newPin: PIN }).ok);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(PIN));
  assert.equal(devices.info().pinSet, true);

  const t3 = (pin) => devices.can(phone.who, 'approve', { tier: 'T3', pin, ip: LAN });
  for (let i = 0; i < 4; i++) assert.equal(t3('000000').reason, 'wrong PIN');
  assert.equal(t3(PIN).ok, true, 'four wrong, then right: the count starts again');
  for (let i = 0; i < 5; i++) assert.equal(t3('000000').ok, false);
  assert.equal(t3(PIN).reason, 'the PIN is locked');
  assert.ok(devices.info().pinLockedUntil > clock.t);
  assert.equal(devices.can(phone.who, 'approve', { tier: 'T2', ip: LAN }).ok, true, 'the lock is on T3 only');
  clock.t += 15 * 60_000 + 1;
  for (let i = 0; i < 5; i++) assert.equal(t3('111111').ok, false);
  clock.t += 15 * 60_000 + 1;
  assert.equal(t3(PIN).ok, false, 'the second lock lasts twice as long');
  clock.t += 15 * 60_000;
  assert.equal(t3(PIN).ok, true);
  // changing it over the network needs the current PIN; the local command replaces a forgotten one
  const mac = pair('browser');
  assert.ok(devices.setPin({ by: mac.who, pin: 'nope-nope', newPin: '314159', ip: LAN }).error);
  assert.ok(devices.setPin({ by: mac.who, pin: PIN, newPin: '314159', ip: LAN }).ok);
  assert.equal(devices.checkPin(PIN).ok, false);
  assert.equal(devices.checkPin('314159').ok, true);
  for (const bad of [undefined, null, '', 314159, {}, [], 'x'.repeat(65)]) assert.equal(devices.checkPin(bad).ok, false);
  // the cost used outside tests
  const real = createDevices({ dataDir: path.dirname(file) });
  assert.ok(real.setPin({ by: LOCAL, newPin: PIN }).ok);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pin.N, 32768);
  assert.deepEqual([real.checkPin(PIN).ok, real.checkPin('000000').ok], [true, false]);
});

test('a pairing code works once, is typed loosely, and expires', (t) => {
  const { devices, clock } = setup(t);
  const { code, expiresAt } = devices.startPairing({ by: LOCAL, kind: 'phone' });
  assert.equal(code.length, 8);
  assert.ok([...code].every((ch) => CODE_ALPHABET.includes(ch)));
  assert.equal(expiresAt, clock.t + 5 * 60_000);
  const typed = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
  const first = devices.completePairing({ code: typed, name: '  Hugo\u0007 phone\n ', ip: LAN });
  assert.match(first.token, /^[0-9a-f]{64}$/);
  assert.equal(first.device.name, 'Hugo phone');
  assert.equal(first.device.hash, undefined);
  assert.ok(devices.completePairing({ code, name: 'again', ip: '100.80.1.3' }).error, 'single use');

  const second = devices.startPairing({ by: LOCAL, kind: 'browser' }).code;
  clock.t += 5 * 60_000;
  assert.ok(devices.completePairing({ code: second, name: 'late', ip: '100.80.1.4' }).error, 'expired');
  // the new device cannot pick its kind or scopes
  const third = devices.startPairing({ by: LOCAL, kind: 'phone', scopes: ['chat'] }).code;
  const d = devices.completePairing({ code: third, name: 'x', kind: 'desktop', scopes: ['settings'], ip: '100.80.1.5' }).device;
  assert.deepEqual([d.kind, d.scopes], ['phone', ['chat']]);
  // no more than three codes wait at a time
  for (let i = 0; i < 3; i++) assert.ok(devices.startPairing({ by: LOCAL }).code);
  assert.ok(devices.startPairing({ by: LOCAL }).error);
});

test('too many wrong codes are refused, even with the right one afterwards', (t) => {
  const { devices } = setup(t);
  // per address: five wrong codes, then the right one from that address is refused, from another it works
  const a = devices.startPairing({ by: LOCAL }).code;
  for (let i = 0; i < 5; i++) assert.equal(devices.completePairing({ code: wrongCode(a), name: 'x', ip: '100.80.9.9' }).error, 'wrong or expired code');
  assert.match(devices.completePairing({ code: a, name: 'x', ip: '100.80.9.9' }).error, /too many/);
  assert.ok(devices.completePairing({ code: a, name: 'x', ip: LAN }).token);
  // across addresses: ten wrong codes kill the waiting code
  const b = devices.startPairing({ by: LOCAL }).code;
  for (let i = 0; i < 10; i++) assert.ok(devices.completePairing({ code: wrongCode(b), name: 'x', ip: `100.81.0.${i}` }).error);
  assert.ok(devices.completePairing({ code: b, name: 'x', ip: '100.82.0.1' }).error);
  assert.equal(devices.info().codesWaiting, 0);
});

test('the store holds no token, code or PIN in clear text, and list() holds no hash', (t) => {
  const { devices, pair, file } = setup(t);
  const phone = pair('phone');
  const waiting = devices.startPairing({ by: LOCAL }).code;
  devices.setPin({ by: LOCAL, newPin: PIN });
  const fresh = devices.rotate(phone.device.id, { by: LOCAL }).tokens[0].token;
  const text = fs.readFileSync(file, 'utf8');
  for (const secret of [phone.token, fresh, waiting, PIN]) assert.ok(!text.includes(secret));
  const stored = JSON.parse(text);
  const listed = JSON.stringify([devices.list(), devices.info()]);
  for (const hash of [stored.devices[0].hash, stored.codes[0].hash, stored.pin.hash, stored.pin.salt]) assert.ok(hash && !listed.includes(hash));
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['devices.json'], 'no lock or temp file is left behind');
});

test('the old shared token: chat and approve, T3 only with the PIN, gone once revoked', (t) => {
  let old = OLD;
  const { devices, pair, file } = setup(t, { legacyToken: () => old });
  const who = devices.authenticate(OLD, { ip: LAN });
  assert.deepEqual([who.deviceId, who.kind, who.scopes], ['legacy', 'legacy', ['chat', 'approve']]);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(OLD));
  assert.equal(devices.can(who, 'chat').ok, true);
  assert.equal(devices.can(who, 'approve', { tier: 'T2', ip: LAN }).ok, true);
  assert.equal(devices.can(who, 'approve', { tier: 'T3', ip: LAN }).ok, false);
  assert.equal(devices.can(who, 'approve', { tier: 'T3', ip: 'proxied' }).ok, false);
  assert.equal(devices.can(who, 'settings', { ip: LAN }).ok, false);
  // migration: on the PC itself (the desktop app before it is paired) the old token keeps the desktop's rights; through a proxy it does not
  assert.equal(devices.can(who, 'approve', { tier: 'T3', ip: LOOP }).ok, true);
  assert.equal(devices.can(who, 'admin', { ip: LOOP }).ok, true);
  assert.equal(devices.can(who, 'settings', { ip: 'proxied' }).ok, false);
  devices.setPin({ by: LOCAL, newPin: PIN });
  assert.equal(devices.can(who, 'approve', { tier: 'T3', pin: PIN, ip: LAN }).ok, true);
  assert.ok(devices.revoke('legacy', { by: who, pin: PIN, ip: LAN }).error, 'a holder of the shared token cannot end it for the others');
  assert.ok(devices.rotate('legacy', { by: LOCAL }).error);
  assert.ok(devices.list().some((d) => d.id === 'legacy'));
  assert.equal(devices.info().legacy, true);

  const phone = pair('phone');
  assert.ok(devices.revoke('legacy', { by: LOCAL }).ok);
  assert.equal(devices.authenticate(OLD, { ip: LAN }), null);
  assert.equal(devices.can(who, 'chat').ok, false);
  assert.ok(!devices.list().some((d) => d.id === 'legacy'));
  assert.ok(devices.authenticate(phone.token), 'paired devices are untouched');
  // no token file, or a reader that throws, is no legacy device
  old = null;
  assert.equal(setup(t, { legacyToken: () => null }).devices.authenticate(OLD), null);
  assert.equal(setup(t, { legacyToken: () => { throw new Error('gone'); } }).devices.authenticate(OLD), null);
  assert.equal(setup(t, { legacyToken: () => '' }).devices.authenticate(''), null);
});

test('a damaged store lets nobody in, the old token included, and is not overwritten', (t) => {
  const { devices, pair, file } = setup(t, { legacyToken: () => OLD });
  const phone = pair('phone');
  fs.writeFileSync(file, '{ "devices": [');
  assert.equal(devices.authenticate(phone.token), null);
  assert.equal(devices.authenticate(OLD), null);
  assert.equal(devices.can(phone.who, 'chat').ok, false);
  assert.ok(devices.startPairing({ by: LOCAL }).error);
  assert.ok(devices.setPin({ by: LOCAL, newPin: PIN }).error);
  assert.deepEqual(devices.list(), []);
  assert.equal(devices.info().damaged, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "devices": [');
});

test('malformed input everywhere is a no and never throws', (t) => {
  const { devices, pair } = setup(t, { legacyToken: () => OLD });
  const phone = pair('phone');
  const junk = [undefined, null, '', 0, 1, true, {}, [], 'x', 'x'.repeat(5000), '../../etc', '__proto__', Symbol('local'), () => {}, { deviceId: {} }, { deviceId: 'nobody' }, { deviceId: 'legacy\u0000' }, { role: 'ui' }];
  for (const j of junk) {
    assert.equal(devices.authenticate(j, j), null);
    assert.equal(devices.authenticate(phone.token.slice(1), { ip: j }), null);
    for (const what of ['chat', 'target', 'approve', 'settings', 'admin', 'device', 'deny', j]) assert.equal(devices.can(j, what, { tier: 'T0', pin: PIN, ip: LOOP, id: j }).ok, false);
    assert.equal(devices.can(phone.who, j).ok, false);
    assert.equal(devices.can(phone.who, 'approve', { tier: j, pin: j, ip: j }).ok, false);
    assert.equal(devices.can(phone.who, 'device', { id: j, pin: j, ip: j }).ok, false);
    assert.equal(devices.checkPin(j).ok, false);
    assert.ok(devices.startPairing({ by: j, kind: 'phone', ip: LOOP }).error);
    assert.ok(devices.startPairing({ by: LOCAL, kind: j === undefined ? 'tv' : j }).error);
    assert.ok(devices.startPairing({ by: LOCAL, scopes: j === undefined ? ['root'] : j }).error);
    assert.ok(devices.completePairing({ code: j, name: j, ip: j }).error);
    assert.ok(devices.revoke(j, { by: LOCAL }).error);
    assert.ok(devices.revoke(phone.device.id, { by: j, ip: LOOP }).error);
    assert.ok(devices.rotate(j, { by: LOCAL }).error);
    assert.ok(devices.rotate('all', { by: j, ip: LOOP }).error);
    assert.ok(devices.setPin({ by: j, newPin: PIN, ip: LOOP }).error);
    if (typeof j !== 'string' || j.length < 6 || j.length > 64) assert.ok(devices.setPin({ by: LOCAL, newPin: j }).error); // any 6 to 64 characters are a valid PIN
  }
  for (const f of [devices.startPairing, devices.completePairing, devices.setPin, devices.revoke, devices.rotate]) assert.ok(f().error);
  assert.equal(devices.authenticate(), null);
  assert.equal(devices.can().ok, false);
  assert.throws(() => createDevices({}), TypeError);
  assert.ok(devices.authenticate(phone.token), 'after all that the paired phone still works');
});
