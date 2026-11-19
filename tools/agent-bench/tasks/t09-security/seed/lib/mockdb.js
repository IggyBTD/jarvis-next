// Tiny stand-in for a SQL database. query(sql, params): with params, "?" is a bound value (never parsed as SQL).
// Without params the SQL text is interpreted as written, so string-built queries are injectable.
const ROWS = [
  { id: 1, name: "alice", role: "admin" },
  { id: 2, name: "bob", role: "user" },
  { id: 3, name: "O'Brien", role: "user" },
];

function query(sql, params) {
  if (params) {
    const m = /^SELECT \* FROM users WHERE name = \?$/.exec(sql);
    if (!m) throw new Error("unsupported sql");
    return ROWS.filter((r) => r.name === params[0]);
  }
  const m = /^SELECT \* FROM users WHERE name = '(.*)'$/.exec(sql);
  if (!m) throw new Error("syntax error");
  if (m[1].includes("' OR '")) return ROWS.slice();
  return ROWS.filter((r) => r.name === m[1]);
}

module.exports = { query };
