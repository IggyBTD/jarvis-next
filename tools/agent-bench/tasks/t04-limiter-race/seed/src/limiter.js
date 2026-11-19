const hooks = { onStart: async () => {} };

function createLimiter(max) {
  let active = 0;
  const waiters = [];
  async function run(fn) {
    while (active >= max) await new Promise((r) => waiters.push(r));
    await hooks.onStart();
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = waiters.shift();
      if (next) next();
    }
  }
  return run;
}

module.exports = { createLimiter, hooks };
