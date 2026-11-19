// Builds dist-mac/jarvis-mac.zip: only what the Mac needs to be controlled by JARVIS (the agent, its sidecars, the config and the
// setup scripts). No Tauri app, no models, no old UI, no tests. The file list is worked out from the real import graph of the
// entry files, so it cannot drift from the code. Unpack on the Mac, `npm install`, `node scripts/install.js --os darwin --apply`.
//   node scripts/make-mac-bundle.js [--out dist-mac]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import zlib from 'node:zlib';

const ENTRIES = ['scripts/update.js', 'scripts/wake.js', 'scripts/wake-relay.js', 'scripts/open-mac.js', 'agent/index.js', 'sidecars/browser-guard/server.js', 'scripts/install.js', 'scripts/doctor.js', 'scripts/opencode-verify.js', 'scripts/gen-tokens.js'];
const WHOLE_DIRS = ['agent', 'sidecars/browser-guard', 'config/server'];
const IMPORT = /(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

// A minimal zip writer (deflate, no zip64): the standard zip tools on both systems can read it, and it needs no tar or zip program.
export function writeZip(zipFile, dir, names, exec = /\/MacOS\/|\.command$/) {
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
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 20, 4); c.writeUInt32LE(((exec.test(name) ? 0o100755 : 0o100644) << 16) >>> 0, 38); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
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

// A double-clickable app for the Dock: it only runs scripts/open-mac.js from the folder that holds it (keep the folder, e.g. ~/jarvis).
const APP = {
  'JARVIS.app/Contents/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>JARVIS</string><key>CFBundleDisplayName</key><string>JARVIS</string><key>CFBundleIdentifier</key><string>com.jarvis.launcher</string><key>CFBundleExecutable</key><string>JARVIS</string><key>CFBundleIconFile</key><string>AppIcon</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/></dict></plist>
`,
  'JARVIS.app/Contents/MacOS/JARVIS': `#!/bin/bash
cd "$(dirname "$0")/../../.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null || { osascript -e 'display dialog "JARVIS needs Node 22 or newer: brew install node" buttons {"OK"}'; exit 1; }
exec node scripts/open-mac.js
`,
};

export async function buildMacBundle({ root = ROOT, outDir = path.join(root, 'dist-mac'), withTokens = false } = {}) {
  const inDirs = WHOLE_DIRS.filter((d) => d !== 'config/server').flatMap((d) => walk(path.join(root, d)).filter((f) => /.js$/.test(f)).map((f) => path.relative(root, f)));
  const files = new Set(closure(root, [...ENTRIES, ...inDirs]));
  for (const dir of WHOLE_DIRS) for (const f of walk(path.join(root, dir))) files.add(path.relative(root, f).split(path.sep).join('/'));
  for (const extra of ['docs/MAC_PROMPT.md', 'docs/setup-mac.md', 'docs/remote.md']) if (fs.existsSync(path.join(root, extra))) files.add(extra);
  const stage = path.join(outDir, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  for (const rel of [...files].sort()) { fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.copyFileSync(path.join(root, rel), path.join(stage, rel)); }
  const extra = Object.keys(APP);
  const icns = path.join(root, 'src-tauri', 'icons', 'icon.icns'); // the mesh logo (scripts/make-icon.js)
  if (fs.existsSync(icns)) { const dest = 'JARVIS.app/Contents/Resources/AppIcon.icns'; fs.mkdirSync(path.dirname(path.join(stage, dest)), { recursive: true }); fs.copyFileSync(icns, path.join(stage, dest)); extra.push(dest); }
  for (const [rel, text] of Object.entries(APP)) { fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.writeFileSync(path.join(stage, rel), text); }
  // Machine tokens are opt-in: the zip then holds secrets, so move it by AirDrop or USB only, and delete it afterwards. The UI token is
  // never in it: the Mac's browser and open-mac.js are paired with a code (node scripts/client-link.js browser).
  if (withTokens) for (const rel of ['data/tokens/mac.token', 'data/tokens/wake.token', 'data/wake.json']) if (fs.existsSync(path.join(root, rel))) { fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.copyFileSync(path.join(root, rel), path.join(stage, rel)); extra.push(rel); }
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({ name: 'jarvis-mac', private: true, type: 'module', engines: { node: '>=22' }, dependencies: { playwright: rootPkg.devDependencies.playwright ?? rootPkg.dependencies.playwright } }, null, 2)}\n`);
  fs.writeFileSync(path.join(stage, 'README-MAC.md'), 'JARVIS helper for the Mac. Follow docs/MAC_PROMPT.md (or paste it into Claude Code), or docs/setup-mac.md by hand.\nThe tokens are NOT in this folder: put mac.token in data/tokens/ yourself.\n');
  const zip = path.join(outDir, withTokens ? 'jarvis-mac-with-tokens.zip' : 'jarvis-mac.zip');
  fs.rmSync(zip, { force: true });
  const all = [...files, ...extra, 'package.json', 'README-MAC.md'].sort();
  writeZip(zip, stage, all);
  return { zip, stage, files: all, bytes: fs.statSync(zip).size };
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const r = await buildMacBundle({ ...(i === -1 ? {} : { outDir: path.resolve(process.argv[i + 1]) }), withTokens: process.argv.includes('--with-tokens') });
  console.log(`${r.files.length} files, ${(r.bytes / 1024).toFixed(0)} KB: ${r.zip}`);
  if (process.argv.includes('--with-tokens')) console.log('WARNING: this zip holds the Mac machine token. Move it by AirDrop or USB only and delete it on both computers as soon as it is unpacked.');
}
