const { Store } = require('./store');
function error(status, message) { return { status, body: { error: message } }; }
function parseQuery(q = {}) {
  const out = {};
  if (q.tag !== undefined) { if (typeof q.tag !== 'string' || !q.tag) return { err: error(400, 'invalid tag') }; out.tag = q.tag; }
  out.limit = 20;
  if (q.limit !== undefined) { if (!/^\d+$/.test(String(q.limit))) return { err: error(400, 'invalid limit') }; const n = Number(q.limit); if (n < 1 || n > 100) return { err: error(400, 'invalid limit') }; out.limit = n; }
  if (q.cursor !== undefined) {
    let id; try { id = JSON.parse(Buffer.from(String(q.cursor), 'base64url').toString()).after; } catch { id = undefined; }
    if (!Number.isInteger(id) || id < 0) return { err: error(400, 'invalid cursor') };
    out.afterId = id;
  }
  return { value: out };
}
function createApi(store = new Store()) {
  return {
    store,
    handle(req) {
      if (req.method === 'POST' && req.path === '/items') {
        if (!req.body || typeof req.body.name !== 'string') return error(400, 'name required');
        return { status: 201, body: store.add(req.body) };
      }
      if (req.method === 'GET' && req.path === '/items') {
        const q = parseQuery(req.query);
        if (q.err) return q.err;
        const all = store.list({ tag: q.value.tag, afterId: q.value.afterId });
        const items = all.slice(0, q.value.limit);
        const nextCursor = all.length > items.length ? Buffer.from(JSON.stringify({ after: items[items.length - 1].id })).toString('base64url') : null;
        return { status: 200, body: { items, nextCursor } };
      }
      return error(404, 'not found');
    },
  };
}
module.exports = { createApi };
