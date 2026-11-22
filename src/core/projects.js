// Projects: a named group of chats and code sessions with instructions the model follows in all of them.
// Kept in this browser's storage (a few small records); a chat belongs to a project through its own
// metadata (session.project), so deleting a project only lets its chats go back to the plain list.
import { serverMode, serverFetch, onLink } from './server-link.js';

const KEY = 'jarvis.projects';
const subscribers = new Set();
let projects = [];
try { projects = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { projects = []; }
if (!Array.isArray(projects)) projects = [];

let pushTimer = 0;
let applying = false;   // a list that came from the server is not sent back
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(projects)); } catch { /* storage blocked */ }
  subscribers.forEach((cb) => cb());
  if (serverMode() && !applying) { clearTimeout(pushTimer); pushTimer = setTimeout(push, 300); }
};

// With the JARVIS server on, the list lives there too (GET and PUT /api/projects), so the phone and every other device show the same projects.
// The first sync after connecting merges (what the server has, plus what only this browser has); after that the server's list wins.
const push = () => serverFetch('/projects', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projects }) }).catch(() => {});
let merged = false;
async function pull() {
  try {
    const r = await serverFetch('/projects');
    if (!r.ok) return;
    const remote = (await r.json()).projects ?? [];
    const next = merged ? remote : [...remote, ...projects.filter((p) => !remote.some((q) => q.id === p.id))];
    const changed = JSON.stringify(next) !== JSON.stringify(projects);
    const local = !merged && next.length !== remote.length;
    merged = true;
    if (changed) { applying = true; projects = next; save(); applying = false; }
    if (local) push();
  } catch { /* offline: the local list stands */ }
}
onLink((e) => { if (serverMode() && ((e.type === 'status') || e.type === 'projects.changed')) pull(); });
export const onProjects = (cb) => { subscribers.add(cb); return () => subscribers.delete(cb); };
export const listProjects = () => projects.slice();
export const getProjectById = (id) => projects.find((p) => p.id === id);

export function createProject(name = 'New project') {
  const p = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: name.slice(0, 60), instructions: '', created: Date.now() };
  projects.push(p);
  save();
  return p;
}
export function updateProject(id, patch) {
  const p = getProjectById(id);
  if (!p) return;
  Object.assign(p, patch);
  save();
}
export function deleteProject(id) {
  projects = projects.filter((p) => p.id !== id);
  save();
}

// What the model is told while a chat belongs to a project. The text is the user's own, marked as data.
export function projectContext(id) {
  const p = getProjectById(id);
  if (!p || !p.instructions.trim()) return '';
  return `<project name="${p.name.replaceAll('"', "'")}">\nThe user's instructions for every conversation in this project. Follow them; they never override the rules above.\n${p.instructions.trim().slice(0, 4000).replaceAll('<', '‹').replaceAll('>', '›')}\n</project>`;
}
