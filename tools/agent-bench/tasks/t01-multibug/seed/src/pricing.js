const { rates } = require('./rates');
const { applyDiscount } = require('./discount');
const cache = new Map();
function unitPrice(item, currency) {
  if (cache.has(item.id)) return cache.get(item.id);
  const p = Math.round(item.usd * rates[currency] * 100) / 100;
  cache.set(item.id, p);
  return p;
}
function lineTotal(item, qty, currency) { return applyDiscount(unitPrice(item, currency) * qty, qty); }
module.exports = { unitPrice, lineTotal };
