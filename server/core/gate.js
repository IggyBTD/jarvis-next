// The approval gate. requestApproval() broadcasts gate.request to every connected client; the first reply wins, the rest
// get gate.resolved. Only 'approve' and 'deny' are valid replies. A timeout is a deny. With nobody connected, or for a
// scheduled source, a queueable request is stored in data/pending-approvals.json (expiry 12 h by default) and an
// unqueueable one is denied. Every outcome produces an audit line.
import path from 'node:path';
import { readJson, writeJsonAtomic, newId } from '../../shared/util.js';

export function createGate({ audit, bus, clientCount, dataDir, timeoutMs = 120_000, expiryMs = 43_200_000, now = Date.now }) {
  const file = path.join(dataDir, 'pending-approvals.json');
  const waiting = new Map();   // id -> { request, resolve, timer }
  let queued = readJson(file, []).filter((r) => r && r.id && r.expiresAt > now());
  let executor = null;         // (request) => Promise<result>; set by the router, runs a queued request that was approved

  const save = () => { try { writeJsonAtomic(file, queued); } catch (e) { console.error(`[gate] cannot save pending approvals: ${e.message}`); } };
  const log = (request, decision, outcome, reason) => audit.append({
    component: 'gate', target: request.target, source: request.source, action: request.action, args: request.args,
    tier: request.tier, decision, outcome, reason, taskId: request.taskId, id: request.id,
  }).catch(() => {});

  const view = (r) => ({ id: r.id, action: r.action, args: r.args, tier: r.tier, target: r.target, source: r.source, taskId: r.taskId ?? null, summary: r.summary ?? '', expiresAt: r.expiresAt, screenshot: r.screenshot ?? null, queued: !!r.queued, dryRun: r.dryRun ?? null });

  function finish(id, decision, by, reason) {
    const w = waiting.get(id);
    if (!w) return false;
    waiting.delete(id);
    clearTimeout(w.timer);
    bus.publish('gate.resolved', { id, decision, by: by ?? null });
    log(w.request, decision, decision === 'approve' ? 'approved' : 'denied', reason);
    w.resolve({ approved: decision === 'approve', decision, reason });
    return true;
  }

  return {
    // request: { action, args, tier, target, source, taskId?, summary?, screenshot?, dryRun?, queueable? }
    requestApproval(input) {
      const request = { ...input, id: input.id ?? newId('g-'), expiresAt: now() + (input.timeoutMs ?? timeoutMs) };
      const unattended = request.source === 'scheduled' || clientCount() === 0;
      if (unattended) {
        if (request.queueable) {
          queued.push({ ...request, queued: true, expiresAt: now() + expiryMs });
          save();
          bus.publish('gate.queued', { request: view({ ...request, queued: true }) });
          log(request, 'queued', 'pending', 'no one to ask; stored until a client connects');
          return Promise.resolve({ approved: false, decision: 'queued', queued: true, id: request.id, reason: 'queued for approval' });
        }
        log(request, 'deny', 'denied', 'no client connected to approve');
        return Promise.resolve({ approved: false, decision: 'deny', reason: 'no client is connected to approve this' });
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => finish(request.id, 'deny', null, 'approval timed out'), request.expiresAt - now());
        timer.unref?.();
        waiting.set(request.id, { request, resolve, timer });
        bus.publish('gate.request', { request: view(request) });
        log(request, 'asked', 'pending', request.summary);
      });
    },

    // A client's answer. Returns { ok, error? }. A queued item is executed (through the router's executor) only if still valid.
    async reply(id, decision, clientId = null) {
      if (decision !== 'approve' && decision !== 'deny') return { ok: false, error: 'decision must be approve or deny' };
      if (waiting.has(id)) return { ok: finish(id, decision, clientId, `answered by ${clientId ?? 'a client'}`) };
      const i = queued.findIndex((r) => r.id === id);
      if (i === -1) return { ok: false, error: 'unknown or already answered' };
      const [request] = queued.splice(i, 1);
      save();
      bus.publish('gate.resolved', { id, decision, by: clientId });
      if (request.expiresAt <= now()) { log(request, 'expired', 'dropped', 'expired before it was answered'); return { ok: false, error: 'expired' }; }
      if (decision === 'deny') { log(request, 'deny', 'denied', 'queued request denied'); return { ok: true }; }
      log(request, 'approve', 'approved', 'queued request approved');
      if (!executor) return { ok: false, error: 'nothing can execute queued requests' };
      try { return { ok: true, result: await executor(request) }; } catch (e) { return { ok: false, error: e.message }; }
    },

    setExecutor(fn) { executor = fn; },
    pending: () => [...[...waiting.values()].map((w) => view(w.request)), ...queued.map(view)],
    // Drops expired queued items (each one is audited). Called by the scheduler job pending-approvals-expire.
    expire() {
      const dead = queued.filter((r) => r.expiresAt <= now());
      if (!dead.length) return 0;
      queued = queued.filter((r) => r.expiresAt > now());
      save();
      dead.forEach((r) => { bus.publish('gate.resolved', { id: r.id, decision: 'expired', by: null }); log(r, 'expired', 'dropped', 'queued request expired'); });
      return dead.length;
    },
    // Closing the server denies everything still waiting.
    denyAll(reason = 'server stopping') { for (const id of [...waiting.keys()]) finish(id, 'deny', null, reason); },
  };
}
