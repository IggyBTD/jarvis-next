const test = require("node:test"); const assert = require("node:assert"); const fs = require("fs"); const os = require("os"); const path = require("path");
const { serveFile, findUser, loadConfig } = require("../src/server"); const db = require("../lib/mockdb");
test("serves a file", () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "srv-")); fs.writeFileSync(path.join(d, "a.txt"), "hi"); assert.strictEqual(serveFile(d, "a.txt"), "hi"); assert.strictEqual(serveFile(d, "nope.txt"), null); });
test("finds a user", () => assert.strictEqual(findUser(db, "bob").length, 1));
test("loads config", () => assert.deepStrictEqual(loadConfig("{\"a\": 1}"), { a: 1 }));
