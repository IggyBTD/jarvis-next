// Replaces the browser's own chrome with the app's: the right-click menu, tooltips, and the
// keyboard and mouse shortcuts that would open browser UI (find bar, print dialog, autoscroll).
// The CSS side (scrollbars, selection colour, caret, disclosure markers) is in index.html.
import { enterWhiteboardMode, exitWhiteboardMode, isWhiteboardMode } from './whiteboard-mode.js';
import { isWidgetOpen, toggleWidget } from './whiteboard.js';

// --- tooltips ------------------------------------------------------------
// A `title` attribute makes the OS draw its own tooltip. Every title is moved to `data-tip`
// (as it appears, including ones set later by scripts) and shown in an element of ours.
const tip = document.createElement('div');
tip.id = 'app-tip';
tip.setAttribute('role', 'tooltip');
document.body.append(tip);

function adopt(el) {
  const text = el.getAttribute('title');
  if (text === null) return;
  el.removeAttribute('title');
  if (text) el.dataset.tip = text; else delete el.dataset.tip;
  // the title may have been the element's only accessible name
  if (text && !el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', text);
  if (el === tipTarget) showTip(el);
}
const adoptAll = (root) => {
  if (root.nodeType !== 1) return;
  if (root.hasAttribute('title')) adopt(root);
  root.querySelectorAll('[title]').forEach(adopt);
};

let tipTarget = null;
let tipTimer = 0;

function showTip(el) {
  const text = el.dataset.tip;
  if (!text) { hideTip(); return; }
  tip.textContent = text;
  tip.classList.add('on');
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
  // Inside the composer the tip sits above the whole box, so it can never cover the text being typed.
  const box = el.closest('.composer-bar') ? document.getElementById('composer').getBoundingClientRect() : null;
  const above = (box ? box.top : r.top) - t.height - 8;
  const y = above >= 8 ? above : r.bottom + 8;
  tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  tip.classList.remove('on');
}

function aim(el, delay) {
  if (el === tipTarget) return;
  hideTip();
  if (!el) return;
  tipTarget = el;
  tipTimer = setTimeout(() => { if (tipTarget === el && el.isConnected) showTip(el); }, delay);
}

new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'attributes') adopt(r.target);
    else r.addedNodes.forEach(adoptAll);
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
adoptAll(document.documentElement);

document.addEventListener('pointerover', (e) => aim(e.target.closest?.('[data-tip]'), 450));
document.addEventListener('pointerdown', hideTip, true);
document.addEventListener('scroll', hideTip, true);
document.addEventListener('focusin', (e) => { if (e.target.matches?.(':focus-visible')) aim(e.target.closest('[data-tip]'), 150); });
document.addEventListener('focusout', hideTip);
document.documentElement.addEventListener('pointerleave', hideTip);

// --- context menu --------------------------------------------------------
const menu = document.createElement('div');
menu.id = 'app-menu';
menu.setAttribute('role', 'menu');
menu.setAttribute('aria-label', 'Actions');
menu.hidden = true;
document.body.append(menu);
let returnFocus = null;

const isField = (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
const copy = (text) => navigator.clipboard.writeText(text).catch(() => {});

// Other modules say what a right-click on their things offers: registerContext('.chat-item', (el) => [[label, action, enabled, 'danger'?], 'sep', ...]).
// The first match wins (the most specific thing under the pointer); the generic window items only show on empty space.
const providers = [];
export const registerContext = (selector, build) => providers.push([selector, build]);

// What the menu offers depends on what was clicked. Each entry: [label, action, enabled, tone] or 'sep'.
function itemsFor(target) {
  for (const [selector, build] of providers) {
    const el = target.closest(selector);
    if (el) {
      const own = build(el, target);
      if (own.length) return own;
    }
  }
  const items = [];
  const selection = String(window.getSelection() || '');
  const field = isField(target) ? target : null;

  if (field) {
    const picked = field.value.slice(field.selectionStart, field.selectionEnd);
    items.push(['Cut', () => { copy(picked); field.setRangeText('', field.selectionStart, field.selectionEnd, 'end'); field.dispatchEvent(new Event('input', { bubbles: true })); }, !!picked]);
    items.push(['Copy', () => copy(picked), !!picked]);
    items.push(['Paste', async () => {
      try {
        const text = await navigator.clipboard.readText();
        field.setRangeText(field instanceof HTMLTextAreaElement ? text : text.replace(/\r?\n/g, ' '), field.selectionStart, field.selectionEnd, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      } catch { /* clipboard read refused: Ctrl+V still works */ }
    }, true]);
    items.push(['Select all', () => field.select(), !!field.value]);
  } else if (selection.trim()) {
    items.push(['Copy', () => copy(selection), true]);
  }

  const code = target.closest('.code-box');
  if (code) items.push(['Copy code', () => copy(code.querySelector('code').innerText), true]);

  const card = target.closest('.artifact-card:not(:disabled)');
  if (card) items.push(['Open in workspace', () => card.click(), true]);

  const view = target.closest('.av');
  if (view) {
    const source = view.querySelector('.wb-tab-source:not(.active)');
    const preview = view.querySelector('.wb-tab-preview:not(.active):not(:disabled)');
    if (source) items.push(['Show source', () => source.click(), true]);
    if (preview) items.push(['Show preview', () => preview.click(), true]);
  }

  items.push([isWidgetOpen('system') ? 'Close System tab' : 'Open System tab', () => toggleWidget('system'), true]);
  items.push(isWhiteboardMode()
    ? ['Hide workspace', exitWhiteboardMode, true]
    : ['Show workspace', enterWhiteboardMode, true]);
  return items;
}

function openMenu(x, y, target) {
  hideTip();
  returnFocus = document.activeElement;
  menu.replaceChildren(...itemsFor(target).map((item) => {
    if (item === 'sep') return Object.assign(document.createElement('div'), { className: 'menu-sep', role: 'separator' });
    const [label, action, enabled, tone] = item;
    const b = document.createElement('button');
    if (tone) b.dataset.tone = tone;
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    b.disabled = !enabled;
    b.addEventListener('click', () => { closeMenu(); action(); });
    return b;
  }));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.translate = `${Math.round(Math.min(x, window.innerWidth - r.width - 8))}px ${Math.round(Math.min(y, window.innerHeight - r.height - 8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

function closeMenu() {
  if (menu.hidden) return;
  menu.hidden = true;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
}

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const target = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  // Keyboard-invoked (Shift+F10, menu key): no pointer position, open at the element.
  const r = target.getBoundingClientRect();
  const byKey = e.clientX === 0 && e.clientY === 0;
  openMenu(byKey ? r.left + 8 : e.clientX, byKey ? r.bottom : e.clientY, target);
});

// A right-click inside a sandboxed artifact frame cannot reach this document. The frame runs a
// one-line script (artifact-renderer.js) that swallows its own menu and posts the position here.
// The message is untrusted: only two numbers are read, and only from one of our frames.
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.jarvis !== 'contextmenu' || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
  const frame = [...document.querySelectorAll('iframe.wb-frame')].find((f) => f.contentWindow === e.source);
  if (!frame) return;
  const r = frame.getBoundingClientRect();
  openMenu(r.left + Math.min(Math.max(d.x, 0), r.width), r.top + Math.min(Math.max(d.y, 0), r.height), frame);
});

document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu); // also fires when a click lands inside an artifact frame
window.addEventListener('resize', closeMenu);
menu.addEventListener('keydown', (e) => {
  const live = [...menu.querySelectorAll('button:not(:disabled)')];
  const i = live.indexOf(document.activeElement);
  if (e.key === 'Escape') closeMenu();
  else if (e.key === 'ArrowDown') live[(i + 1) % live.length]?.focus();
  else if (e.key === 'ArrowUp') live[(i - 1 + live.length) % live.length]?.focus();
  else if (e.key === 'Home') live[0]?.focus();
  else if (e.key === 'End') live[live.length - 1]?.focus();
  else if (e.key === 'Tab') closeMenu();
  else return;
  e.preventDefault();
  e.stopPropagation(); // Esc closes the menu, it must not also leave the whiteboard
});

// --- browser shortcuts ---------------------------------------------------
// Keys that would open the webview's own UI. Reload stays available while developing.
const CTRL_BLOCKED = new Set(['f', 'g', 'p', 'j', 'u', 's', 'o', 'h']);
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const reload = key === 'f5' || (e.ctrlKey && key === 'r');
  if ((e.ctrlKey && !e.altKey && CTRL_BLOCKED.has(key) && !(e.shiftKey && key === 'j'))
    || key === 'f3' || key === 'f7' || (reload && import.meta.env.PROD)) e.preventDefault();
}, true);

// Middle click starts the browser's autoscroll (its own cursor and icon).
document.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
// Dragging a link, image or selected text shows the browser's drag ghost.
document.addEventListener('dragstart', (e) => e.preventDefault());
