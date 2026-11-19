// Bottom-right panel: one card per model currently loaded in LM Studio.
import { listModels, onEvent, getPreset } from './llm-client.js';
import { getSwitches, onSwitchChange } from './switches.js';
import { reportService } from './service-status.js';

const body = document.getElementById('model-info-body');
const tag = document.getElementById('model-info-tag');

const lastStats = new Map(); // model key -> stats from its most recent reply
let loaded = [];             // [{ model, instance }]
let phase = null;            // { phase, model } while a swap is in flight
let unreachable = false;     // LM Studio did not answer the last poll

const dash = '--';
const fmt = (n, digits = 1) => (n == null || !Number.isFinite(n) ? dash : n.toFixed(digits));
const fmtK = (n) => (n == null ? dash : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const fmtTtl = (s) => (s == null ? 'none' : s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.max(1, Math.round(s / 60))}m`);

function statCell(label, value) {
  const el = document.createElement('div');
  el.className = 'model-stat';
  const l = document.createElement('span');
  l.className = 'model-stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'model-stat-value mono-data';
  v.textContent = value;
  el.append(l, v);
  return el;
}

// For the whiteboard's System panel: speed of the last reply and context use of the model that
// belongs to the active preset (or the first loaded one).
const healthListeners = new Set();
export function onModelHealth(cb) {
  healthListeners.add(cb);
  return () => healthListeners.delete(cb);
}
export function getModelHealth() {
  const entry = loaded.find((l) => l.model.key === getPreset().model) ?? loaded[0];
  if (!entry) return {};
  const stats = lastStats.get(entry.model.key);
  return {
    tps: stats?.tps ?? null,
    ctxUsed: stats && stats.promptTokens != null ? stats.promptTokens + (stats.completionTokens ?? 0) : null,
    ctxMax: entry.instance.config?.context_length ?? entry.model.max_context_length ?? null,
  };
}

function modelCard({ model, instance }) {
  const stats = lastStats.get(model.key);
  const ctxMax = instance.config?.context_length ?? model.max_context_length;
  const ctxUsed = stats && stats.promptTokens != null
    ? stats.promptTokens + (stats.completionTokens ?? 0)
    : null;

  const card = document.createElement('div');
  card.className = 'model-card';

  const head = document.createElement('div');
  head.className = 'model-card-head';
  const name = document.createElement('span');
  name.className = 'model-name';
  name.textContent = model.display_name || model.key;
  const quant = document.createElement('span');
  quant.className = 'quant-pill';
  quant.textContent = model.quantization?.name ?? '?';
  head.append(name, quant);

  const grid = document.createElement('div');
  grid.className = 'model-stat-grid';
  grid.append(
    statCell('Prompt speed', stats ? `${fmt(stats.promptTps, 0)} t/s` : dash),
    statCell('Generation', stats ? `${fmt(stats.tps)} t/s` : dash),
    statCell('First token', stats ? `${fmt(stats.ttft, 2)} s` : dash),
    statCell('Context', `${fmtK(ctxUsed)} / ${fmtK(ctxMax)}`),
    statCell('Tokens out', stats ? fmtK(stats.completionTokens) : dash),
    statCell('Size', Number.isFinite(model.size_bytes) ? `${(model.size_bytes / 1e9).toFixed(1)} GB` : dash),
    statCell('Parameters', model.params_string ?? dash),
    statCell('Unloads in', fmtTtl(instance.remaining_ttl_seconds)),
  );
  card.append(head, grid);
  return card;
}

function render() {
  tag.textContent = phase && phase.phase !== 'idle'
    ? `${phase.phase}...`
    : unreachable ? 'offline' : `${loaded.length} loaded`;
  body.replaceChildren();
  if (phase && phase.phase !== 'idle') {
    const note = document.createElement('div');
    note.className = 'model-note';
    note.textContent = `${phase.phase} ${phase.model}`;
    body.append(note);
  }
  if (!loaded.length && !(phase && phase.phase !== 'idle')) {
    const none = document.createElement('div');
    none.className = 'model-note';
    none.textContent = !getSwitches().link ? 'Network link cut' : unreachable ? 'LM Studio is not reachable' : 'No model loaded';
    body.append(none);
  }
  loaded.forEach((entry) => body.append(modelCard(entry)));
  healthListeners.forEach((cb) => cb());
}

async function refresh() {
  try {
    const models = await listModels();
    loaded = models
      .filter((m) => m.type === 'llm')
      .flatMap((m) => m.loaded_instances.map((instance) => ({ model: m, instance })));
    unreachable = false;
    reportService('lmstudio', 'ok', `reachable, ${loaded.length} loaded`);
  } catch {
    loaded = [];
    unreachable = true;
    if (getSwitches().link) reportService('lmstudio', 'error', 'no answer on its port (is it serving, with CORS on?)');
    else reportService('lmstudio', 'idle', 'network link cut');
  }
  render();
}

onEvent((e) => {
  if (e.type === 'stats') lastStats.set(e.model, e.stats);
  if (e.type === 'phase') phase = e;
  render();
  if (e.type === 'phase' || e.type === 'stats') refresh();
});

onSwitchChange(() => refresh());
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 3000);
