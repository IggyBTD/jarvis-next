// In-process publish/subscribe. A listener that throws never stops the others or the publisher.
export function createBus() {
  const subs = new Set();
  return {
    publish(type, payload = {}) {
      const msg = { type, ...payload };
      for (const fn of [...subs]) { try { fn(msg); } catch (e) { console.error(`[bus] listener failed on ${type}: ${e.message}`); } }
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    size: () => subs.size,
  };
}
