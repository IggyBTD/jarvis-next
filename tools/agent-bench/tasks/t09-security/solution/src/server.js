const fs = require("fs");
const path = require("path");

function serveFile(root, reqPath) {
  if (typeof reqPath !== "string" || reqPath.includes("\0")) return null;
  const base = path.resolve(root);
  const p = path.resolve(base, "." + path.sep + reqPath.replace(/\\/g, "/").replace(/^\/+/, ""));
  const rel = path.relative(base, p);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
}

function findUser(db, name) {
  return db.query("SELECT * FROM users WHERE name = ?", [name]);
}

function loadConfig(text) {
  return JSON.parse(text);
}

module.exports = { serveFile, findUser, loadConfig };
