const { taxFor, isKnownRegion } = require("./tax");
const { formatReceipt } = require("./receipt");

function validate(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) throw new Error("order needs items");
  for (const it of order.items) {
    if (typeof it.sku !== "string" || !it.sku) throw new Error("bad sku");
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error("bad qty for " + it.sku);
    if (typeof it.price !== "number" || it.price < 0) throw new Error("bad price for " + it.sku);
  }
  if (!isKnownRegion(order.region)) throw new Error("unknown region: " + order.region);
  return order;
}

function price(order) {
  const subtotal = order.items.reduce((s, it) => s + it.qty * Math.round(it.price * 100), 0);
  const tax = taxFor(order.region, subtotal);
  const shipping = subtotal === 0 || subtotal >= 10000 ? 0 : 599;
  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}

function processOrder(order) {
  validate(order);
  const totals = price(order);
  return { totals, receipt: formatReceipt(order, totals) };
}

module.exports = { validate, price, formatReceipt, processOrder };
