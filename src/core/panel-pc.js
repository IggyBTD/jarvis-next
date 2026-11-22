// The PC card: processor and graphics card temperature and load, and the graphics card's memory (VRAM). The numbers are the active
// computer's (the PC's from LibreHardwareMonitor and the server's own basic readings, the Mac's from its agent).
import { getTelemetry, onTelemetry } from './telemetry-view.js';
import { serverMode, state } from './server-link.js';
import { $, meter, onTabPaint } from './panel-ui.js';

const num = (d, k) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null);

function paint() {
  const { data: d, offline } = getTelemetry();
  const v = offline ? {} : d;
  const label = serverMode() ? (state.machines?.[state.target]?.label ?? state.target.toUpperCase()) : 'This PC';
  $('pc-title').textContent = label;
  const cpuTemp = num(v, 'CPU_Temperature');
  const gpuTemp = num(v, 'GPU_Temperature');
  const cpu = num(v, 'CPU_Load');
  const vram = num(v, 'GPU_VRAM_Usage');
  const vramTotal = num(v, 'GPU_VRAM_Total');
  const vramOk = vram != null && vramTotal != null && vramTotal > 0;
  const gpu = num(v, 'GPU_Compute_Load');
  $('pc-sub').textContent = `GPU: ${gpuTemp == null ? '--' : Math.round(gpuTemp)}°C  CPU: ${cpuTemp == null ? '--' : Math.round(cpuTemp)}°C`;
  $('pc-meters').replaceChildren(
    meter('GPU temp', gpuTemp == null ? '' : `${Math.round(gpuTemp)} °C`, gpuTemp == null ? null : gpuTemp / 90),
    meter('CPU temp', cpuTemp == null ? '' : `${Math.round(cpuTemp)} °C`, cpuTemp == null ? null : cpuTemp / 100),
    meter('GPU compute load', gpu == null ? '' : `${Math.round(gpu)}%`, gpu == null ? null : gpu / 100),
    meter('GPU VRAM', vramOk ? `${vram.toFixed(1)} / ${vramTotal.toFixed(vramTotal % 1 ? 1 : 0)} GB` : '', vramOk ? vram / vramTotal : null),
    meter('CPU compute load', cpu == null ? '' : `${Math.round(cpu)}%`, cpu == null ? null : cpu / 100),
  );
  const hint = $('pc-hint');
  const basic = !offline && v.Sensors_Basic === 1;
  hint.hidden = !(basic || offline);
  hint.textContent = offline ? 'The sensors are not answering.' : 'The temperatures and the graphics card need LibreHardwareMonitor, with its web server on (port 8085). Processor, memory and disk are read without it.';
}

const tab = onTabPaint('pc', paint);
onTelemetry(tab.poke);
document.addEventListener('jarvis:page', tab.poke);
