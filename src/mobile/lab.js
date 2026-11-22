// TEMPORARY: tries ways to stop iOS 26 fading the top of the page under the status bar, one after another. Whoever watches says which
// test removed the blur on the top buttons. Each test undoes itself before the next. Remove once found.
const $ = (id) => document.getElementById(id);
const layers = () => [$('m-app'), $('m-sheets'), document.querySelector('.m-drawer')].filter(Boolean);
const bar = document.querySelector('.m-bar');
const note = Object.assign(document.createElement('div'), { id: 'lab-note' });
note.style.cssText = 'position:fixed;left:12px;right:12px;top:42%;z-index:99999;padding:12px;background:rgba(0,0,0,.85);color:#fff;font:600 17px/1.3 sans-serif;pointer-events:none;border:2px solid #e00';
document.body.append(note);

const setStyle = (nodes, css) => { const saved = nodes.map((n) => n.style.cssText); nodes.forEach((n) => { n.style.cssText += `;${css}`; }); return () => nodes.forEach((n, i) => { n.style.cssText = saved[i]; }); };
const tests = [
  ['baseline: nothing changed', () => () => {}],
  ['app layers start 2 px below the top edge', () => setStyle(layers(), 'top:2px !important')],
  ['app layers start 8 px below the top edge', () => setStyle(layers(), 'top:8px !important')],
  ['app is position absolute, not fixed', () => setStyle([$('m-app')], 'position:absolute !important;top:0 !important;height:100lvh !important')],
  ['top bar 12 px lower', () => setStyle([bar], 'padding-top:calc(env(safe-area-inset-top) + 12px) !important')],
];

let i = 0; let undo = () => {};
const next = () => {
  undo(); undo = () => {};
  if (i >= tests.length) { note.textContent = 'Done. Tell Claude which test removed the blur on the top buttons (the menu button and the new chat button). If none, say none.'; setTimeout(() => note.remove(), 20000); return; }
  const [name, run] = tests[i];
  note.textContent = `Test ${i + 1} of ${tests.length}: ${name}. Look at the top buttons: still blurred at the top?`;
  try { undo = run(); } catch (e) { note.textContent += ` (error: ${e.message})`; }
  i += 1;
  setTimeout(next, 6000);
};
setTimeout(next, 2500);
