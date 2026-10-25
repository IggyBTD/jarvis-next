// Builds dist-mac/jarvis-mac.zip: only what the Mac needs to be controlled by JARVIS (the agent, its sidecars, the config and the
// setup scripts). No Tauri app, no models, no old UI, no tests. The file list is worked out from the real import graph of the
// entry files, so it cannot drift from the code. Unpack on the Mac, `npm install`, `node scripts/install.js --os darwin --apply`.
//   node scripts/make-mac-bundle.js [--out dist-mac]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import zlib from 'node:zlib';

const ENTRIES = ['scripts/update.js', 'scripts/wake.js', 'scripts/wake-relay.js', 'agent/index.js', 'sidecars/browser-guard/server.js', 'scripts/install.js', 'scripts/doctor.js', 'scripts/opencode-verify.js', 'scripts/gen-tokens.js'];
const WHOLE_DIRS = ['agent', 'sidecars/browser-guard', 'config/server'];
const IMPORT = /(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

// A minimal zip writer (deflate, no zip64): the standard zip tools on both systems can read it, and it needs no tar or zip program.
export function writeZip(zipFile, dir, names) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const data = fs.readFileSync(path.join(dir, name));
    const packed = zlib.deflateRawSync(data);
    const nm = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nm.length, 26);
    parts.push(local, nm, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += 30 + nm.length + packed.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipFile, Buffer.concat([...parts, dirBuf, end]));
}

export function closure(root, entries) {
  const seen = new Set();
  const visit = (rel) => {
    const abs = path.resolve(root, rel);
    const key = path.relative(root, abs).split(path.sep).join('/');
    if (seen.has(key) || !fs.existsSync(abs)) return;
    seen.add(key);
    const text = fs.readFileSync(abs, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // line comments first: one can contain "/*"
    for (const m of text.matchAll(IMPORT)) visit(path.relative(root, path.resolve(path.dirname(abs), m[1])));
  };
  entries.forEach(visit);
  return [...seen];
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

export async function buildMacBundle({ root = ROOT, outDir = path.join(root, 'dist-mac') } = {}) {
  const inDirs = WHOLE_DIRS.filter((d) => d !== 'config/server').flatMap((d) => walk(path.join(root, d)).filter((f) => /.js$/.test(f)).map((f) => path.relative(root, f)));
  const files = new Set(closure(root, [...ENTRIES, ...inDirs]));
  for (const dir of WHOLE_DIRS) for (const f of walk(path.join(root, dir))) files.add(path.relative(root, f).split(path.sep).join('/'));
  for (const extra of ['docs/MAC_PROMPT.md', 'docs/setup-mac.md', 'docs/remote.md']) if (fs.existsSync(path.join(root, extra))) files.add(extra);
  const stage = path.join(outDir, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  for (const rel of [...files].sort()) { fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.copyFileSync(path.join(root, rel), path.join(stage, rel)); }
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({ name: 'jarvis-mac', private: true, type: 'module', engines: { node: '>=22' }, dependencies: { playwright: rootPkg.devDependencies.playwright ?? rootPkg.dependencies.playwright } }, null, 2)}\n`);
  fs.writeFileSync(path.join(stage, 'README-MAC.md'), 'JARVIS helper for the Mac. Follow docs/MAC_PROMPT.md (or paste it into Claude Code), or docs/setup-mac.md by hand.\nThe tokens are NOT in this folder: put mac.token in data/tokens/ yourself.\n');
  const zip = path.join(outDir, 'jarvis-mac.zip');
  fs.rmSync(zip, { force: true });
  const all = [...files, 'package.json', 'README-MAC.md'].sort();
  writeZip(zip, stage, all);
  return { zip, stage, files: all, bytes: fs.statSync(zip).size };
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const r = await buildMacBundle(i === -1 ? {} : { outDir: path.resolve(process.argv[i + 1]) });
  console.log(`${r.files.length} files, ${(r.bytes / 1024).toFixed(0)} KB: ${r.zip}`);
}
