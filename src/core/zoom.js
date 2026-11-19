// App zoom: Ctrl + / Ctrl - / Ctrl 0 and Ctrl + wheel. 50% to 200% in 10% steps, kept between launches.
// The desktop app zooms the webview itself; a plain browser falls back to CSS zoom.
const KEY = 'jarvis.zoom';
const STEP = 0.1;
let level = 1;
try { level = Number(localStorage.getItem(KEY)) || 1; } catch { /* storage blocked */ }

async function apply() {
  level = Math.min(2, Math.max(0.5, Math.round(level * 10) / 10));
  try { localStorage.setItem(KEY, String(level)); } catch { /* storage blocked */ }
  if (window.__TAURI_INTERNALS__) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(level);
  } else document.documentElement.style.zoom = String(level);
  document.dispatchEvent(new CustomEvent('jarvis:zoom', { detail: { level } }));
}

export const zoomBy = (dir) => { level += dir * STEP; apply(); };
export const zoomReset = () => { level = 1; apply(); };
export const getZoom = () => level;
if (level !== 1) apply();
