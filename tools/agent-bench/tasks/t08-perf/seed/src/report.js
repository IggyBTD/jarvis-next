// uniqueSorted(arr): distinct numbers, ascending.
function uniqueSorted(arr) {
  const out = [];
  for (const x of arr) {
    if (!out.includes(x)) out.push(x);
  }
  return out.sort((a, b) => a - b);
}

// groupCounts(items, key): [{ key, count }] in order of first appearance.
function groupCounts(items, key) {
  const res = [];
  for (const it of items) {
    const found = res.find((r) => r.key === it[key]);
    if (found) found.count++;
    else res.push({ key: it[key], count: 1 });
  }
  return res;
}

// topK(arr, k): the k largest numbers, descending (duplicates kept).
function topK(arr, k) {
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < k && copy.length; i++) {
    let mi = 0;
    for (let j = 1; j < copy.length; j++) if (copy[j] > copy[mi]) mi = j;
    out.push(copy.splice(mi, 1)[0]);
  }
  return out;
}

module.exports = { uniqueSorted, groupCounts, topK };
