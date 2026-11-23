// A chart artifact that is a function plot ({"type":"function","functions":[...]}): the sandboxed frame draws the curves from the
// formulas and puts a slider under them for every variable. Run alone: node --test tests/browser/formula-plot.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { ROOT } from '../../server/core/config.js';

const VITE_PORT = 5196;
let vite; let browser; let page; const errors = [];

before(async () => {
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${VITE_PORT}`);
});

after(async () => {
  await browser?.close();
  await vite?.close();
});

// the artifact frame exactly as the panel makes it: sandboxed, no same-origin
async function openPlot(spec, size = { width: 900, height: 700 }) {
  await page.evaluate(async ([json, w, h]) => {
    const { buildSrcdoc } = await import('/src/core/artifact-renderer.js');
    document.getElementById('plot-frame')?.remove();
    const f = document.createElement('iframe');
    f.id = 'plot-frame';
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:99999`;
    f.srcdoc = await buildSrcdoc('chart', json);
    document.body.append(f);
  }, [typeof spec === 'string' ? spec : JSON.stringify(spec), size.width, size.height]);
  const handle = await page.waitForSelector('#plot-frame');
  const frame = await handle.contentFrame();
  await frame.waitForSelector('canvas#c, pre.err'); // a plot and an ordinary chart have a canvas, a plot that cannot be drawn says why
  await page.waitForTimeout(250); // the first draw and the resize that follows it
  return frame;
}
// a number that changes when the curve is drawn differently
const signature = (frame) => frame.evaluate(() => { const c = document.getElementById('c'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i] * ((i >> 2) % 997); return s; });
// the plotted numbers (the pixels differ a little between the first draw and later ones: the font arrives in between)
const plotted = (frame) => frame.evaluate(() => JSON.stringify(Chart.getChart('c').data.datasets.map((d) => d.data.map((p) => p.y))));
const values = (frame) => frame.$$eval('.row input.val', (els) => els.map((e) => e.value));

const DAMPED = { type: 'function', functions: ['A*exp(-k*x)*sin(w*x)', { expr: 'A*exp(-k*x)', label: 'envelope' }], x: { min: 0, max: 12, label: 't' }, params: { A: { min: 0, max: 5, value: 3, label: 'Amplitude' }, k: { min: 0, max: 1, value: 0.2 } } };

test('formulas are drawn without any points, with a slider for each variable, in the right order and with their starting values', async () => {
  const frame = await openPlot(DAMPED);
  await frame.waitForSelector('.row');
  assert.deepEqual(await frame.$$eval('.row .sym', (els) => els.map((e) => e.textContent)), ['A', 'k', 'w']); // declared ones first, then the one found in the formula
  assert.deepEqual(await values(frame), ['3.00', '0.200', '1.00']);
  assert.equal(await frame.$eval('.row .desc', (e) => e.textContent), 'Amplitude');
  assert.equal(await frame.locator('input[type=range]').count(), 3);
  assert.ok(await signature(frame) > 0, 'the curve is on the canvas');
  const legend = await frame.evaluate(() => Chart.getChart('c').data.datasets.map((d) => `${d.label}:${d.data.length}`));
  assert.deepEqual(legend, ['y = A*exp(-k*x)*sin(w*x):801', 'envelope:801']);
  assert.deepEqual(errors, []);
});

test('a slider redraws the curve at once, by keyboard and by typing a number; Reset puts everything back', async () => {
  const frame = await openPlot(DAMPED);
  await frame.waitForSelector('.row');
  const before = await signature(frame);
  const first = await plotted(frame);
  await frame.locator('input[type=range]').nth(2).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  const after = await signature(frame);
  assert.notEqual(after, before, 'the curve changed');
  const shown = (await values(frame))[2];
  assert.ok(Number(shown) > 1, `the number follows the slider (${shown})`);
  // typing a number moves the slider, and a number past the end stops at the end
  const box = frame.locator('input.val').nth(0);
  await box.fill('4');
  await box.press('Enter');
  assert.equal(await frame.locator('input[type=range]').nth(0).inputValue(), '4');
  await box.fill('99');
  await box.press('Enter');
  assert.deepEqual((await values(frame))[0], '5.00');
  await frame.click('#reset');
  await page.waitForTimeout(80);
  assert.deepEqual(await values(frame), ['3.00', '0.200', '1.00']);
  assert.equal(await plotted(frame), first, 'back to the first curves');
});

test('the line breaks at an asymptote, a formula that does not parse is named and skipped, and the others still draw', async () => {
  const frame = await openPlot({ functions: ['tan(x)', 'sin(', 'x^2 = y'], x: [-3, 3] });
  await frame.waitForSelector('#plot');
  const gaps = await frame.evaluate(() => Chart.getChart('c').data.datasets[0].data.filter((p) => p.y === null).length);
  assert.ok(gaps >= 2 && gaps < 10, `gaps at -pi/2 and pi/2 (${gaps})`);
  const note = await frame.$eval('#note', (e) => ({ text: e.textContent, shown: !e.hidden }));
  assert.equal(note.shown, true);
  assert.match(note.text, /Formula 2 \(sin\(\)/);
  assert.match(note.text, /Formula 3/);
  assert.equal(await frame.locator('#vars').isHidden(), true, 'no variables, no slider panel');
  assert.deepEqual(errors, []);
});

test('nothing to draw is said in words, and a formula cannot reach the page', async () => {
  const bad = await openPlot({ functions: ['sin('] });
  await bad.waitForSelector('pre.err');
  assert.match(await bad.$eval('pre.err', (e) => e.textContent), /Formula 1/);
  const sneaky = await openPlot({ functions: ['alert(1)', 'constructor', 'this'] });
  await sneaky.waitForSelector('.row');
  assert.deepEqual(await sneaky.$$eval('.row .sym', (els) => els.map((e) => e.textContent)), ['alert', 'constructor', 'this']); // only names, so only sliders
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
});

test('an ordinary Chart.js chart artifact is still drawn as before', async () => {
  const frame = await openPlot({ type: 'line', data: { labels: ['a', 'b', 'c'], datasets: [{ label: 'CPU %', data: [1, 3, 2] }] } });
  await frame.waitForSelector('canvas#c');
  assert.equal(await frame.locator('#vars').count(), 0);
  assert.equal(await frame.evaluate(() => Chart.getChart('c').config.type), 'line');
});

test('on a phone width the slider gets the full width under its name and number, and the panel scrolls rather than squeezing the chart', async () => {
  const frame = await openPlot({ functions: ['a*x + b*x^2 + c + d + e1 + f1'], params: {} }, { width: 375, height: 700 });
  await frame.waitForSelector('.row');
  const g = await frame.evaluate(() => {
    const r = document.querySelector('.row').getBoundingClientRect();
    const s = document.querySelector('.row input[type=range]').getBoundingClientRect();
    const chart = document.querySelector('.plot-chart').getBoundingClientRect();
    const vars = document.getElementById('vars').getBoundingClientRect();
    return { rowW: r.width, sliderW: s.width, chartH: chart.height, varsH: vars.height, total: innerHeight };
  });
  assert.ok(g.sliderW > g.rowW * 0.9, `full-width slider (${g.sliderW} of ${g.rowW})`);
  assert.ok(g.varsH <= g.total * 0.46, `variables take at most 45 % (${g.varsH})`);
  assert.ok(g.chartH > g.total * 0.4, `the chart keeps its room (${g.chartH})`);
});
