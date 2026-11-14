function applyDiscount(total, qty) {
  if (qty > 10) return total * 0.9;
  return total;
}
module.exports = { applyDiscount };
