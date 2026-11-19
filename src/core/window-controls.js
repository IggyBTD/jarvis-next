// Custom title-bar buttons (the native frame is off: decorations=false in tauri.conf.json).
// Outside Tauri (plain browser during development) the buttons simply do nothing.
const minBtn = document.getElementById('win-min');
const maxBtn = document.getElementById('win-max');
const closeBtn = document.getElementById('win-close');

async function appWindow() {
  if (!window.__TAURI_INTERNALS__) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

async function syncMaximized() {
  const win = await appWindow();
  if (!win) return;
  const maximized = await win.isMaximized();
  maxBtn.classList.toggle('is-maximized', maximized);
  maxBtn.title = maximized ? 'Restore' : 'Maximize';
  maxBtn.setAttribute('aria-label', maxBtn.title);
}

async function run(action) {
  try {
    const win = await appWindow();
    if (win) await action(win);
  } catch (e) {
    console.warn('[jarvis] window control failed:', e);
  }
}

minBtn.addEventListener('click', () => run((w) => w.minimize()));
maxBtn.addEventListener('click', () => run(async (w) => { await w.toggleMaximize(); await syncMaximized(); }));
closeBtn.addEventListener('click', () => run((w) => w.close()));

// Double-clicking the drag region maximizes in Tauri; the window also changes size from the
// keyboard (Win+Up) or snapping, so re-sync the icon whenever the window is resized.
// Belt and braces: the config already turns the native title bar off; this makes sure of it for any window it did not reach.
appWindow().then((win) => { win?.setDecorations(false).catch(() => {}); win?.onResized(syncMaximized); syncMaximized(); });
