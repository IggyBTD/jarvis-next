const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

function parseDuration(str) {
  if (typeof str !== "string") throw new TypeError("duration must be a string");
  const fail = () => new RangeError("invalid duration: " + str);
  let rest = str.trim();
  if (!rest) throw fail();
  if (/^\d+(\.\d+)?$/.test(rest)) return Number(rest);
  const head = /^(\d+(?:\.\d+)?)\s*([smhd])\s*/i;
  let total = 0;
  while (rest) {
    const m = head.exec(rest);
    if (!m) throw fail();
    total += Number(m[1]) * UNITS[m[2].toLowerCase()];
    rest = rest.slice(m[0].length);
  }
  return total;
}

module.exports = { parseDuration, UNITS };
