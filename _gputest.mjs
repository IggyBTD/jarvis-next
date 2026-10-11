import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
const mode = process.argv[2];
const sets = { software: ['--disable-gpu'], hybrid: ['--disable-gpu-compositing', '--disable-gpu-rasterization', '--force_low_power_gpu'], low: ['--force_low_power_gpu'] };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: sets[mode] });
const page = await browser.newPage();
await page.setContent('<canvas id=c width=600 height=400></canvas>');
const info = await page.evaluate(() => {
  const gl = document.getElementById('c').getContext('webgl');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  for (let i = 0; i < 30; i += 1) { gl.clearColor(Math.random(), 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
});
await new Promise((r) => setTimeout(r, 1500));
const run = (f, ...a) => execFileSync('powershell', ['-NoProfile', '-File', f, ...a]).toString().trim();
const pids = run(process.env.PIDS_PS1).split(/\s+/).filter(Boolean);
const mem = run(process.env.MEM_PS1, pids.join(',')).replace(/\r?\n/g, ', ');
console.log(mode, '| WebGL renderer:', info, '| GPU memory of this Chrome:', mem || 'none', '| gpu pids', pids.join(','));
await browser.close();
