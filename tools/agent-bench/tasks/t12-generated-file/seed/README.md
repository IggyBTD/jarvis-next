# tax

Rates: US 7%, DE 19%, FR 20%, JP 10%.

`rateFor(region)` returns the rate as a fraction (0.19 for 19%). Region codes are case-insensitive. An unknown region throws RangeError.

The rate table is kept in `src/tax-table.src.json`. `node build.js` turns it into `src/generated/tax-table.js`, which `src/tax.js` loads. The build runs in CI before the tests.
