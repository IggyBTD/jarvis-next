const table = require("./generated/tax-table");

function rateFor(region) {
  return table[region];
}

module.exports = { rateFor };
