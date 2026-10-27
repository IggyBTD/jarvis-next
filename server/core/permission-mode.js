// The coding agent's permission mode (shared/permission-modes.js): one value for the server, kept on disk, announced to every app.
import fs from 'node:fs';
import path from 'node:path';
import { MODES, DEFAULT_MODE } from '../../shared/permission-modes.js';

export function createPermissionMode({ dataDir, bus }) {
  const file = path.join(dataDir, 'permission-mode.json');
  let mode = DEFAULT_MODE;
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')).mode; if (MODES.includes(v)) mode = v; } catch { /* none saved: the default */ }
  return {
    get: () => mode,
    set(next) {
      if (!MODES.includes(next)) throw new Error('unknown permission mode');
      if (next === mode) return mode;
      mode = next;
      try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ mode })); } catch { /* the mode still holds until restart */ }
      bus?.publish('mode', { mode });
      return mode;
    },
  };
}
