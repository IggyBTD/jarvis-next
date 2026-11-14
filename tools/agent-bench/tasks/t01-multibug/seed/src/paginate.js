function paginate(list, page, size) { return list.slice(page * size, page * size + size); }
module.exports = { paginate };
