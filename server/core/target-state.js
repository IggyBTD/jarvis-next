// The active target (pc or mac), persisted in data/state.json. Only the UI (target.set) or a confirmed voice command may
// change it: set() insists on a `by` of 'ui' or 'voice', and no model tool maps to it. A task or chat turn takes a frozen
// binding at its start with bind(); a later switch never redirects work already planned.
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../../shared/util.js';

export function createTargetState({ dataDir, machines, bus, now = () => new Date() }) {
  const file = path.join(dataDir, 'state.json');
  const saved = readJson(file, {});
  let active = machines.includes(saved.activeTarget) ? saved.activeTarget : 'pc';

  return {
    get: () => active,
    // Returns { from, to, changed }. All or nothing: if the file cannot be written, the target stays as it was and this throws.
    set(target, { by, clientId = null } = {}) {
      if (by !== 'ui' && by !== 'voice') throw new Error('only the user interface or a confirmed voice command can change the target');
      if (!machines.includes(target)) throw new Error(`unknown target "${target}"`);
      const from = active;
      if (target === from) return { from, to: target, changed: false };
      writeJsonAtomic(file, { ...readJson(file, {}), activeTarget: target, changedAt: now().toISOString() });
      active = target;
      bus?.publish('target.changed', { from, to: target, by, clientId });
      return { from, to: target, changed: true };
    },
    bind: () => Object.freeze({ target: active, boundAt: now().toISOString() }),
  };
}
