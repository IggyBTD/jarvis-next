// Security fixes F1-5 and F1-6: an audit chain that cannot be quietly cut or rewritten, writes that fail closed, and queued approvals
// that are rated again when they are approved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createAuditLog } from '../../server/core/audit-log.js';
import { createGate } from '../../server/core/gate.js';
import { createBus } from '../../server/core/event-bus.js';
import { createToolRouter } from '../../server/core/tool-router.js';
import { createPolicy } from '../../server/core/policy.js';
import { tmpDir, rmDir, testConfig } from '../helpers.js';

const KEY = 'k'.repeat(64);
const setup = async (n = 5) => {
  const root = tmpDir('f15');
  const dir = path.join(root, 'audit');
  const keyDir = path.join(root, 'tokens');
  const audit = createAuditLog({ dir, key: KEY, markFile: path.join(keyDir, 'audit.mark') });
  for (let i = 0; i < n; i++) await audit.append({ component: 'test', action: `a${i}`, args: { i }, tier: 'T1' });
  const fresh = () => createAuditLog({ dir, key: KEY, markFile: path.join(keyDir, 'audit.mark') });
  const day = () => path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.jsonl')));
  return { root, dir, audit, fresh, day };
};

test('F1-5: cutting the last three entries and fixing head.json by hand fails verify', async () => {
  const s = await setup();
  try {
    assert.equal(s.fresh().verify().ok, true);
    const lines = fs.readFileSync(s.day(), 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(s.day(), `${lines.slice(0, -3).join('\n')}\n`);
    const last = JSON.parse(lines.at(-4));
    const head = JSON.parse(fs.readFileSync(path.join(s.dir, 'head.json'), 'utf8'));
    fs.writeFileSync(path.join(s.dir, 'head.json'), JSON.stringify({ ...head, hash: last.hash, count: 2 }));
    const v = s.fresh().verify();
    assert.equal(v.ok, false, 'a shorter log does not pass');
    assert.match(v.errors.join('\n'), /missing|anchor|mark/i);
  } finally { rmDir(s.root); }
});

test('F1-5: recomputing every hash without the key fails; deleting the whole log fails', async () => {
  const s = await setup();
  try {
    const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null');
    let prev = '0'.repeat(64);
    const forged = fs.readFileSync(s.day(), 'utf8').split('\n').filter(Boolean).map((l) => {
      const { hash, ...rest } = JSON.parse(l);
      const e = { ...rest, action: 'nothing happened', prevHash: prev };
      e.hash = crypto.createHash('sha256').update(`${prev}\n${canon(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'hash')))}`).digest('hex');
      prev = e.hash;
      return JSON.stringify(e);
    });
    fs.writeFileSync(s.day(), `${forged.join('\n')}\n`);
    assert.equal(s.fresh().verify().ok, false, 'hashes made without the key do not pass');
    fs.rmSync(s.dir, { recursive: true, force: true });
    const v = s.fresh().verify();
    assert.equal(v.ok, false, 'an empty log after there were entries does not pass');
  } finally { rmDir(s.root); }
});

test('F1-5: a torn last line is cut and the cut is written into the log itself', async () => {
  const s = await setup(3);
  try {
    fs.appendFileSync(s.day(), '{"ts":"2026-11-18T00:00:00Z","id":"x","comp');
    const a = s.fresh();
    await a.append({ component: 'test', action: 'after', args: {}, tier: 'T1' });
    assert.ok(a.tail(10).some((e) => e.component === 'audit' && /torn/.test(e.outcome ?? '')), 'the repair is in the log');
    assert.equal(a.verify().ok, true);
  } finally { rmDir(s.root); }
});

test('F1-5: off-box anchors: a log that no longer reaches an anchor, or differs from it, fails', async () => {
  const s = await setup(4);
  try {
    const head = s.audit.head();
    assert.deepEqual(s.audit.checkAnchors([{ count: head.count, hash: head.hash }]), []);
    assert.ok(s.audit.checkAnchors([{ count: head.count + 5, hash: 'f'.repeat(64) }]).length, 'an anchor past the end');
    assert.ok(s.audit.checkAnchors([{ count: 2, hash: 'f'.repeat(64) }]).length, 'an anchor that does not match');
  } finally { rmDir(s.root); }
});

test('F1-5: a T2 or T3 action does not run when its audit line cannot be written; the gate denies', async () => {
  const t = testConfig((f) => { for (const a of f['actions.json'].actions) if (a.name === 'close_app') a.enabled = true; });
  const calls = [];
  const audit = { append: async () => { throw new Error('disk full'); } };
  const gate = { requestApproval: async () => ({ approved: true, decision: 'approve' }), setExecutor() {} };
  const router = createToolRouter({ cfg: t.cfg, policy: createPolicy(t.cfg.policy), gate, audit, tokens: () => 'x'.repeat(64), fetchImpl: async (u, o) => { calls.push(JSON.parse(o?.body ?? '{}').dryRun ? 'dry run' : String(u)); return new Response('{"ok":true,"data":{}}'); } });
  try {
    const r = await router.invoke({ name: 'close_app', args: { app: 'notes' } }, { target: 'pc', source: 'user' });
    assert.equal(r.ok, false);
    assert.match(r.content, /audit/);
    assert.equal(calls.filter((u) => /\/action\/close_app/.test(u)).length, 0, 'only the dry run reached the agent');
    const realGate = createGate({ audit, bus: createBus(), clientCount: () => 1, dataDir: t.dataDir, timeoutMs: 5000 });
    const answer = await realGate.requestApproval({ action: 'kill_process', args: {}, tier: 'T3', target: 'pc', source: 'user', summary: 'x' });
    assert.equal(answer.approved, false);
    assert.match(answer.reason, /audit/);
  } finally { t.cleanup(); }
});

test('F1-5: the other machine keeps anchors append-only and gives them back; the log checks against them', async () => {
  const { createRegistry } = await import('../../agent/registry/mod.js');
  const t = testConfig();
  const s = await setup(3);
  try {
    const reg = createRegistry({ cfg: t.cfg, machineId: 'mac', os: 'darwin' });
    const h = s.audit.head();
    assert.equal((await reg.execute('audit_anchor', { args: { count: h.count, hash: h.hash } })).ok, true);
    assert.equal((await reg.execute('audit_anchor', { args: { count: 1, hash: 'not hex' } })).ok, false, 'a malformed anchor is refused');
    const got = await reg.execute('audit_anchors', { args: {} });
    assert.equal(got.data.anchors.length, 1);
    assert.deepEqual(s.audit.checkAnchors(got.data.anchors), []);
    const lines = fs.readFileSync(s.day(), 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(s.day(), `${lines.slice(0, -1).join('\n')}\n`);
    assert.ok(s.fresh().checkAnchors(got.data.anchors).length, 'a cut log no longer reaches the anchor');
  } finally { rmDir(s.root); t.cleanup(); }
});
