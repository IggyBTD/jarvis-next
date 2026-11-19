function paginate(list, page, size) { if (page < 1) return []; return list.slice((page - 1) * size, page * size); }
module.exports = { paginate };
