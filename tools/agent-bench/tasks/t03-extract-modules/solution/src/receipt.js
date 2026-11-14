const { rateFor } = require("./tax");
function money(c) { return "$" + (c / 100).toFixed(2); }
function formatReceipt(order, totals) {
  const lines = order.items.map((it) => it.sku + " x" + it.qty + "  " + money(it.qty * Math.round(it.price * 100)));
  lines.push("Subtotal  " + money(totals.subtotal));
  lines.push("Tax (" + Math.round(rateFor(order.region) * 100) + "%)  " + money(totals.tax));
  lines.push("Shipping  " + (totals.shipping ? money(totals.shipping) : "free"));
  lines.push("Total  " + money(totals.total));
  return lines.join("\n");
}
module.exports = { formatReceipt };
