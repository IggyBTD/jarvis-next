// Which engine does the coding: the local model through OpenCode ('local') or the official Claude Code program ('claude').
// One value for the server, kept on disk, announced to every app. Nothing else switches it: not the page, not the model.
import fs from 'node:fs';
import path from 'node:path';

export const BACKENDS = ['local', 'claude'];

export function createCodeBackend({ dataDir, bus }) {
  const file = path.join(dataDir, 'code-backend.json');
  let backend = 'local';
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')).backend; if (BACKENDS.includes(v)) backend = v; } catch { /* none saved: local */ }
  return {
    get: () => backend,
    set(next) {
      if (!BACKENDS.includes(next)) throw new Error('unknown backend');
      if (next === backend) return backend;
      backend = next;
      try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ backend })); } catch { /* holds until restart */ }
      bus?.publish('backend', { backend });
      return backend;
    },
  };
}
