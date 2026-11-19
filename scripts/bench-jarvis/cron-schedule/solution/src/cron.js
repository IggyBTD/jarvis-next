const LIMITS = { min: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 7] };

function field(text, name) {
  const [lo, hi] = LIMITS[name];
  const set = new Set();
  for (const item of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
    if (!m) throw new Error(`bad ${name}: ${item}`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`bad step in ${name}: ${item}`);
    let a, b;
    if (m[1] === '*') [a, b] = [lo, hi];
    else if (m[1].includes('-')) [a, b] = m[1].split('-').map(Number);
    else [a, b] = [Number(m[1]), m[2] === undefined ? Number(m[1]) : hi];
    if (a < lo || b > hi || a > b) throw new Error(`${name} out of range: ${item}`);
    for (let v = a; v <= b; v += step) set.add(name === 'dow' && v === 7 ? 0 : v);
  }
  return set;
}

function parse(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`expected 5 fields: ${expr}`);
  return {
    min: field(f[0], 'min'),
    hour: field(f[1], 'hour'),
    dom: field(f[2], 'dom'),
    month: field(f[3], 'month'),
    dow: field(f[4], 'dow'),
    domStar: f[2].startsWith('*'),
    dowStar: f[4].startsWith('*'),
  };
}

function dayOk(c, t) {
  const dom = c.dom.has(t.getUTCDate());
  const dow = c.dow.has(t.getUTCDay());
  if (c.domStar && c.dowStar) return dom && dow;
  if (c.domStar) return dow;
  if (c.dowStar) return dom;
  return dom || dow;
}

function nextRun(expr, from) {
  const c = parse(expr);
  const t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  const limit = from.getTime() + 5 * 366 * 86400000;
  while (t.getTime() <= limit) {
    if (!c.month.has(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
    } else if (!dayOk(c, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
    } else if (!c.hour.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
    } else if (!c.min.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
    } else {
      return t;
    }
  }
  throw new Error(`no run within 5 years: ${expr}`);
}

module.exports = { nextRun };
