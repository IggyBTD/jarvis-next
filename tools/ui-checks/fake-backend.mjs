// Stand-in LM Studio and telemetry for looking at the UI in a plain browser. Nothing leaves the page, so
// the real LM Studio is never asked to load or run anything. Use from a test page with:
//   await (await import('/tools/ui-checks/fake-backend.mjs')).install({ chat: true });
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });

const CHART = [
  'Peak was 48% at 15 s ago, average 28%.',
  '',
  '<jarvis-artifact id="cpu-load" type="chart" title="CPU load">',
  JSON.stringify({
    type: 'line',
    data: { labels: ['60s', '48s', '36s', '24s', '12s', 'now'], datasets: [{ label: 'CPU %', data: [12, 18, 35, 22, 48, 30], borderColor: '#2B8FBF', fill: true }] },
    options: { scales: { y: { min: 0, max: 100 } } },
  }),
  '</jarvis-artifact>',
].join('\n');

export async function install({ chat = true, telemetry = true } = {}) {
  window.__TAURI_INTERNALS__ = { transformCallback: (cb) => { window.__cbs = (window.__cbs || []).concat(cb); return window.__cbs.length; }, invoke: async (cmd, a) => {
    const db = (window.__sessions ||= new Map());
    if (cmd === 'session_save') db.set(a.id, { meta: JSON.parse(a.meta), history: a.history });
    else if (cmd === 'session_list') return [...db.values()].map((v) => v.meta);
    else if (cmd === 'session_load') return db.get(a.id).history;
    else if (cmd === 'session_delete') db.delete(a.id);
    else if (cmd === 'session_export') return `C:/fake/${a.id}.md`;
    else return 1;
    return null;
  }, unregisterCallback() {} };
  if (telemetry) {
    const urls = [...new Set(performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('telemetry-view.js')))];
    for (const u of urls) { const m = await import(u); await m.initTelemetry(); }
    let t = 0;
    window.__fake = setInterval(() => {
      t += 1;
      const payload = { CPU_Load: 28 + 18 * Math.sin(t / 4), CPU_Temperature: 54, CPU_Core_0_Load: 40, CPU_Core_1_Load: 12, CPU_Core_2_Load: 88, CPU_Core_3_Load: 5, CPU_Core_4_Load: 33, CPU_Core_5_Load: 61, CPU_Core_6_Load: 9, CPU_Core_7_Load: 24, Memory_Usage: 19.4, Memory_Total: 32, Memory_Frequency: 6000, Storage_Free_Space: 410, Storage_Total_Space: 1000, Storage_Temperature: 41, Network_Speed_Bps: 1200000, GPU_VRAM_Usage: 9.8, GPU_VRAM_Total: 16, GPU_Compute_Load: 50 + 30 * Math.sin(t / 3), GPU_Temperature: 58 };
      window.__cbs.forEach((cb) => { try { cb({ event: 'telemetry-update', id: 1, payload }); } catch { /* ignore */ } });
    }, 250);
  }
  if (chat) {
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (!u.includes(':1234')) return real(url, opts);
      if (u.endsWith('/api/v1/models') && !opts) return json({ models: [{ key: 'qwen/qwen3-14b', type: 'llm', display_name: 'Qwen3 14B', size_bytes: 1.2e10, params_string: '14B', quantization: { name: 'Q6_K' }, max_context_length: 32768, loaded_instances: [{ id: 'qwen/qwen3-14b', config: { context_length: 32768 } }] }] });
      if (u.endsWith('/chat/completions')) {
        const msgs = JSON.parse(opts.body).messages;
        const last = String(msgs.at(-1).content);
        const titled = /<chat-title>/.test(String(msgs[0].content)) ? '<jarvis-title>Plain talk about CPUs</jarvis-title>' : '';
        const enc = new TextEncoder();
        return new Response(new ReadableStream({
          async start(c) {
            const send = (d) => c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`));
            if (/Name this conversation/.test(last)) { send({ content: '"Peak CPU load chart."' }); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); return; }
            if (/still fit/.test(last)) { send({ content: 'KEEP' }); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); return; }
            if (/plain/i.test(last)) { send({ content: titled.slice(0, 20) }); send({ content: `${titled.slice(20)}A plain answer.` }); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); return; }
            if (/chart/i.test(last)) { send({ content: CHART }); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); return; }
            await new Promise((r) => setTimeout(r, 60000)); // stays "thinking"
            c.close();
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return real(url, opts);
    };
  }
  window.__say = async (text, wait = 2500) => {
    const i = document.getElementById('hud-chat-input');
    i.focus(); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('send-btn').click();
    await new Promise((r) => setTimeout(r, wait));
  };
  return 'installed';
}
