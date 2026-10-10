// Model-health rows for the whiteboard's System panel. Pure: numbers in, display rows out.
//
// Rule (same as the HUD): a reading that is missing shows "N/A" with an empty bar, never a
// healthy-looking default. Before the first reply there is no speed or context to show yet; that
// is "--", not "N/A", because nothing is broken.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ratio = (v, max) => (v === null || max === null || max <= 0 ? null : Math.min(1, Math.max(0, v / max)));
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));

export const TEMP_MAX = 90; // bar full at 90 C, as on the HUD

// telemetry: the LibreHardwareMonitor payload ({} when unknown); offline: the sensor stream is
// silent; model: { tps, ctxUsed, ctxMax } from the last reply and the loaded model.
export function buildHealth({ telemetry = {}, offline = false, model = {} } = {}) {
  const t = offline ? {} : telemetry;
  const vram = num(t.GPU_VRAM_Usage);
  const vramMax = num(t.GPU_VRAM_Total);
  const load = num(t.GPU_Compute_Load);
  const temp = num(t.GPU_Temperature);
  const tps = num(model.tps);
  const used = num(model.ctxUsed);
  const max = num(model.ctxMax);

  return [
    {
      key: 'vram', label: 'GPU MEMORY', bar: true,
      text: vram === null ? 'N/A' : vramMax === null ? `${vram.toFixed(1)} GB` : `${vram.toFixed(1)} / ${vramMax.toFixed(0)} GB`,
      ratio: ratio(vram, vramMax),
    },
    { key: 'load', label: 'GPU LOAD', bar: true, text: load === null ? 'N/A' : `${load.toFixed(0)}%`, ratio: ratio(load, 100) },
    { key: 'temp', label: 'GPU TEMPERATURE', bar: true, text: temp === null ? 'N/A' : `${temp.toFixed(0)}°C`, ratio: ratio(temp, TEMP_MAX) },
    { key: 'speed', label: 'GENERATION', bar: false, text: tps === null ? '--' : `${tps.toFixed(1)} t/s`, ratio: null },
    {
      key: 'context', label: 'CONTEXT', bar: true,
      text: max === null ? '--' : `${used === null ? '--' : fmtK(used)} / ${fmtK(max)}`,
      ratio: ratio(used, max),
    },
  ];
}
