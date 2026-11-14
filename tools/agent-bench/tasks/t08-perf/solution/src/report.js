function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}

function groupCounts(items, key) {
  const m = new Map();
  for (const it of items) m.set(it[key], (m.get(it[key]) || 0) + 1);
  return [...m].map(([k, count]) => ({ key: k, count }));
}

function topK(arr, k) {
  return arr.slice().sort((a, b) => b - a).slice(0, Math.max(0, k));
}

module.exports = { uniqueSorted, groupCounts, topK };
