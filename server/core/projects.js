// Projects (named groups of chats with instructions) kept on the server so the desktop and the phone show the same list.
// One small file, replaced whole by whichever device saved last. Every field is checked and cut to size here.
import path from 'node:path';
import { writeJsonAtomic, readJson } from '../../shared/util.js';

export const MAX_PROJECTS = 200;
const clean = (p) => (p && typeof p === 'object' && /^[\w-]{1,64}$/.test(String(p.id)))
  ? { id: String(p.id), name: String(p.name ?? '').slice(0, 60) || 'Untitled', instructions: String(p.instructions ?? '').slice(0, 8000), created: Number.isFinite(p.created) ? p.created : Date.now() }
  : null;

export function createProjects({ dir, onChange = () => {} }) {
  const file = path.join(dir, 'projects.json');
  return {
    list: () => { const j = readJson(file); return Array.isArray(j) ? j.map(clean).filter(Boolean) : []; },
    set(list) {
      if (!Array.isArray(list) || list.length > MAX_PROJECTS) throw Object.assign(new Error('a list of at most 200 projects'), { status: 400 });
      const seen = new Set();
      const out = list.map(clean).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
      writeJsonAtomic(file, out);
      onChange();
      return out;
    },
  };
}
