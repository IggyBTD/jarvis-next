const { rates } = require('./rates');
const { applyDiscount } = require('./discount');
const cache = new Map();
function unitPrice(item, currency) {
  const k = item.id + '|' + currency;
  if (cache.has(k)) return cache.get(k);
  const p = Math.round(item.usd * rates[currency] * 100) / 100;
  cache.set(k, p);
  return p;
}
function lineTotal(item, qty, currency) { return Math.round(applyDiscount(unitPrice(item, currency) * qty, qty) * 100) / 100; }
module.exports = { unitPrice, lineTotal };
