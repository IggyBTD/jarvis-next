// Line diff for the edit cards. Pure. Common start and end are trimmed first; the changed middle is
// compared with a longest-common-subsequence table when it is small enough, otherwise it is shown
// as one block removed and one block added (always correct, just less fine-grained).
const MAX_CELLS = 4_000_000;

const splitLines = (text) => {
  if (text === '' || text == null) return [];
  const lines = String(text).split('\n');
  if (lines.at(-1) === '') lines.pop(); // a final newline does not make an extra empty line
  return lines;
};

function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return [...a.map((text) => ({ t: 'del', text })), ...b.map((text) => ({ t: 'add', text }))];
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'ctx', text: a[i] }); i++; j++; }
    else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) ops.push({ t: 'del', text: a[i++] });
    else ops.push({ t: 'add', text: b[j++] });
  }
  while (i < n) ops.push({ t: 'del', text: a[i++] });
  while (j < m) ops.push({ t: 'add', text: b[j++] });
  return ops;
}

// Returns { hunks: [{ oldStart, newStart, lines: [{ t: 'ctx'|'add'|'del', text }] }], added, removed }.
export function lineDiff(before, after, context = 3) {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const ops = [
    ...a.slice(0, head).map((text) => ({ t: 'ctx', text })),
    ...lcsOps(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...a.slice(a.length - tail).map((text) => ({ t: 'ctx', text })),
  ];

  let added = 0;
  let removed = 0;
  // Line numbers of each op in the old and the new text.
  let o = 1;
  let nn = 1;
  const numbered = ops.map((op) => {
    const row = { ...op, old: o, new: nn };
    if (op.t !== 'add') o++;
    if (op.t !== 'del') nn++;
    if (op.t === 'add') added++;
    if (op.t === 'del') removed++;
    return row;
  });

  const changed = numbered.map((op, i) => (op.t === 'ctx' ? -1 : i)).filter((i) => i >= 0);
  const hunks = [];
  let k = 0;
  while (k < changed.length) {
    let from = Math.max(0, changed[k] - context);
    let to = Math.min(numbered.length - 1, changed[k] + context);
    while (k + 1 < changed.length && changed[k + 1] - context <= to + 1) {
      k++;
      to = Math.min(numbered.length - 1, changed[k] + context);
    }
    const lines = numbered.slice(from, to + 1);
    hunks.push({ oldStart: lines[0].old, newStart: lines[0].new, lines: lines.map(({ t, text }) => ({ t, text })) });
    k++;
  }
  return { hunks, added, removed };
}
