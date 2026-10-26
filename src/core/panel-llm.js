// The LLM tab: which model, how fast it writes, what it takes in video memory and RAM, and how full its context window is.
import { getTelemetry, onTelemetry } from './telemetry-view.js';
import { getModelHealth, onModelHealth } from './model-panel.js';
import { getPreset } from './llm-client.js';
import { serverMode, state, onLink } from './server-link.js';
import { summary, onReplies, clearReplies } from './reply-stats.js';
import { prettyModelName } from './model-name.js';
import { $, row, meter, note, fill, fmtK, onTabPaint } from './panel-ui.js';

const num = (d, k) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null);

function paint() {
  const server = serverMode();
  const m = state.health?.model;
  const live = getModelHealth();
  const id = server ? m?.modelId : getPreset().model;
  const present = server ? !!m?.modelPresent : live.ctxMax != null || live.tps != null;
  $('llm-name').textContent = id ? prettyModelName(id) : 'No model';
  $('llm-dot').dataset.state = present ? 'ok' : 'idle';
  const gb = m?.sizeBytes ? `${(m.sizeBytes / 1e9).toFixed(1)} GB on disk` : null;
  $('llm-sub').textContent = [present ? 'loaded' : server && m?.reachable === false ? 'not reachable' : 'not loaded', live.ctxMax ? `${fmtK(live.ctxMax)} window` : null, gb].filter(Boolean).join('  ·  ');

  // speed: the last reply, then the session
  const s = summary();
  const last = state.health?.last;
  const tps = s.speeds.at(-1) ?? (server ? (last?.tokensPerSec ?? null) : live.tps);
  $('llm-tps').textContent = tps == null ? '--' : Number(tps).toFixed(1);
  const n = (x) => (x == null ? '--' : `${x.toFixed(1)} tok/s`);
  fill('llm-speed-rows', s.count ? [row('Average this session', n(s.avg)), row('Fastest', n(s.best)), row('Slowest', n(s.worst)), row('Replies', String(s.count))] : [note('The speed of each reply shows here.')]);
  sparkline(s.speeds.slice(-40));

  // memory: the card's video memory and what the model server holds in RAM (the card and the RAM come from the sensors)
  const { data: d, offline } = getTelemetry();
  const t = offline ? {} : d;
  const vram = num(t, 'GPU_VRAM_Usage');
  const vramTotal = num(t, 'GPU_VRAM_Total');
  const modelRam = num(t, 'Model_RAM');
  const ramTotal = num(t, 'Memory_Total');
  $('llm-meters').replaceChildren(
    meter('Video memory (whole card)', vram == null ? '' : `${vram.toFixed(1)} of ${vramTotal ? vramTotal.toFixed(1) : '--'} GB`, vram == null || !vramTotal ? null : vram / vramTotal),
    meter('Held in RAM by the model', modelRam == null ? '' : `${modelRam.toFixed(1)} of ${ramTotal ? Math.round(ramTotal) : '--'} GB`, modelRam == null || !ramTotal ? null : modelRam / ramTotal, { level: '' }),
  );

  // context: tokens of the window used by the conversation so far
  const used = live.ctxUsed;
  const max = live.ctxMax;
  const lines = [...document.querySelectorAll('#chat-output .chat-line')];
  const mine = lines.filter((l) => l.classList.contains('user')).length;
  $('llm-ctx').replaceChildren(
    meter('Tokens in the window', used == null || !max ? '' : `${fmtK(used)} of ${fmtK(max)}  (${Math.round((used / max) * 100)}%)`, used == null || !max ? null : used / max),
    Object.assign(document.createElement('div'), { className: 'info-note', textContent: `${mine} message${mine === 1 ? '' : 's'} sent in this chat.` }),
  );

  // how the model is set up (what the server sends with every request)
  const set = m?.settings;
  fill('env-model', server && set ? [row('Thinking', set.thinking ? 'on' : 'off'), row('Temperature', set.temperature == null ? '--' : String(set.temperature)), row('Speculative decoding', set.mtp ? 'MTP on' : 'off'), row('Waiting requests', String(state.health?.queueDepth ?? 0))] : [note('Shown when the JARVIS server is on.')]);
}

function sparkline(v) {
  const box = $('env-spark');
  if (!box) return;
  if (v.length < 2) { box.replaceChildren(); return; }
  const max = Math.max(...v) * 1.1, min = Math.min(...v) * 0.9;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * 120).toFixed(1)},${(36 - ((x - min) / (max - min || 1)) * 32).toFixed(1)}`).join(' ');
  box.innerHTML = `<svg viewBox="0 0 120 40" preserveAspectRatio="none" role="img" aria-label="Speed of the last ${v.length} replies"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

$('env-reset').addEventListener('click', clearReplies);
const tab = onTabPaint('llm', paint);
onLink(tab.poke);
onModelHealth(tab.poke);
onReplies(tab.poke);
onTelemetry(tab.poke);
new MutationObserver(tab.poke).observe($('chat-output'), { childList: true });
