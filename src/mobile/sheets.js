// Bottom sheets, the iPhone way to show anything secondary: they slide up on the iOS drawer curve, have a grabber and a close button, close with a
// swipe down or a tap outside, and the Back swipe in Safari closes the sheet instead of leaving the page. A sheet that must be answered
// (an approval) has no close button, no swipe and no tap-outside: it ends with its own buttons.
// Only transform and opacity move. With Reduce Motion a sheet fades.
import { hydrateIcons } from '../icons/index.js';

const host = document.getElementById('m-sheets');
const app = document.getElementById('m-app');
const stack = [];            // open sheets, the top one last
let ignorePops = 0;          // popstate events caused by our own history.back()
const calm = matchMedia('(prefers-reduced-motion: reduce)');

const focusable = (root) => root.querySelector('button:not([disabled]), input, textarea, select, [tabindex="0"]');

export function openSheet({ title = '', content, footer = null, dismissible = true, left = null, onClose = null, label = title }) {
  const root = document.createElement('div');
  root.className = 'm-sheet';
  root.innerHTML = '<div class="m-scrim"></div><section class="m-panel" role="dialog" aria-modal="true" tabindex="-1">'
    + '<div class="m-grab" aria-hidden="true"></div>'
    + '<header class="m-sheet-head"><span class="m-sheet-side m-sheet-left"></span><h2 class="m-sheet-title"></h2><span class="m-sheet-side m-sheet-right"></span></header>'
    + '<div class="m-sheet-body"></div><footer class="m-sheet-foot" hidden></footer></section>';
  const panel = root.querySelector('.m-panel');
  const scrim = root.querySelector('.m-scrim');
  const body = root.querySelector('.m-sheet-body');
  const foot = root.querySelector('.m-sheet-foot');
  panel.setAttribute('aria-label', label || 'Sheet');
  root.querySelector('.m-sheet-title').textContent = title;
  if (!dismissible) root.classList.add('modal');
  if (left) root.querySelector('.m-sheet-left').append(left);
  if (dismissible) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'm-icon-btn';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<span class="icon" data-icon="close" aria-hidden="true"></span>';
    x.addEventListener('click', () => sheet.close());
    root.querySelector('.m-sheet-right').append(x);
  }
  if (content) body.append(content);
  if (footer) { foot.hidden = false; foot.append(footer); }
  hydrateIcons(root);

  let closed = false;
  const below = stack.at(-1);
  const opener = document.activeElement;
  const sheet = {
    root, body, panel, dismissible,
    setTitle(t) { root.querySelector('.m-sheet-title').textContent = t; },
    close({ fromPop = false } = {}) {
      if (closed) return;
      closed = true;
      stack.splice(stack.indexOf(sheet), 1);
      if (!fromPop) { ignorePops += 1; history.back(); } // takes back the entry this sheet added
      if (below) below.root.inert = false; else app.inert = false;
      root.classList.add('closing');
      root.classList.remove('open');
      const gone = () => { root.remove(); try { opener?.focus?.({ preventScroll: true }); } catch { /* the opener is gone */ } onClose?.(); };
      if (calm.matches) gone(); else setTimeout(gone, 230); // the exit is shorter than the entrance (220 ms in the CSS)
    },
  };

  if (below) below.root.inert = true; else app.inert = true;
  stack.push(sheet);
  history.pushState({ sheet: stack.length }, '');
  host.append(root);
  void root.offsetHeight; // the closed position is painted once, so the entrance has a start
  root.classList.add('open');
  (focusable(panel) ?? panel).focus({ preventScroll: true });

  if (dismissible) {
    scrim.addEventListener('click', () => sheet.close());
    // swipe down from the grabber or the header: a quick flick or a pull past a third of the way closes it
    const grip = [root.querySelector('.m-grab'), root.querySelector('.m-sheet-head')];
    let drag = null;
    for (const g of grip) {
      g.addEventListener('pointerdown', (e) => { if (e.target.closest('button, input')) return; drag = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId }; g.setPointerCapture(e.pointerId); panel.style.transition = 'none'; });
      g.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag.dy = Math.max(0, e.clientY - drag.y);
        panel.style.transform = `translateY(${drag.dy}px)`;
        scrim.style.opacity = String(Math.max(0, 1 - drag.dy / panel.offsetHeight));
      });
      const up = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const speed = drag.dy / Math.max(1, performance.now() - drag.t);
        const far = drag.dy > panel.offsetHeight / 3;
        const flick = drag.dy > 24 && speed > 0.11;
        panel.style.transition = '';
        scrim.style.opacity = '';
        if (far || flick) { panel.style.transform = ''; sheet.close(); } else panel.style.transform = '';
        drag = null;
      };
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    }
  }
  return sheet;
}

export const sheetOpen = () => stack.length > 0;

window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops -= 1; return; }
  const top = stack.at(-1);
  if (!top) return;
  if (top.dismissible) top.close({ fromPop: true });
  else history.pushState({ sheet: stack.length }, ''); // a sheet that must be answered stays
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.at(-1)?.dismissible) stack.at(-1).close(); });
