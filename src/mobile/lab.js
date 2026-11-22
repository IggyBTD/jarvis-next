// TEMPORARY: tries ways to stop iOS 26 fading the top of the page under the status bar, one after another. Whoever watches says which
// test removed the blur on the top buttons. Each test undoes itself before the next. Remove once found.
const $ = (id) => document.getElementById(id);
const layers = () => [$('m-app'), $('m-sheets'), document.querySelector('.m-drawer')].filter(Boolean);
const bar = document.querySelector('.m-bar');
const note = Object.assign(document.createElement('div'), { id: 'lab-note' });
note.style.cssText = 'position:fixed;left:12px;right:12px;top:42%;z-index:99999;padding:12px;background:rgba(0,0,0,.85);color:#fff;font:600 17px/1.3 sans-serif;pointer-events:none;border:2px solid #e00';
document.body.append(note);

const meta = (name) => document.querySelector(`meta[name="${name}"]`);
const setMeta = (name, value) => { const m = meta(name); if (!m) return () => {}; const old = m.content; m.content = value; return () => { m.content = old; }; };
const dropMeta = (name) => { const m = meta(name); if (!m) return () => {}; const parent = m.parentNode; m.remove(); return () => parent.append(m); };
const tests = [
  ['status bar style: black', () => setMeta('apple-mobile-web-app-status-bar-style', 'black')],
  ['status bar style: default', () => setMeta('apple-mobile-web-app-status-bar-style', 'default')],
  ['theme-color: pure black', () => setMeta('theme-color', '#000000')],
  ['theme-color tag removed', () => dropMeta('theme-color')],
  ['color-scheme tag removed', () => dropMeta('color-scheme')],
];

let i = 0; let undo = () => {};
const next = () => {
  undo(); undo = () => {};
  if (i >= tests.length) { note.textContent = 'Done. Tell Claude which test removed the blur on the top buttons (the menu button and the new chat button). If none, say none.'; setTimeout(() => note.remove(), 20000); return; }
  const [name, run] = tests[i];
  note.textContent = `Test ${i + 1} of ${tests.length}: ${name}. Look at the top buttons: did the blur change?`;
  try { undo = run(); } catch (e) { note.textContent += ` (error: ${e.message})`; }
  i += 1;
  setTimeout(next, 6000);
};
setTimeout(next, 2500);
