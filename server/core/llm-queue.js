// One model, so default concurrency 1. Priority interactive > agent > digest, with aging so a low priority job is
// not starved forever. run(priority, fn, { signal }) holds a slot for the whole of fn (a streamed reply included) and
// releases it when fn settles, however it ends. Optionally an interactive job aborts a running lower-priority one.
export const PRIORITY = { interactive: 0, agent: 1, digest: 2 };

export class PreemptedError extends Error { constructor() { super('preempted by an interactive request'); this.name = 'PreemptedError'; } }

export function createQueue({ concurrency = 1, agingMs = 60_000, preempt = false, now = Date.now } = {}) {
  const waiting = [];
  const running = new Set();

  const effective = (job) => PRIORITY[job.priority] - Math.floor((now() - job.queuedAt) / agingMs);
  function next() {
    while (running.size < concurrency && waiting.length) {
      let best = 0;
      for (let i = 1; i < waiting.length; i++) {
        const a = effective(waiting[i]);
        const b = effective(waiting[best]);
        if (a < b || (a === b && waiting[i].seq < waiting[best].seq)) best = i;
      }
      const job = waiting.splice(best, 1)[0];
      start(job);
    }
  }
  function start(job) {
    running.add(job);
    const ctl = new AbortController();
    job.ctl = ctl;
    const onAbort = () => ctl.abort(job.signal.reason);
    job.signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => job.fn(ctl.signal)).then(job.resolve, job.reject).finally(() => {
      job.signal?.removeEventListener('abort', onAbort);
      running.delete(job);
      next();
    });
  }

  let seq = 0;
  return {
    run(priority, fn, { signal } = {}) {
      if (!(priority in PRIORITY)) return Promise.reject(new Error(`unknown priority ${priority}`));
      if (signal?.aborted) return Promise.reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return new Promise((resolve, reject) => {
        const job = { priority, fn, signal, resolve, reject, queuedAt: now(), seq: seq++ };
        waiting.push(job);
        signal?.addEventListener('abort', () => {
          const i = waiting.indexOf(job);
          if (i !== -1) { waiting.splice(i, 1); reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })); }
        }, { once: true });
        if (preempt && priority === 'interactive' && running.size >= concurrency) {
          const victim = [...running].filter((j) => j.priority !== 'interactive').sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority])[0];
          victim?.ctl.abort(new PreemptedError());
        }
        next();
      });
    },
    depth: () => waiting.length,
    active: () => running.size,
    snapshot: () => ({ waiting: waiting.map((j) => j.priority), running: [...running].map((j) => j.priority) }),
  };
}
