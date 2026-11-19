const REGION_TAX = { US: 0.07, DE: 0.19, FR: 0.2, JP: 0.1 };
function taxFor(region, subtotalCents) { return Math.round(subtotalCents * REGION_TAX[region]); }
function isKnownRegion(region) { return region in REGION_TAX; }
function rateFor(region) { return REGION_TAX[region]; }
module.exports = { taxFor, isKnownRegion, rateFor };
