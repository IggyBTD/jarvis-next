// In-memory artifact store. Same id => a new version of the same artifact.

const artifacts = new Map(); // id -> { id, type, title, lang, versions: [{ content, time, partial }] }
const listeners = new Set();

export function onArtifactsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getArtifact = (id) => artifacts.get(id);
export const listArtifacts = () => [...artifacts.values()];

// Returns { changed, version } where changed is false if the content is identical to the latest version.
export function upsertArtifact({ id, type, title, lang, content, partial = false }) {
  let a = artifacts.get(id);
  if (!a) {
    a = { id, type, title, lang, versions: [] };
    artifacts.set(id, a);
  }
  const latest = a.versions[a.versions.length - 1];
  if (latest && latest.content === content && latest.partial === partial) {
    return { changed: false, version: a.versions.length - 1 };
  }
  a.type = type;
  a.title = title;
  a.lang = lang;
  a.versions.push({ content, time: Date.now(), partial });
  listeners.forEach((cb) => cb(a));
  return { changed: true, version: a.versions.length - 1 };
}
