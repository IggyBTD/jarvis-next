function check(list) {
  if (!Array.isArray(list)) throw new TypeError("intervals must be an array");
  for (const iv of list) {
    if (!Array.isArray(iv) || iv.length !== 2 || !Number.isFinite(iv[0]) || !Number.isFinite(iv[1])) throw new TypeError("bad interval");
    if (iv[0] > iv[1]) throw new RangeError("start after end");
  }
}

function merge(list) {
  check(list);
  const sorted = list.map((iv) => [iv[0], iv[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}

function totalLength(list) {
  return merge(list).reduce((s, iv) => s + (iv[1] - iv[0]), 0);
}

function gaps(list, lo, hi) {
  if (lo > hi) throw new RangeError("lo after hi");
  const out = [];
  let cur = lo;
  for (const [s, e] of merge(list)) {
    if (e <= cur) continue;
    if (s >= hi) break;
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < hi) out.push([cur, hi]);
  return out;
}

module.exports = { merge, totalLength, gaps };
