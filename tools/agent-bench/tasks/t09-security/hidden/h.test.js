const test = require("node:test"); const assert = require("node:assert"); const fs = require("fs"); const os = require("os"); const path = require("path");
const { serveFile, findUser, loadConfig } = require("../src/server"); const db = require("../lib/mockdb");
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sec-")); const root = path.join(base, "public"); fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "a.txt"), "A"); fs.writeFileSync(path.join(root, "sub", "b.txt"), "B");
  fs.writeFileSync(path.join(base, "secret.txt"), "TOP SECRET"); fs.mkdirSync(path.join(base, "public-secret")); fs.writeFileSync(path.join(base, "public-secret", "s.txt"), "SIBLING");
  return { base, root };
}
test("normal files still served", () => { const { root } = setup(); assert.strictEqual(serveFile(root, "a.txt"), "A"); assert.strictEqual(serveFile(root, "sub/b.txt"), "B"); assert.strictEqual(serveFile(root, "sub/../a.txt"), "A"); assert.strictEqual(serveFile(root, "/a.txt"), "A"); assert.strictEqual(serveFile(root, "missing"), null); });
test("parent traversal blocked", () => { const { root } = setup(); for (const p of ["../secret.txt", "sub/../../secret.txt", "..\\secret.txt", "sub\\..\\..\\secret.txt", "../public/../secret.txt"]) assert.strictEqual(serveFile(root, p), null, p); });
test("sibling directory with shared prefix blocked", () => { const { root } = setup(); assert.strictEqual(serveFile(root, "../public-secret/s.txt"), null); });
test("null byte and encoded traversal blocked or null", () => { const { root } = setup(); for (const p of ["a.txt\u0000.png", "..%2fsecret.txt", "%2e%2e/secret.txt"]) { let v; try { v = serveFile(root, p); } catch { v = null; } assert.ok(v === null || v === undefined, p); } });
test("sql injection blocked", () => { assert.deepStrictEqual(findUser(db, "x' OR '1'='1"), []); assert.deepStrictEqual(findUser(db, "' OR '"), []); });
test("legit names including quotes", () => { assert.strictEqual(findUser(db, "O'Brien").length, 1); assert.strictEqual(findUser(db, "alice")[0].role, "admin"); assert.strictEqual(findUser(db, "nobody").length, 0); });
test("config is data only", () => {
  globalThis.__pwned = false;
  for (const t of ["(globalThis.__pwned = true, {})", "{a: globalThis.__pwned = true}", "process.exit(3)", "({a:1})", "{\"a\": 1,}"]) assert.throws(() => loadConfig(t), SyntaxError, t);
  assert.strictEqual(globalThis.__pwned, false);
});
test("config valid json and no prototype pollution", () => { assert.deepStrictEqual(loadConfig("{\"a\": [1, 2, {\"b\": null}]}"), { a: [1, 2, { b: null }] }); const c = loadConfig("{\"__proto__\": {\"polluted\": 1}}"); assert.strictEqual(({}).polluted, undefined); assert.strictEqual(c.polluted, undefined); });
