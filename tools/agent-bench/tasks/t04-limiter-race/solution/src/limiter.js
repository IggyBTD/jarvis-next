const hooks = { onStart: async () => {} };

function createLimiter(max) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError("max must be a positive integer");
  let active = 0;
  const waiters = [];
  function release() {
    const next = waiters.shift();
    if (next) next(); else active--;
  }
  async function run(fn) {
    if (active < max) active++;
    else await new Promise((r) => waiters.push(r));
    try {
      await hooks.onStart();
      return await fn();
    } finally {
      release();
    }
  }
  return run;
}

module.exports = { createLimiter, hooks };
