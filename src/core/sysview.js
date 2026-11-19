// Sixty-second traces behind the three big readings of the System tab. History is kept here
// (telemetry-view.js only knows the latest reading); a line turns teal above 75 % and red above
// 90 % of its limit, the same thresholds the bars use.
import { getTelemetry, onTelemetry } from './telemetry-view.js';

const N = 60; // one sample a second
const W = 120;
const H = 40;
const SOURCES = {
  cpu: (d) => d.CPU_Load / 100,
  gpu: (d) => d.GPU_Compute_Load / 100,
  ram: (d) => d.Memory_Usage / d.Memory_Total,
};
const history = { cpu: [], gpu: [], ram: [] };

const pane = document.getElementById('ws-system');
function draw(key) {
  if (pane?.hidden) return; // the System tab is closed: the history keeps growing, the picture is drawn when it opens
  const svg = document.querySelector(`.spark[data-key="${key}"]`);
  const h = history[key];
  if (!svg || h.length < 2) return;
  const pts = h.map((v, i) => [(N - h.length + i) * (W / (N - 1)), H - 3 - Math.min(1, Math.max(0, v)) * (H - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const last = h[h.length - 1];
  svg.dataset.level = last > 0.9 ? 'high' : last > 0.7 ? 'mid' : '';
  svg.innerHTML = `<path class="area" d="${line}L${pts[pts.length - 1][0].toFixed(1)} ${H}L${pts[0][0].toFixed(1)} ${H}Z"/><path class="line" d="${line}"/>`;
}

onTelemetry(() => {
  const { data, offline } = getTelemetry();
  if (offline) return;
  for (const [key, read] of Object.entries(SOURCES)) {
    const v = read(data);
    if (!Number.isFinite(v)) continue;
    history[key].push(v);
    if (history[key].length > N) history[key].shift();
    draw(key);
  }
});

if (pane) new MutationObserver(() => { if (!pane.hidden) Object.keys(history).forEach(draw); }).observe(pane, { attributes: true, attributeFilter: ['hidden'] });
