// TEMPORARY: tries fixes for the page being cut off 59 pt above the bottom of a home-screen app on iOS 26, one after another, with a red bar at the
// bottom edge. Whoever watches says which test put the red bar at the very bottom. Remove once found.
const root = document.documentElement;
const metaOf = (name) => document.querySelector(`meta[name="${name}"]`);
const vp = metaOf('viewport');
const sb = metaOf('apple-mobile-web-app-status-bar-style');
const tc = metaOf('theme-color');
const COVER = 'width=device-width, initial-scale=1, viewport-fit=cover';

const bar = Object.assign(document.createElement('div'), { id: 'lab-bar' });
bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:40px;z-index:99999;background:#e00;pointer-events:none';
const note = Object.assign(document.createElement('div'), { id: 'lab-note' });
note.style.cssText = 'position:fixed;left:12px;right:12px;top:42%;z-index:99999;padding:12px;background:rgba(0,0,0,.85);color:#fff;font:600 17px/1.3 sans-serif;pointer-events:none;border:2px solid #e00';
document.body.append(bar, note);

const tests = [
  ['baseline: nothing changed', () => {}],
  ['viewport meta nudged (no cover, then cover)', () => { vp.content = 'width=device-width, initial-scale=1'; setTimeout(() => { vp.content = COVER; }, 400); }],
  ['scroll by one pixel and back, resize event', () => { root.style.height = '100.5lvh'; document.body.style.height = '100.5lvh'; scrollTo(0, 1); dispatchEvent(new Event('resize')); setTimeout(() => { scrollTo(0, 0); root.style.height = ''; document.body.style.height = ''; }, 400); }],
  ['html and body not position fixed, 100lvh tall', () => { for (const n of [root, document.body]) { n.style.position = 'relative'; n.style.inset = 'auto'; n.style.height = '100lvh'; } }],
  ['theme-color set to the page colour', () => { if (tc) tc.content = '#0b0f12'; }],
  ['status bar style set again (default, then black-translucent)', () => { if (sb) { sb.content = 'default'; setTimeout(() => { sb.content = 'black-translucent'; }, 400); } }],
  ['height: -webkit-fill-available on html and body', () => { for (const n of [root, document.body]) { n.style.height = '-webkit-fill-available'; n.style.minHeight = '-webkit-fill-available'; } }],
];

let i = 0;
const next = () => {
  if (i >= tests.length) { note.textContent = 'Done. Tell Claude the first test where the red bar was at the very bottom edge of the screen, and whether it stayed there. If none, say none.'; setTimeout(() => { note.remove(); bar.remove(); }, 20000); return; }
  const [name, run] = tests[i];
  note.textContent = `Test ${i + 1} of ${tests.length}: ${name}. Is the RED bar at the very bottom edge of the screen?`;
  try { run(); } catch (e) { note.textContent += ` (error: ${e.message})`; }
  i += 1;
  setTimeout(next, 5000);
};
setTimeout(next, 2500);
