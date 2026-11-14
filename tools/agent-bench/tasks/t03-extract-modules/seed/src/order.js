const REGION_TAX = { US: 0.07, DE: 0.19, FR: 0.2, JP: 0.1 };

function validate(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) throw new Error("order needs items");
  for (const it of order.items) {
    if (typeof it.sku !== "string" || !it.sku) throw new Error("bad sku");
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error("bad qty for " + it.sku);
    if (typeof it.price !== "number" || it.price < 0) throw new Error("bad price for " + it.sku);
  }
  if (!(order.region in REGION_TAX)) throw new Error("unknown region: " + order.region);
  return order;
}

function price(order) {
  const subtotal = order.items.reduce((s, it) => s + it.qty * Math.round(it.price * 100), 0);
  const tax = Math.round(subtotal * REGION_TAX[order.region]);
  const shipping = subtotal === 0 || subtotal >= 10000 ? 0 : 599;
  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}

function money(c) { return "$" + (c / 100).toFixed(2); }

function formatReceipt(order, totals) {
  const lines = order.items.map((it) => it.sku + " x" + it.qty + "  " + money(it.qty * Math.round(it.price * 100)));
  lines.push("Subtotal  " + money(totals.subtotal));
  lines.push("Tax (" + Math.round(REGION_TAX[order.region] * 100) + "%)  " + money(totals.tax));
  lines.push("Shipping  " + (totals.shipping ? money(totals.shipping) : "free"));
  lines.push("Total  " + money(totals.total));
  return lines.join("\n");
}

function processOrder(order) {
  validate(order);
  const totals = price(order);
  return { totals, receipt: formatReceipt(order, totals) };
}

module.exports = { validate, price, formatReceipt, processOrder };
