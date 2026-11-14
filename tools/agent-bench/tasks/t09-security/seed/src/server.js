const fs = require("fs");
const path = require("path");

// Returns the text of a file under `root` for a request path, or null if there is no such file.
function serveFile(root, reqPath) {
  const p = path.join(root, reqPath);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
}

// Looks a user up by name. `db` has query(sql, params?).
function findUser(db, name) {
  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
}

// Parses the JSON config text sent by a client.
function loadConfig(text) {
  return eval("(" + text + ")");
}

module.exports = { serveFile, findUser, loadConfig };
