// Which of the PC's models the model switcher lists. Until you change it, only the three everyday models are shown. The Settings page
// (the Models card) is where each model is ticked or not. Kept on this device.
import { fetchModels } from './server-link.js';
import { prettyModelName } from './model-name.js';
import { currentPage } from './whiteboard-mode.js';

const KEY = 'jarvis.models.shown';
export const DEFAULT_SHOWN = ['unsloth/qwen3.8-27b', 'huihui-ai_qwen3-14b-abliterated']; // the 27B and the abliterated 14B; the others are ticked in Settings
const saved = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : null; } catch { return null; } };
// LM Studio lists the 27B as "qwen3.8-27b", the config calls it "unsloth/qwen3.8-27b": a key matches with or without its publisher
const same = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
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
