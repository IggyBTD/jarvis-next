// Which of the PC's models the model switcher lists. Until you change it, only the three everyday models are shown, in the order of DEFAULT_SHOWN. The Settings page
// (the Models card) is where each model is ticked or not. Kept on this device.
import { fetchModels } from './server-link.js';
import { prettyModelName } from './model-name.js';
import { currentPage } from './whiteboard-mode.js';

const KEY = 'jarvis.models.shown';
import { DEFAULT_SHOWN, sameKey as same, shownOrder } from '../../shared/shown-models.js'; // the 27B, the abliterated 27B and the 14B, in this order; the others are ticked in Settings
export { DEFAULT_SHOWN, shownOrder };
const saved = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : null; } catch { return null; } };
export const isShown = (key) => (saved() ?? DEFAULT_SHOWN).some((k) => same(k, key));
function setShown(key, on) {
  const now = new Set(saved() ?? DEFAULT_SHOWN);
  if (on) now.add(key); else now.delete(key);
  try { localStorage.setItem(KEY, JSON.stringify([...now])); } catch { /* storage blocked */ }
  document.dispatchEvent(new CustomEvent('jarvis:models-shown'));
}

const box = document.getElementById('set-models-list');
async function paint() {
  if (!box || currentPage() !== 'settings') return;
  const data = await fetchModels();
  if (!data) { box.replaceChildren(Object.assign(document.createElement('div'), { className: 'set-row does', textContent: 'The model list comes from the JARVIS server. It is not reachable right now.' })); return; }
  box.replaceChildren(...data.models.map((m, i) => {
    const id = `shown-${i}`;
    const row = Object.assign(document.createElement('div'), { className: 'set-row' });
    const label = Object.assign(document.createElement('label'), { htmlFor: id });
    label.append(Object.assign(document.createElement('span'), { textContent: m.key }), Object.assign(document.createElement('span'), { className: 'does', textContent: ` ${prettyModelName(m.name)}` }));
    const check = Object.assign(document.createElement('input'), { type: 'checkbox', id, checked: isShown(m.key) });
    check.addEventListener('change', () => setShown(m.key, check.checked));
    row.append(label, check);
    return row;
  }));
}
document.addEventListener('jarvis:page', paint);
