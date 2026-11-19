// Tauri stand-in for the audit: sessions, agent tools, telemetry events, window.
(() => {
  if (window !== window.top) return; // artifact frames are sandboxed: no storage, no Tauri
  const cbs = new Map(); let next = 1; const listeners = {};
  localStorage.setItem('jarvis.project', 'C:/Users/iggy/proj');
  const sessions = [['s1', 'Rugby conditioning plan'], ['s2', 'Options greeks cheat sheet with a very long title that should be cut'], ['s3', 'Rekordbox library tool'], ['s4', 'Leadagent pilot pricing']].map(([id, name], i) => ({ id, name, updated: Date.now() - i * 3600e3, created: 1 }));
  const files = ['src', 'src/main.js', 'src/core', 'package.json', 'README.md', 'tools'];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (fn) => { const id = next++; cbs.set(id, fn); return id; },
    unregisterCallback: () => {},
    invoke: async (cmd, a) => {
      if (cmd === 'plugin:event|listen') { (listeners[a.event] ||= []).push(a.handler); return a.handler; }
      if (cmd.startsWith('plugin:window|')) return cmd.endsWith('is_maximized') ? false : null;
      if (cmd.startsWith('plugin:')) return null;
      switch (cmd) {
        case 'session_list': return sessions;
        case 'session_search': return sessions.slice(0, 2).map((s) => ({ ...s, snippet: 'the delta of a call option is about 0.5 at the money' }));
        case 'agent_set_root': case 'agent_get_root': return 'C:/Users/iggy/proj';
        case 'agent_list_dir': return { path: '.', truncated: false, entries: files.map((p) => ({ path: p, kind: p.includes('.') ? 'file' : 'dir', size: 1234 })) };
        case 'agent_read_file': return { path: a.path, start: 1, end: 3, total: 3, truncated: false, content: '1\tconst a = 1;\n2\tconst b = 2;\n3\texport { a, b };' };
        case 'agent_edit_file': return { path: a.path, created: false, before: 'const a = 1;\nconst b = 2;\nexport { a, b };\n', after: 'const a = 1;\nconst b = 3;\nexport { a, b };\n', replacements: 1 };
        case 'agent_run_command': return { exit_code: 0, timed_out: false, truncated: false, output: 'ok 12 tests' };
        case 'agent_rules_read': return '{"allow":[],"ask":[],"deny":[]}';
        case 'memory_search': return { results: [] };
        case 'instinct_top': case 'skills_list': return [];
        default: return null;
      }
    },
  };
  const data = { CPU_Load: 34, GPU_Compute_Load: 81, Memory_Usage: 21.4, Memory_Total: 31.9, CPU_Temperature: 61, GPU_Temperature: 74, Storage_Temperature: 41, GPU_VRAM_Usage: 14.9, GPU_VRAM_Total: 16, Memory_Frequency: 6000, Storage_Free_Space: 412, Storage_Total_Space: 1000, Network_Speed_Bps: 12_500_000 };
  for (let i = 1; i <= 8; i++) data[`CPU_Core_${i}_Load`] = [12, 55, 91, 30, 8, 77, 44, 20][i - 1];
  setInterval(() => (listeners['telemetry-update'] || []).forEach((h) => cbs.get(h)?.({ event: 'telemetry-update', id: 1, payload: { ...data, CPU_Load: data.CPU_Load + Math.random() * 10 } })), 500);
})();
