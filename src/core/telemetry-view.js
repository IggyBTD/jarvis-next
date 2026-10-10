// Draws the hardware telemetry stream into the HUD panels.
//
// Rule (from the ECC review): missing data is "unavailable", never a healthy-looking
// default. A metric that is absent from the payload, or every metric once the stream
// goes quiet, renders as N/A with an empty grey bar instead of 0.0.
const STALE_MS = 5000;        // no update for this long means the sensor source is gone
const INITIAL_GRACE_MS = 4000; // time allowed for the first update after launch

const $ = (id) => document.getElementById(id);
import { reportService } from './service-status.js';

const notchMeta = $('notch-meta');

let lastUpdate = 0;
let sawData = false;

// Latest reading for other views (the whiteboard's System panel). `offline` is true until the
// first reading and whenever the stream has gone quiet.
let latest = {};
let offline = true;
const subscribers = new Set();
export const getTelemetry = () => ({ data: latest, offline });
export function onTelemetry(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function publish(data, isOffline) {
  latest = data;
  offline = isOffline;
  subscribers.forEach((cb) => cb());
}

const num = (d, key) => {
  const v = d[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

function setMetric(id, barId, value, max, unit, digits = 1) {
  const el = $(id);
  const bar = barId && $(barId);
  if (el) {
    el.textContent = value === null ? 'N/A' : `${value.toFixed(digits)}${unit}`;
    el.classList.toggle('na', value === null);
  }
  if (bar) {
    const ok = value !== null && max > 0;
    bar.classList.toggle('unavailable', !ok);
    const ratio = ok ? Math.min(1, value / max) : 0;
    bar.style.transform = `scaleX(${ratio})`;
    // teal above 75 %, red above 90 %; free disk space is the other way round, so it keeps the accent
    bar.dataset.level = ok && barId !== 'ssd-space-bar' ? (ratio > 0.9 ? 'high' : ratio > 0.75 ? 'mid' : '') : '';
  }
}

function setNetwork(bytesPerSecond) {
  const el = $('wifi-speed-val');
  const bar = $('wifi-speed-bar');
  if (bytesPerSecond === null) {
    if (el) { el.textContent = 'N/A'; el.classList.add('na'); }
    if (bar) { bar.classList.add('unavailable'); bar.style.transform = 'scaleX(0)'; }
    return;
  }
  const bits = bytesPerSecond * 8;
  if (el) {
    el.classList.remove('na');
    el.textContent = bits >= 1_000_000 ? `${(bits / 1_000_000).toFixed(1)} Mbps` : `${(bits / 1_000).toFixed(1)} Kbps`;
  }
  if (bar) {
    bar.classList.remove('unavailable');
    bar.style.transform = `scaleX(${Math.min(1, bits / 100_000_000)})`;
  }
}

function render(d) {
  setMetric('cpu-val', 'cpu-bar', num(d, 'CPU_Load'), 100, '%');
  setMetric('cpu-temp-val', 'cpu-temp-bar', num(d, 'CPU_Temperature'), 100, '°C');

  document.querySelectorAll('.core-node').forEach((node, i) => {
    if (i >= 8) return;
    const v = num(d, `CPU_Core_${i}_Load`);
    const fill = node.querySelector('.core-node-fill');
    const label = node.querySelector('.core-load-val');
    if (fill) fill.style.transform = `scaleX(${v === null ? 0 : Math.min(1, v / 100)})`;
    if (label) label.textContent = v === null ? 'N/A' : `${Math.round(v)}%`;
  });

  setMetric('ram-val', 'ram-bar', num(d, 'Memory_Usage'), num(d, 'Memory_Total'), ' GB');
  setMetric('ram-freq-val', 'ram-freq-bar', num(d, 'Memory_Frequency'), 8000, ' MHz', 0);

  setMetric('ssd-space-val', 'ssd-space-bar', num(d, 'Storage_Free_Space'), num(d, 'Storage_Total_Space'), ' GB');
  setMetric('ssd-temp-val', 'ssd-temp-bar', num(d, 'Storage_Temperature'), 70, '°C');

  setNetwork(num(d, 'Network_Speed_Bps'));

  setMetric('gpu-vram-val', 'gpu-vram-bar', num(d, 'GPU_VRAM_Usage'), num(d, 'GPU_VRAM_Total'), ' GB');
  setMetric('gpu-compute-val', 'gpu-compute-bar', num(d, 'GPU_Compute_Load'), 100, '%');
  setMetric('gpu-temp-val', 'gpu-temp-bar', num(d, 'GPU_Temperature'), 90, '°C');
}

function showUnavailable(reason) {
  render({});
  publish({}, true);
  if (notchMeta && reason) notchMeta.textContent = reason;
  if (reason) reportService('sensors', 'error', 'no reading from LibreHardwareMonitor (port 8085)');
}

export async function initTelemetry() {
  showUnavailable(''); // N/A until the first real reading arrives
  const started = Date.now();

  // Watchdog: the Rust side only emits while the sensor source answers.
  setInterval(() => {
    const quiet = sawData ? Date.now() - lastUpdate > STALE_MS : Date.now() - started > INITIAL_GRACE_MS;
    if (quiet) showUnavailable('Sensors offline');
  }, 1000);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    invoke('start_telemetry').catch((e) => console.warn('[jarvis] telemetry failed to start:', e));
    listen('telemetry-update', (e) => {
      sawData = true;
      lastUpdate = Date.now();
      if (notchMeta && notchMeta.textContent === 'Sensors offline') notchMeta.textContent = '';
      render(e.payload ?? {});
      publish(e.payload ?? {}, false);
      reportService('sensors', 'ok', 'readings arriving');
    });
  } catch (e) {
    console.warn('[jarvis] Tauri API not available:', e);
  }
}
