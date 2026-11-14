const table = require("./generated/tax-table");

function rateFor(region) {
  const key = String(region).toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(table, key)) throw new RangeError("unknown region: " + region);
  return table[key];
}

module.exports = { rateFor };
