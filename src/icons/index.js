// The one door to icons. HTML says <span class="icon" data-icon="attach"></span>; hydrateIcons() fills it from
// the active set (src/icons/sets/*.json, built by scripts/build-icons.mjs). Sets load lazily: only the one in
// use (plus its filled twin for active controls) is in memory. Names are semantic, never a library's.
import manifest from './manifest.json';

const loaders = import.meta.glob('./sets/*.json');
const KEY = 'jarvis.iconSet';
export const DEFAULT_SET = 'iconoir:regular';

// older names used by modules written before the switcher, and the Material glyph names dock-ui.js passes
const ALIAS = { clip: 'attach', down: 'chevron-down', left: 'chevron-left', right: 'chevron-right', attach_file: 'attach', mic_off: 'mic-off', language: 'globe', public_off: 'globe-off', wifi_off: 'wifi-off', 'win-maximize': 'win-max' };

const data = new Map();     // "set-variant" -> { kind, viewBox, icons }
const listeners = new Set();
let current = DEFAULT_SET;
try { current = localStorage.getItem(KEY) || DEFAULT_SET; } catch { /* storage blocked */ }
if (!isKnown(current)) current = DEFAULT_SET;

function isKnown(setVariant) {
  const [set, variant] = setVariant.split(':');
  return !!manifest.sets[set]?.variants.includes(variant);
}
const file = (set, variant) => `./sets/${set}-${variant}.json`;

async function load(set, variant) {
  const id = `${set}-${variant}`;
  if (data.has(id)) return data.get(id);
  const loader = loaders[file(set, variant)];
  if (!loader) return null;
  const mod = await loader();
  data.set(id, mod.default ?? mod);
  return data.get(id);
}
async function loadCurrent() {
  const [set, variant] = current.split(':');
  await load(set, variant);
  const active = manifest.sets[set].active;
  if (active) await load(set, active);
}
await loadCurrent(); // top-level: nobody asks for an icon before the set is in memory

export const listSets = () => Object.entries(manifest.sets).flatMap(([set, def]) => def.variants.map((v) => ({ id: `${set}:${v}`, set, variant: v, label: `${def.name} ${v}` })));
export const semanticNames = () => manifest.names;
export const getIconSet = () => current;
export const getSetData = async (set, variant) => load(set, variant);
export const onIconSetChange = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };

export async function setIconSet(setVariant) {
  if (!isKnown(setVariant)) return;
  current = setVariant;
  try { localStorage.setItem(KEY, setVariant); } catch { /* storage blocked */ }
  await loadCurrent();
  hydrateIcons(document);
  listeners.forEach((cb) => cb(setVariant));
}

const SLASH = (w) => `<path d="M${w * 0.125} ${w * 0.125}L${w * 0.875} ${w * 0.875}" fill="none" stroke="currentColor" stroke-width="${w / 16}" stroke-linecap="round"/>`;

// SVG markup for one icon from one loaded set file; "-off" names are the base icon with a slash through it
export function renderFrom(src, name, { size, active = false } = {}) {
  const key = ALIAS[name] ?? name;
  const off = key.endsWith('-off') && !manifest.names.includes(key);
  const base = off ? key.slice(0, -4) : key;
  const inner = src?.icons[base];
  if (!inner) return '';
  const w = Number(src.viewBox.split(' ')[2]) || 24;
  const stroke = src.kind === 'stroke'
    ? ' fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" style="stroke-width:var(--icon-stroke)"'
    : ' fill="currentColor"';
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="ic ic-${key}" viewBox="${src.viewBox}"${dim}${stroke} aria-hidden="true" focusable="false">${inner}${off ? SLASH(w) : ''}</svg>`;
}

function markup(name, active) {
  const [set, variant] = current.split(':');
  const def = manifest.sets[set];
  const base = ALIAS[name] ?? name;
  let src = active && def.active ? data.get(`${set}-${def.active}`) : null;
  if (!src?.icons[base.endsWith('-off') ? base.slice(0, -4) : base]) src = data.get(`${set}-${variant}`);
  return { svg: renderFrom(src, name) };
}

// <span class="icon" data-icon="name" data-size="16">svg</span>; a string so it can sit in innerHTML
// templates. hydrateIcons() rebuilds every such span when the set changes.
export function icon(name, { size } = {}) {
  const { svg } = markup(name, false);
  const style = size ? ` style="width:${size}px;height:${size}px"` : '';
  return `<span class="icon" data-icon="${name}"${size ? ` data-size="${size}"` : ''}${style} aria-hidden="true">${svg}</span>`;
}

export function setIcon(el, name) {
  el.dataset.icon = name;
  hydrateOne(el);
}

function hydrateOne(el) {
  el.classList.add('icon');
  const size = Number(el.dataset.size);
  if (size) { el.style.width = `${size}px`; el.style.height = `${size}px`; }
  const active = !!el.closest('[data-active]');
  const { svg } = markup(el.dataset.icon, active);
  if (el.innerHTML !== svg) el.innerHTML = svg;
}

export function hydrateIcons(root = document) {
  if (root.matches?.('[data-icon]')) hydrateOne(root);
  root.querySelectorAll('[data-icon]').forEach(hydrateOne);
}
