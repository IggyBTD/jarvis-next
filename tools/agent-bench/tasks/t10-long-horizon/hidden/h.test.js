const test = require("node:test"); const assert = require("node:assert"); const fs = require("fs"); const os = require("os"); const path = require("path"); const { spawnSync } = require("child_process");
const CLI = path.join(__dirname, "..", "cli.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-"));
const file = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
const run = (...a) => { const r = spawnSync(process.execPath, [CLI, ...a], { encoding: "utf8" }); return { out: r.stdout, err: r.stderr, code: r.status }; };
const basic = file("basic.csv", "name,city,price\nann,Paris,10\nbob,\"Lon,don\",20.5\ncy,Paris,\ndee,Rome,abc\neve,Paris,4.5\n");
const crlf = file("crlf.csv", "name,note,price\r\nann,\"say \"\"hi\"\"\",3\r\nbob,\"two\nlines\",1\r\n");
test("stats plain", () => { const r = run("stats", basic, "--col", "price"); assert.strictEqual(r.code, 0); assert.strictEqual(r.out, "count=3\nmin=4.5\nmax=20.5\nmean=11.67\n"); });
test("stats no numeric", () => assert.strictEqual(run("stats", basic, "--col", "city").out, "count=0\n"));
test("filter quoted comma and header", () => { const r = run("filter", basic, "--col", "city", "--eq", "Lon,don"); assert.strictEqual(r.out, "name,city,price\nbob,\"Lon,don\",20.5\n"); });
test("filter exact match only", () => assert.strictEqual(run("filter", basic, "--col", "city", "--eq", "paris").out, "name,city,price\n"));
test("crlf and embedded quotes/newlines round trip", () => { const r = run("filter", crlf, "--col", "price", "--eq", "3"); assert.strictEqual(r.out, "name,note,price\nann,\"say \"\"hi\"\"\",3\n"); const r2 = run("filter", crlf, "--col", "price", "--eq", "1"); assert.strictEqual(r2.out, "name,note,price\nbob,\"two\nlines\",1\n"); });
test("errors", () => {
  let r = run("stats", basic, "--col", "zzz"); assert.strictEqual(r.code, 2); assert.strictEqual(r.err.trim(), "no such column: zzz");
  r = run("stats", path.join(dir, "missing.csv"), "--col", "a"); assert.strictEqual(r.code, 2); assert.ok(r.err.startsWith("cannot read "));
  r = run("bogus"); assert.strictEqual(r.code, 2); assert.strictEqual(r.err.trim(), "unknown command: bogus");
});
test("part2 group-by plain", () => { const r = run("stats", basic, "--col", "price", "--group-by", "city"); assert.strictEqual(r.out, "Lon,don\tcount=1,min=20.5,max=20.5,mean=20.50\nParis\tcount=2,min=4.5,max=10,mean=7.25\nRome\tcount=0\n"); });
test("part2 json", () => {
  assert.deepStrictEqual(JSON.parse(run("stats", basic, "--col", "price", "--format", "json").out), { count: 3, min: 4.5, max: 20.5, mean: 11.67 });
  assert.deepStrictEqual(JSON.parse(run("stats", basic, "--col", "city", "--format", "json").out), { count: 0 });
  assert.deepStrictEqual(JSON.parse(run("stats", basic, "--col", "price", "--group-by", "city", "--format", "json").out), [{ group: "Lon,don", count: 1, min: 20.5, max: 20.5, mean: 20.5 }, { group: "Paris", count: 2, min: 4.5, max: 10, mean: 7.25 }, { group: "Rome", count: 0 }]);
  const f = run("filter", basic, "--col", "city", "--eq", "Paris", "--format", "json"); assert.ok(f.out.endsWith("]\n")); assert.deepStrictEqual(JSON.parse(f.out), [{ name: "ann", city: "Paris", price: "10" }, { name: "cy", city: "Paris", price: "" }, { name: "eve", city: "Paris", price: "4.5" }]);
});
test("part2 sort numeric, empty last, stable, desc", () => {
  assert.strictEqual(run("sort", basic, "--col", "price").out, ["name,city,price", "ann,Paris,10", "bob,\"Lon,don\",20.5", "eve,Paris,4.5", "dee,Rome,abc", "cy,Paris,", ""].join("\n"));
  const asc = run("sort", file("n.csv", "k,v\na,10\nb,9\nc,\nd,9\ne,100\n"), "--col", "v").out; assert.strictEqual(asc, "k,v\nb,9\nd,9\na,10\ne,100\nc,\n");
  const desc = run("sort", file("n2.csv", "k,v\na,10\nb,9\nc,\nd,9\ne,100\n"), "--col", "v", "--desc").out; assert.strictEqual(desc, "k,v\ne,100\na,10\nb,9\nd,9\nc,\n");
  const str = run("sort", file("s.csv", "k,v\na,pear\nb,apple\nc,\nd,Zed\n"), "--col", "v").out; assert.strictEqual(str, "k,v\nd,Zed\nb,apple\na,pear\nc,\n");
});
