function applyDiscount(total, qty) { if (qty >= 50) return total * 0.8; if (qty >= 10) return total * 0.9; return total; }
module.exports = { applyDiscount };
