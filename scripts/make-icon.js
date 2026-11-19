// Draws the JARVIS NEXT app icon (the node mesh, the same shape as the logo in the app, in the interface's own colours read from
// src/styles/tokens.css) and writes the favicon, the PNG sizes, the Windows .ico and the Mac .icns.   node scripts/make-icon.js
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import { meshPoints, projectPoints, MESH_LINK } from '../src/core/mesh-geometry.js';

const tokens = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
const token = (name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1] ?? '#000000'; // first (dark) value

// `old` draws the JARVIS (old) icon: the same mark in the warm amber, so the two sit apart in the taskbar.
export function iconSvg({ old = false } = {}) {
  if (!old) return meshSvg();
  const [bg, edge, accent, mid] = [token('--bg'), token('--surface-4'), token(old ? '--warm' : '--accent'), old ? token('--warm') : token('--accent-mid')];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <rect x="6" y="6" width="244" height="244" rx="58" fill="${bg}" stroke="${edge}" stroke-width="4"/>
  <circle cx="128" cy="128" r="86" stroke="${accent}" stroke-width="14" stroke-linecap="round" stroke-dasharray="150 31.5" transform="rotate(-70 128 128)"/>
  <circle cx="128" cy="128" r="54" stroke="${mid}" stroke-width="9"/>
  <circle cx="128" cy="128" r="22" fill="${accent}"/>
</svg>
`;
}

// The mesh as the old HUD drew it (a faint wide link and a thin bright one, small dots with a soft halo), in the interface's colours; the dots a little bluer.
// bleed: a full square with no rounded corners, for iOS (it rounds the icon itself and fills transparent corners with black)
export function meshSvg({ bleed = false } = {}) {
  const [bg, edge, accent, text] = [token('--bg'), token('--surface-4'), token('--accent'), token('--text')];
  const hex = (c) => c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (x, y, k) => '#' + hex(rgb(x).map((v, i) => Math.round(v + (rgb(y)[i] - v) * k)));
  const core = mix(accent, text, 0.3), bright = mix(accent, text, 0.5);
  const pts = projectPoints(meshPoints(), { spin: 0.9, tilt: 0.1 });
  const c = 128, r = 84;
  const at = pts.map((p) => ({ x: c + p.x * r, y: c + p.y * r, f: p.f }));
  const lines = [];
  for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
    const d = Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) / r;
    if (d >= MESH_LINK) continue;
    const k = 1 - d / MESH_LINK;
    const a = Math.min(1, k * k * (3 - 2 * k) * (0.15 + 0.85 * (at[i].f + at[j].f) / 2) * 0.5);
    if (a < 0.06) continue; // the faintest links add weight and nothing you can see
    const seg = `x1="${at[i].x.toFixed(1)}" y1="${at[i].y.toFixed(1)}" x2="${at[j].x.toFixed(1)}" y2="${at[j].y.toFixed(1)}" stroke-linecap="round"`;
    lines.push(`<line ${seg} stroke="${accent}" stroke-opacity="${(a * 0.3).toFixed(2)}" stroke-width="5"/><line ${seg} stroke="${bright}" stroke-opacity="${Math.min(1, a * 1.6).toFixed(2)}" stroke-width="1.8"/>`);
  }
  const dots = at.map((p) => {
    const rad = 2.4 + 2.2 * p.f;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(rad * 3.6).toFixed(1)}" fill="${accent}" fill-opacity="${(0.1 + 0.2 * p.f).toFixed(2)}"/><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${core}" fill-opacity="${(0.5 + 0.5 * p.f).toFixed(2)}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  ${bleed ? `<rect width="256" height="256" fill="${bg}"/>` : `<rect x="6" y="6" width="244" height="244" rx="58" fill="${bg}" stroke="${edge}" stroke-width="4"/>`}
  <circle cx="128" cy="128" r="96" fill="${accent}" fill-opacity="0.06"/>
  ${lines.join('\n  ')}
  ${dots.join('\n  ')}
</svg>
`;
}

// PNG images in a Mac .icns (the 128, 256 and 512 px types hold PNG data directly)
export function packIcns(images) {
  const types = { 128: 'ic07', 256: 'ic08', 512: 'ic09' };
  const parts = images.filter((i) => types[i.size]).map(({ size, png }) => { const h = Buffer.alloc(8); h.write(types[size], 0, 'ascii'); h.writeUInt32BE(8 + png.length, 4); return Buffer.concat([h, png]); });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

// PNG images packed in an .ico (Windows has read these since Vista)
export function packIco(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

if (isMain(import.meta.url)) {
  const svg = iconSvg();
  const oldSvg = iconSvg({ old: true });
  fs.writeFileSync(path.join(ROOT, 'public', 'favicon.svg'), svg);
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const png = async (size, svg = null) => {
    svg ??= iconSvg();
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const buf = await page.screenshot({ omitBackground: true });
    await page.close();
    return buf;
  };
  const icons = path.join(ROOT, 'src-tauri', 'icons');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const made = Object.fromEntries(await Promise.all(sizes.map(async (s) => [s, await png(s)])));
  fs.writeFileSync(path.join(icons, 'icon.png'), made[512]);
  fs.writeFileSync(path.join(icons, 'icon.icns'), packIcns([128, 256, 512].map((size) => ({ size, png: made[size] }))));
  fs.writeFileSync(path.join(ROOT, 'public', 'icon-256.png'), made[256]); // the web app's icons (manifest.webmanifest)
  fs.writeFileSync(path.join(ROOT, 'public', 'icon-512.png'), made[512]);
  fs.writeFileSync(path.join(ROOT, 'public', 'apple-touch-icon.png'), await png(180, meshSvg({ bleed: true }))); // the iPhone home-screen icon
  fs.writeFileSync(path.join(icons, '32x32.png'), made[32]);
  fs.writeFileSync(path.join(icons, '128x128.png'), made[128]);
  fs.writeFileSync(path.join(icons, '128x128@2x.png'), made[256]);
  const oldMade = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async (size) => ({ size, png: await png(size, oldSvg) })));
  fs.writeFileSync(path.join(icons, 'icon-old.ico'), packIco(oldMade));
  fs.writeFileSync(path.join(icons, 'icon.ico'), packIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: made[size] }))));
  await browser.close();
  console.log('Icon written: public/favicon.svg and src-tauri/icons/ (icon.ico, icon.png, 32x32, 128x128). icon.icns (Mac), public/icon-256.png, icon-512.png and apple-touch-icon.png.');
}
