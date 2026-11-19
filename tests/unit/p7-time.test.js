import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, localParts } from '../../server/core/scheduler.js';
import { createReminders, localToMs } from '../../server/core/reminders.js';
import { createBus } from '../../server/core/event-bus.js';
import { tmpDir, rmDir } from '../helpers.js';

const TZ = 'Europe/Madrid';
const sched = (jobs, extra = {}) => ({ timezone: TZ, catchUpWindowMinutes: 360, jobs, ...extra });

test('local time helpers are correct across DST', () => {
  assert.deepEqual(localParts(Date.UTC(2026, 9, 18, 5, 0), TZ), { date: '2026-10-18', minutes: 7 * 60 }); // CEST, +2
  assert.deepEqual(localParts(Date.UTC(2026, 9, 26, 6, 0), TZ), { date: '2026-10-26', minutes: 7 * 60 }); // after the clocks went back, +1
  assert.equal(localToMs('2026-10-18 07:00', TZ), Date.UTC(2026, 9, 18, 5, 0));
  assert.equal(localToMs('2026-10-26 07:00', TZ), Date.UTC(2026, 9, 26, 6, 0));
  assert.equal(localToMs('2026-03-29 02:30', TZ) === null || typeof localToMs('2026-03-29 02:30', TZ) === 'number', true);
  assert.equal(localToMs('tomorrow', TZ), null);
});

test('scheduler: daily job runs once per local day, at the right minute, across the autumn DST change', async () => {
  const dir = tmpDir('sch');
  try {
    let t = Date.UTC(2026, 9, 24, 4, 0); // 06:00 local on the 24th
    const ran = [];
    const s = createScheduler({ schedules: sched({ digest: { at: '07:00', enabled: true } }), dataDir: dir, now: () => t, run: async (n, o) => { ran.push([localParts(t, TZ).date, localParts(t, TZ).minutes, o.missed]); } });
    s.tick(); assert.equal(ran.length, 0);
    t = Date.UTC(2026, 9, 24, 5, 0); s.tick(); await new Promise((r) => setTimeout(r, 5));
    t += 60_000 * 20; s.tick(); // same day: not again
    for (const d of [25, 26, 27]) { t = Date.UTC(2026, 9, d, d <= 24 ? 5 : 6, 0); s.tick(); await new Promise((r) => setTimeout(r, 5)); }
    assert.deepEqual(ran.map((r) => [r[0], r[1]]), [['2026-10-24', 420], ['2026-10-25', 420], ['2026-10-26', 420], ['2026-10-27', 420]]);
  } finally { rmDir(dir); }
});

test('scheduler: missed run catches up inside the window only, never overlaps, retries twice, survives a failed state write', async () => {
  const dir = tmpDir('sch2');
  try {
    let t = Date.UTC(2026, 9, 18, 7, 30); // 09:30 local, the 07:00 job was missed by 150 minutes
    const calls = [];
    let fail = true;
    const s = createScheduler({ schedules: sched({ digest: { at: '07:00', enabled: true }, old: { at: '01:00', enabled: true } }), dataDir: dir, now: () => t, retryMs: 1000, run: async (n, o) => { calls.push([n, o.missed]); if (n === 'digest' && fail) throw new Error('model down'); } });
    s.tick(); await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls, [['digest', true]]); // old (08:30 late) is beyond the 6 h window? it is 8.5 h late: skipped
    t += 1000; s.tick(); await new Promise((r) => setTimeout(r, 10));
    t += 1000; s.tick(); await new Promise((r) => setTimeout(r, 10));
    t += 1000; s.tick(); await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.filter((c) => c[0] === 'digest').length, 3); // first try plus two retries
    t += 5000; s.tick(); await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.filter((c) => c[0] === 'digest').length, 3);

    // a job that hangs keeps its slot
    let release; let starts = 0;
    const h = createScheduler({ schedules: sched({ slow: { everyMinutes: 1, enabled: true } }), dataDir: tmpDir('sch3'), now: () => t, run: () => { starts += 1; return new Promise((r) => { release = r; }); } });
    h.tick(); t += 120_000; h.tick(); t += 120_000; h.tick();
    assert.equal(starts, 1);
    release();
    // unwritable state file does not throw
    const broken = createScheduler({ schedules: sched({ x: { everyMinutes: 1, enabled: true } }), dataDir: '/nonexistent-\0-dir', now: () => t, run: async () => {} });
    assert.doesNotThrow(() => broken.tick());
  } finally { rmDir(dir); }
});

test('reminders: fire when a client is there, are kept and delivered later when none is', () => {
  const dir = tmpDir('rem');
  try {
    let t = 1_000_000; let clients = 0;
    const bus = createBus(); const seen = [];
    bus.subscribe((m) => seen.push(m));
    const r = createReminders({ dataDir: dir, bus, clientCount: () => clients, timezone: TZ, now: () => t });
    r.addInMinutes(5, 'tea');
    r.add({ text: 'call mum', at: t + 60_000 });
    t += 2 * 60_000; r.tick();
    assert.deepEqual(r.missedFor().map((m) => m.text), ['call mum']);
    assert.equal(seen.length, 0);
    clients = 1; r.deliverMissed();
    assert.deepEqual(seen.map((m) => m.text), ['call mum']);
    assert.deepEqual(r.missedFor(), []);
    t += 5 * 60_000; r.tick();
    assert.deepEqual(seen.map((m) => m.text), ['call mum', 'tea']);
    const again = createReminders({ dataDir: dir, bus, clientCount: () => 1, timezone: TZ, now: () => t }); // persisted
    assert.deepEqual(again.list(), []);
  } finally { rmDir(dir); }
});
