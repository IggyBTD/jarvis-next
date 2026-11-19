class Store {
  constructor() { this.items = new Map(); this.nextId = 1; }
  add(data) { const id = this.nextId++; const item = { id, ...data }; this.items.set(id, item); return item; }
  remove(id) { return this.items.delete(id); }
  list(filter = {}) {
    let out = [...this.items.values()].sort((a, b) => a.id - b.id);
    if (filter.tag) out = out.filter((i) => (i.tags || []).includes(filter.tag));
    return out;
  }
}
module.exports = { Store };
