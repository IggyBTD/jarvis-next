// LibreHardwareMonitor data.json -> flat metrics. Same keys as the original Rust mapping (src-tauri/src/telemetry.rs), so the
// HUD's telemetry view and the server's telemetry stream stay compatible. Sensor ids are stable across languages; labels are not.
const parseNum = (s) => {
  const t = String(s ?? '').trim();
  for (const unit of ['%', '°C', ' GB', ' MB', ' MHz', ' W', ' V', ' Hz', ' ns']) if (t.endsWith(unit)) { const n = Number(t.slice(0, -unit.length).trim()); return Number.isFinite(n) ? n : null; }
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? n : null;
};
const parseBps = (v) => { const m = String(v ?? '').trim().match(/^([\d.]+) B\/s$/); return m ? Number(m[1]) : null; };
const gb = (raw, v) => (String(raw).toLowerCase().includes('mb') ? v / 1024 : v);

function collect(node, p) {
  const t = String(node.Text ?? '').toLowerCase();
  if (node.Value != null) {
    const val = parseNum(node.Value) ?? 0;
    const id = node.SensorId ?? '';
    const setIfAbsent = (k) => { if (!(k in p)) p[k] = val; };
    if (t === 'cpu total') p.CPU_Load = val;
    else if (t === 'core (tctl/tdie)') p.CPU_Temperature = val;
    else if (t === 'memory used' && id.startsWith('/ram/')) p.Memory_Usage = val;
    else if (t === 'memory available' && id.startsWith('/ram/')) p.Memory_Available = val;
    const core = t.match(/^cpu core #(\d+)$/);
    if (core && Number(core[1]) >= 1) p[`CPU_Core_${Number(core[1]) - 1}_Load`] = val;
    if (id.includes('/memory/') && id.includes('/clock/') && t.includes('clock')) setIfAbsent('Memory_Frequency');
    if (id.startsWith('/nvme/')) {
      if (t === 'free space') p.Storage_Free_Space = val;
      else if (t === 'total space') p.Storage_Total_Space = val;
      else if (t === 'composite temperature') p.Storage_Temperature = val;
    } else if (id.startsWith('/ssd/')) {
      if (t === 'free space') setIfAbsent('Storage_Free_Space');
      else if (t === 'total space') setIfAbsent('Storage_Total_Space');
      else if (t === 'temperature') setIfAbsent('Storage_Temperature');
    }
    if (id.startsWith('/gpu-')) {
      if (t === 'gpu memory used') p.GPU_VRAM_Usage = gb(node.Value, val);
      else if (t === 'gpu memory total') p.GPU_VRAM_Total = gb(node.Value, val);
      else if (t === 'gpu core' && id.includes('/load/')) p.GPU_Compute_Load = val;
      else if (t === 'd3d compute 0' || t === 'd3d compute 1') setIfAbsent('GPU_Compute_Load');
      else if (t === 'gpu core' && id.includes('/temperature/')) p.GPU_Temperature = val;
    }
    if (id.startsWith('/nic/')) {
      const bps = parseBps(node.RawValue) ?? 0;
      const key = t === 'upload speed' ? 'Network_Upload_Bps' : t === 'download speed' ? 'Network_Download_Bps' : null;
      if (key && bps > (p[key] ?? 0)) p[key] = bps;
    }
  }
  for (const c of node.Children ?? []) collect(c, p);
}

export function parseLhm(root) {
  const p = {};
  collect(root, p);
  p.Network_Speed_Bps = (p.Network_Upload_Bps ?? 0) + (p.Network_Download_Bps ?? 0);
  const total = (p.Memory_Usage ?? 0) + (p.Memory_Available ?? 0);
  if (total > 0) p.Memory_Total = total;
  return p;
}
