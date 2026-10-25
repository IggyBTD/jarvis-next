// Draws the JARVIS NEXT app icon (an arc reactor in the interface's own colours, read from src/styles/tokens.css) and writes
// the favicon, the PNG sizes and the Windows .ico the shortcut uses.   node scripts/make-icon.js
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';

const tokens = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
const token = (name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1] ?? '#000000'; // first (dark) value

export function iconSvg() {
  const [bg, edge, accent, mid] = [token('--bg'), token('--surface-4'), token('--accent'), token('--accent-mid')];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <rect x="6" y="6" width="244" height="244" rx="58" fill="${bg}" stroke="${edge}" stroke-width="4"/>
  <circle cx="128" cy="128" r="86" stroke="${accent}" stroke-width="14" stroke-linecap="round" stroke-dasharray="150 31.5" transform="rotate(-70 128 128)"/>
  <circle cx="128" cy="128" r="54" stroke="${mid}" stroke-width="9"/>
  <circle cx="128" cy="128" r="22" fill="${accent}"/>
</svg>
`;
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
  fs.writeFileSync(path.join(ROOT, 'public', 'favicon.svg'), svg);
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const png = async (size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const buf = await page.screenshot({ omitBackground: true });
    await page.close();
    return buf;
  };
  const icons = path.join(ROOT, 'src-tauri', 'icons');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const made = Object.fromEntries(await Promise.all(sizes.map(async (s) => [s, await png(s)])));
  await browser.close();
  fs.writeFileSync(path.join(icons, 'icon.png'), made[512]);
  fs.writeFileSync(path.join(icons, '32x32.png'), made[32]);
  fs.writeFileSync(path.join(icons, '128x128.png'), made[128]);
  fs.writeFileSync(path.join(icons, '128x128@2x.png'), made[256]);
  fs.writeFileSync(path.join(icons, 'icon.ico'), packIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: made[size] }))));
  console.log('Icon written: public/favicon.svg and src-tauri/icons/ (icon.ico, icon.png, 32x32, 128x128). icon.icns (Mac app) is not regenerated.');
}
