const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

function parseDuration(str) {
  const m = str.match(/^(\d+)([smhd])$/);
  return Number(m[1]) * UNITS[m[2]];
}

module.exports = { parseDuration, UNITS };
