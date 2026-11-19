const { Store } = require('./store');
function error(status, message) { return { status, body: { error: message } }; }
function parseQuery(q = {}) {
  const out = {};
  if (q.tag !== undefined) { if (typeof q.tag !== 'string' || !q.tag) return { err: error(400, 'invalid tag') }; out.tag = q.tag; }
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
        return { status: 200, body: { items: store.list(q.value) } };
      }
      return error(404, 'not found');
    },
  };
}
module.exports = { createApi };
