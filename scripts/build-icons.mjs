// Extracts only the icons this UI uses from six icon packages and normalises them.
// Run: npm run icons
//   reads  icons/icon-map.json
//   writes src/icons/sets/<set>-<variant>.json, src/icons/manifest.json, icons/icon-resolution-report.md
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const nm = (p) => join(root, 'node_modules', p);
const require = createRequire(import.meta.url);
const map = JSON.parse(readFileSync(join(root, 'icons/icon-map.json'), 'utf8'));
const names = Object.keys(map);

// Words to try when the guessed name does not exist (whole hyphen-separated parts are matched).
const SYNONYMS = {
  chat: ['chat', 'message', 'comment'], code: ['code', 'braces', 'brackets'], sidebar: ['sidebar', 'panel', 'layout'],
  plus: ['plus', 'add'], artifacts: ['cube', 'box', 'package'], system: ['cpu', 'chip'], settings: ['settings', 'gear', 'cog'],
  attach: ['paperclip', 'attachment', 'attach'], mic: ['microphone', 'mic'], globe: ['globe', 'world', 'global'],
  wifi: ['wifi', 'wi'], send: ['send', 'plane', 'paper'], stop: ['stop', 'square'], 'chevron-down': ['chevron', 'caret', 'arrow'],
  'chevron-left': ['chevron', 'caret', 'arrow'], 'chevron-right': ['chevron', 'caret', 'arrow'], close: ['close', 'x', 'xmark', 'cross'],
  copy: ['copy', 'duplicate'], save: ['save', 'floppy', 'diskette'], layers: ['layers', 'stack'], check: ['check', 'tick'],
  'win-min': ['minus', 'minimize', 'subtract'], 'win-max': ['square', 'maximize'], 'win-restore': ['copy', 'restore'],
  'win-close': ['close', 'x'], cpu: ['cpu', 'chip'], gpu: ['gpu', 'graphics', 'monitor'], ram: ['memory', 'ram', 'database'],
};

// How each set stores its icons. kind: stroke = outline drawn with a stroke we can retune, fill = shapes, baked = stroke weight inside the paths.
const SETS = {
  phosphor: { variants: { thin: 'fill', light: 'fill', regular: 'fill', bold: 'fill', duotone: 'fill' }, active: 'fill', activeKind: 'fill' },
  tabler: { variants: { outline: 'stroke', filled: 'fill' }, active: 'filled' },
  iconoir: { variants: { regular: 'stroke', solid: 'fill' }, active: 'solid' },
  remix: { variants: { line: 'fill', fill: 'fill' }, active: 'fill' },
  solar: { variants: { linear: 'baked', outline: 'fill', bold: 'fill', 'bold-duotone': 'fill', 'line-duotone': 'baked', broken: 'baked' }, active: 'bold' },
  lucide: { variants: { baseline: 'stroke' }, active: null },
  ref: { variants: { outline: 'stroke' }, active: null }, // hybrid: each icon names its source, "lucide:clock", "tabler:plug", "custom:sidebar"
};
const DISPLAY = { phosphor: 'Phosphor', tabler: 'Tabler', iconoir: 'Iconoir', remix: 'Remix', solar: 'Solar', lucide: 'Lucide (stock baseline)', ref: 'Jarvis mix (Tabler, Lucide, Phosphor)' };

// ---- file indexes ------------------------------------------------------------
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)) : []);
const remixIndex = new Map(); // "name-line" -> path
for (const cat of readdirSync(nm('remixicon/icons'))) for (const f of list(nm(`remixicon/icons/${cat}`))) remixIndex.set(f, nm(`remixicon/icons/${cat}/${f}.svg`));
const solarJson = JSON.parse(readFileSync(nm('@iconify-json/solar/icons.json'), 'utf8'));

const sources = {
  phosphor: {
    names: () => list(nm('@phosphor-icons/core/assets/regular')),
    read: (name, v) => { const f = nm(`@phosphor-icons/core/assets/${v}/${name}${v === 'regular' ? '' : `-${v}`}.svg`); return existsSync(f) ? readFileSync(f, 'utf8') : null; },
  },
  tabler: {
    names: () => list(nm('@tabler/icons/icons/outline')),
    read: (name, v) => { const f = nm(`@tabler/icons/icons/${v}/${name}.svg`); return existsSync(f) ? readFileSync(f, 'utf8') : null; },
  },
  iconoir: {
    names: () => list(nm('iconoir/icons/regular')),
    read: (name, v) => { const f = nm(`iconoir/icons/${v}/${name}.svg`); return existsSync(f) ? readFileSync(f, 'utf8') : null; },
  },
  remix: {
    names: () => [...remixIndex.keys()].filter((k) => k.endsWith('-line')).map((k) => k.slice(0, -5)),
    read: (name, v) => { const f = remixIndex.get(`${name}-${v}`); return f ? readFileSync(f, 'utf8') : null; },
  },
  solar: {
    names: () => [...new Set(Object.keys(solarJson.icons).map((k) => k.replace(/-(linear|outline|bold-duotone|bold|line-duotone|broken)$/, '')))],
    read: (name, v) => { const e = solarJson.icons[`${name}-${v}`]; return e ? `<svg viewBox="0 0 24 24">${e.body}</svg>` : null; },
  },
  lucide: {
    names: () => list(nm('lucide-static/icons')),
    read: (name) => { const f = nm(`lucide-static/icons/${name}.svg`); return existsSync(f) ? readFileSync(f, 'utf8') : null; },
  },
  // "package:name": lucide and tabler outline are both 24 grid, round caps and joins; custom = icons/custom/<name>.svg
  ref: {
    names: () => [],
    read: (spec) => {
      const [pkg, name] = spec.split(':');
      if (pkg === 'custom') { const f = join(root, 'icons/custom', `${name}.svg`); return existsSync(f) ? readFileSync(f, 'utf8') : null; }
      if (pkg === 'phosphor') { // 256 grid, filled outlines: drawn in a nested 256 viewBox, no stroke (16/256 of the grid = 1.5 of 24)
        const raw = sources.phosphor.read(name, 'regular');
        if (!raw) return null;
        const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect[^>]*fill="none"[^>]*\/>/g, '');
        return `<svg viewBox="0 0 24 24"><svg viewBox="0 0 256 256" width="24" height="24" fill="currentColor" stroke="none">${inner}</svg></svg>`; // nested svg, not a transform: icons.css sets transform-box on every child
      }
      if (!['tabler', 'lucide'].includes(pkg)) { // any other set: the drawing normalised in icons/candidates.json (npm run icons:candidates)
        const c = candidates()[spec];
        if (!c) return null;
        if (c.viewBox === '0 0 24 24') return `<svg viewBox="0 0 24 24">${c.body}</svg>`; // stroke width then follows --icon-stroke
        // another grid: nested viewBox; the body's own stroke width moves to a style so normalise() keeps it
        return `<svg viewBox="0 0 24 24"><svg viewBox="${c.viewBox}" width="24" height="24">${c.body.replace(/\sstroke-width="([^"]*)"/g, ' style="stroke-width:$1"')}</svg></svg>`;
      }
      return sources[pkg]?.read(name, 'outline') ?? null;
    },
  },
};

let candidateIndex = null;
function candidates() {
  if (!candidateIndex) {
    candidateIndex = {};
    const f = join(root, 'icons/candidates.json');
    if (existsSync(f)) for (const list of Object.values(JSON.parse(readFileSync(f, 'utf8')).icons)) for (const o of list) candidateIndex[o.id] = o;
  }
  return candidateIndex;
}

// ---- resolve a semantic name to a real icon name for a set ---------------------
const report = [];
const absent = [];
function resolve(set, semantic, firstVariant) {
  const guess = map[semantic][set];
  const src = sources[set];
  if (src.read(guess, firstVariant)) return { name: guess, how: 'exact' };
  const all = src.names();
  const words = SYNONYMS[semantic] ?? [semantic];
  const hit = all
    .map((n) => ({ n, parts: n.split('-') }))
    .filter(({ parts }) => words.some((w) => parts.includes(w)))
    .sort((a, b) => (a.n.length - b.n.length))[0];
  if (hit && src.read(hit.n, firstVariant)) return { name: hit.n, how: `fuzzy (guess "${guess}" missing)` };
  return null;
}

// ---- normalise one SVG ---------------------------------------------------------
function normalise(svg, kind, variant) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 24 24';
  let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  inner = inner
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(title|desc|metadata)[\s\S]*?<\/\1>/g, '')
    .replace(/<path[^>]*d="M0 0h24v24H0z"[^>]*\/>/g, '')            // tabler/remix empty bounding path
    .replace(/<rect[^>]*width="256"[^>]*height="256"[^>]*fill="none"[^>]*\/>/g, '') // phosphor frame
    .replace(/\s(class|id|data-[\w-]+)="[^"]*"/g, '')
    .replace(/\sfill="(?!none)[^"]*"/g, ' fill="currentColor"')
    .replace(/\sstroke="(?!none)[^"]*"/g, ' stroke="currentColor"');
  if (kind === 'stroke') inner = inner.replace(/\sstroke-width="[^"]*"/g, '');
  if (/duotone/.test(variant)) inner = inner.replace(/\s(fill-)?opacity="[\d.]+"/g, (m, f) => ` ${f ?? ''}opacity="0.2"`);
  return { viewBox, inner: inner.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim() };
}

// ---- build ---------------------------------------------------------------------
rmSync(join(root, 'src/icons/sets'), { recursive: true, force: true });
mkdirSync(join(root, 'src/icons/sets'), { recursive: true });
const manifest = { names, sets: {} };
let written = 0;

for (const [set, def] of Object.entries(SETS)) {
  const variants = Object.keys(def.variants);
  const all = def.active && !variants.includes(def.active) ? [...variants, def.active] : variants;
  const kinds = { ...def.variants, ...(def.active ? { [def.active]: def.variants[def.active] ?? (set === 'phosphor' ? 'fill' : 'fill') } : {}) };
  // phosphor "fill" is a separate folder, not in the cyclable list
  const toBuild = set === 'phosphor' ? [...variants, 'fill'] : all;
  const resolved = Object.fromEntries(names.map((n) => [n, resolve(set, n, variants[0])]));
  manifest.sets[set] = { name: DISPLAY[set], variants, active: def.active, kinds: { ...kinds, fill: 'fill' }, missing: [] };
  for (const variant of toBuild) {
    const kind = kinds[variant] ?? 'fill';
    const icons = {};
    let viewBox = '0 0 24 24';
    for (const n of names) {
      const r = resolved[n];
      let raw = r && sources[set].read(r.name, variant);
      let drawnAs = variant;
      if (!raw && r && variant === def.active) { raw = sources[set].read(r.name, variants[0]); drawnAs = variants[0]; } // no filled twin: use the base drawing
      if (!raw) { if (variants.includes(variant)) { absent.push(`| ${set}:${variant} | ${n} | no drawing in this variant, shows blank |`); if (variant === variants[0]) manifest.sets[set].missing.push(n); } continue; }
      const out = normalise(raw, def.variants[drawnAs] ?? kind, drawnAs);
      viewBox = out.viewBox;
      // a base drawing used in a fill set keeps its own stroke so it still reads as an outline
      icons[n] = drawnAs !== variant && (def.variants[drawnAs] ?? 'fill') !== kind && kind === 'fill'
        ? `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${out.inner}</g>`
        : out.inner;
    }
    writeFileSync(join(root, `src/icons/sets/${set}-${variant}.json`), JSON.stringify({ set, variant, kind, viewBox, icons }));
    written += 1;
  }
  for (const n of names) {
    const r = resolved[n];
    if (!r) report.push(`| ${set} | ${n} | UNRESOLVED | guess "${map[n][set]}" |`);
    else if (r.how !== 'exact') report.push(`| ${set} | ${n} | ${r.name} | ${r.how} |`);
  }
}

writeFileSync(join(root, 'src/icons/manifest.json'), JSON.stringify(manifest, null, 2));
const md = ['# Icon resolution report', '', 'Generated by `npm run icons`. Anything listed here was not an exact match for the guess in `icons/icon-map.json`. Fix by editing the map and re-running.', '',
  report.length ? '| Set | Semantic name | Used | Note |\n|---|---|---|---|\n' + report.join('\n') : 'Every icon resolved exactly.', '',
  '## Missing in a variant', '',
  absent.length ? '| Set:variant | Semantic name | Note |\n|---|---|---|\n' + absent.join('\n') : 'None.', ''].join('\n');
writeFileSync(join(root, 'icons/icon-resolution-report.md'), md);
// the full icon list for editing: one row per name, the source in use (the "ref" column of icons/icon-map.json) and the alternatives
const listMd = ['# Icon list', '',
  'Generated by `npm run icons` from `icons/icon-map.json`. To change an icon, edit its `ref` value there (`tabler:name`, `lucide:name`, `phosphor:name`, or `custom:name` for `icons/custom/name.svg`) and run `npm run icons`.', '',
  '| Name | In use (ref) | Tabler | Lucide | Phosphor |', '|---|---|---|---|---|',
  ...names.map((n) => `| ${n} | \`${map[n].ref}\` | ${map[n].tabler} | ${map[n].lucide} | ${map[n].phosphor} |`), ''].join('\n');
writeFileSync(join(root, 'docs/icon-list.md'), listMd);
console.log(`${written} set files, ${names.length} semantic icons, ${report.length} not exact (see icons/icon-resolution-report.md)`);
