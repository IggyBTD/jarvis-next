// What the nodes design adds on top of the shared modules: the starter prompts on an empty chat, the live CPU / GPU / RAM
// readout at the foot of the sidebar, and the interface switch (Nodes or Classic). The node mesh, the reply stamp and the
// rest of the page are the shared modules' own (node-mesh.js in kit mode, chat-ui.js, shell.js).
import { getSwitches, onSwitchChange } from '../core/switches.js';
import { getTelemetry, onTelemetry } from '../core/telemetry-view.js';

const $ = (id) => document.getElementById(id);
const input = $('hud-chat-input');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// --- starters: fill the message box, never send -------------------------------------------------
document.querySelectorAll('.starter').forEach((b) => b.addEventListener('click', () => {
  input.value = b.dataset.fill;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}));
const webStarter = document.querySelector('.starter[data-needs="web"]');
const paintStarters = () => { if (webStarter) webStarter.hidden = !getSwitches().internet; };
onSwitchChange(paintStarters);
paintStarters();

// --- live readout in the sidebar (bars turn teal above 75 % and red above 90 %, as everywhere else) ---
const level = (ratio) => (ratio > 0.9 ? 'high' : ratio > 0.75 ? 'mid' : '');
function mini(id, ratio, text) {
  const value = $(`mini-${id}`);
  const bar = $(`mini-${id}-bar`);
  if (!value || !bar) return;
  value.textContent = text;
  bar.style.transform = `scaleX(${ratio ?? 0})`;
  bar.dataset.level = ratio == null ? '' : level(ratio);
}
function paintMini() {
  const { data: d, offline } = getTelemetry();
  const n = (k) => (!offline && typeof d?.[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null);
  const cpu = n('CPU_Load');
  const gpu = n('GPU_Compute_Load');
  const ram = n('Memory_Usage');
  const ramTotal = n('Memory_Total');
  mini('cpu', cpu == null ? null : cpu / 100, cpu == null ? 'N/A' : `${Math.round(cpu)}%`);
  mini('gpu', gpu == null ? null : gpu / 100, gpu == null ? 'N/A' : `${Math.round(gpu)}%`);
  mini('ram', ram == null || !ramTotal ? null : ram / ramTotal, ram == null ? 'N/A' : `${ram.toFixed(1)} GB`);
}
onTelemetry(paintMini);
paintMini();

// --- interface switch --------------------------------------------------------------------------
document.querySelectorAll('[data-ui]').forEach((b) => b.addEventListener('click', () => {
  store.set('jarvis.ui', b.dataset.ui);
  if (b.dataset.ui === 'classic') location.href = './classic.html';
}));
