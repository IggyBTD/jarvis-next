// The PC tab: processor and graphics card temperature and load, memory, and free space on the drive. The numbers are the active
// computer's (the PC's from LibreHardwareMonitor and the server's own basic readings, the Mac's from its agent).
import { getTelemetry, onTelemetry } from './telemetry-view.js';
import { serverMode, state } from './server-link.js';
import { $, meter, levelOf, onTabPaint } from './panel-ui.js';

const num = (d, k) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null);

function paint() {
  const { data: d, offline } = getTelemetry();
  const v = offline ? {} : d;
  const label = serverMode() ? (state.machines?.[state.target]?.label ?? state.target.toUpperCase()) : 'This PC';
  $('pc-title').textContent = label;
  $('pc-sub').textContent = offline ? 'no readings' : '';
  const cpuTemp = num(v, 'CPU_Temperature');
  const gpuTemp = num(v, 'GPU_Temperature');
  const cpu = num(v, 'CPU_Load');
  const gpu = num(v, 'GPU_Compute_Load');
  const ram = num(v, 'Memory_Usage');
  const ramTotal = num(v, 'Memory_Total');
  const free = num(v, 'Storage_Free_Space');
  const total = num(v, 'Storage_Total_Space');
  const usedRatio = free != null && total ? 1 - free / total : null;
  $('pc-meters').replaceChildren(
    meter('CPU temperature', cpuTemp == null ? '' : `${Math.round(cpuTemp)} °C`, cpuTemp == null ? null : cpuTemp / 100),
    meter('GPU temperature', gpuTemp == null ? '' : `${Math.round(gpuTemp)} °C`, gpuTemp == null ? null : gpuTemp / 90),
    meter('CPU usage', cpu == null ? '' : `${Math.round(cpu)}%`, cpu == null ? null : cpu / 100),
    meter('GPU compute usage', gpu == null ? '' : `${Math.round(gpu)}%`, gpu == null ? null : gpu / 100),
    meter('RAM usage', ram == null ? '' : `${ram.toFixed(1)} of ${ramTotal ? Math.round(ramTotal) : '--'} GB`, ram == null || !ramTotal ? null : ram / ramTotal),
    meter('SSD space', free == null ? '' : `${Math.round(free)} GB free of ${total >= 1000 ? `${(total / 1000).toFixed(1)} TB` : `${Math.round(total)} GB`}`, usedRatio, { level: usedRatio == null ? '' : levelOf(usedRatio) }),
  );
  const hint = $('pc-hint');
  const basic = !offline && v.Sensors_Basic === 1;
  hint.hidden = !(basic || offline);
  hint.textContent = offline ? 'The sensors are not answering.' : 'The temperatures and the graphics card need LibreHardwareMonitor, with its web server on (port 8085). Processor, memory and disk are read without it.';
}

const tab = onTabPaint('pc', paint);
onTelemetry(tab.poke);
document.addEventListener('jarvis:page', tab.poke);
