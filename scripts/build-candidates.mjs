// Collects icon candidates for the picker: up to 8 drawings per semantic name, from the project's sets plus the
// extra permissive sets listed in docs/icon-sources.md. All drawings come from @iconify-json/* packages and are
// normalised so each body renders alone inside <svg viewBox="...">: currentColor, no ids or classes, and for stroke
// drawings round caps and joins at 1.75 on a 24 grid (scaled for other grids) inside a <g>.
// Run: npm run icons:candidates
//   reads  icons/icon-map.json (the first candidate of each name is its "ref"), icons/custom/*.svg
//   writes icons/candidates.json   (does not touch icons/icon-map.json or src/icons/)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const NM = join(root, 'node_modules/@iconify-json');
const map = JSON.parse(readFileSync(join(root, 'icons/icon-map.json'), 'utf8'));
const STROKE = 1.75; // the reference weight (docs/icon-style-reference.md)

// Per set: which iconify names are the plain outline drawing. sfx = outline names end in s; not = every name except re.
const sfx = (s) => ({ base: (n) => (n.endsWith(s) ? n.slice(0, -s.length) : null), full: (b) => b + s });
const not = (re) => ({ base: (n) => (re.test(n) ? null : n), full: (b) => b });
const all = { base: (n) => n, full: (b) => b };
const SETS = {
  // in the project already (id in the output: phosphor, remix)
  tabler: not(/-filled$/), lucide: all, iconoir: not(/-solid$/), ph: not(/-(bold|fill|light|thin|duotone)$/), ri: sfx('-line'), solar: sfx('-linear'),
  // added
  hugeicons: all, mage: not(/-fill$/), heroicons: not(/solid/), proicons: all, mynaui: not(/-solid$/), 'meteor-icons': all,
  humbleicons: all, 'akar-icons': not(/-fill$/), 'system-uicons': all, charm: all, f7: not(/fill/), uil: all, octicon: sfx('-24'),
};
const OUTID = { ph: 'phosphor', ri: 'remix' };
const PROJ = { phosphor: 'ph', remix: 'ri' };

const META = {
  custom: ['Custom (icons/custom)', 'project', 'drawn from the reference measurements'],
  phosphor: ['Phosphor (regular)', 'MIT', 'outlined shapes on a 256 grid (about 1.5 on 24), soft round ends, friendly and open'],
  lucide: ['Lucide', 'ISC', 'plain geometric strokes, 2 native, round caps, the closest to the reference'],
  tabler: ['Tabler (outline)', 'MIT', 'geometric strokes, 2 native, a little more detail than Lucide, big catalogue'],
  iconoir: ['Iconoir (regular)', 'MIT', 'light strokes, 1.5 native, slightly rounded, editorial look'],
  remix: ['Remix Icon (line)', 'Apache-2.0', 'filled outlines, 2 on 24, firmer and squarer, some detail'],
  solar: ['Solar (linear)', 'CC-BY-4.0', 'light rounded strokes, 1.5 native; attribution required (already in the project, not permissive in the strict sense)'],
  hugeicons: ['Hugeicons (free, stroke rounded)', 'MIT', 'round strokes, 1.5 native, slightly playful bodies, very large catalogue (gpu, fan, ram, memory stick)'],
  mage: ['Mage Icons', 'Apache-2.0', 'round strokes, 1.5 native, soft corners, clean and friendly'],
  heroicons: ['Heroicons (outline)', 'MIT', 'round strokes, 1.5 native, plain and neutral, Tailwind house style'],
  proicons: ['ProIcons', 'MIT', 'round strokes, 1.5 native, slightly rounded, modern, includes window-restore'],
  mynaui: ['Myna UI Icons', 'MIT', 'round strokes, 1.5 native, rounded bodies, compact'],
  'meteor-icons': ['Meteor Icons', 'MIT', 'round strokes, 2 native, geometric, Lucide-like'],
  humbleicons: ['Humbleicons', 'MIT', 'round strokes, 2 native, small and simple, modest detail'],
  'akar-icons': ['Akar Icons', 'MIT', 'round strokes, 2 native, large live area, slightly squarish bodies'],
  'system-uicons': ['System UIcons', 'Unlicense', 'very thin strokes (1 on a 21 grid, about 1.1 on 24 natively), light and technical; public domain dedication, not MIT/ISC/Apache/CC0 by name'],
  charm: ['Charm Icons', 'MIT', '1.5 native on a 16 grid, angular, square corners in the original (joins are rounded here), sharp and technical'],
  f7: ['Framework7 Icons', 'MIT', 'SF Symbols look, filled outlines on a 56 grid (about 1.7 on 24), fixed weight'],
  uil: ['Unicons (line)', 'Apache-2.0', 'filled outlines, about 2 on 24, dense, a little heavy, fixed weight'],
  octicon: ['Octicons (24)', 'MIT', 'GitHub house style, filled outlines, about 1.5 on 24, fixed weight'],
};

// Display order after the ref. {d} is down, left or right.
const CHEV = 'ph:caret-{d} hugeicons:arrow-{d}-01 heroicons:chevron-{d} f7:chevron-{d} solar:alt-arrow-{d} system-uicons:chevron-{d} iconoir:nav-arrow-{d} proicons:chevron-{d} mage:chevron-{d}';
const PICKS = {
  chat: 'lucide:message-circle charm:message hugeicons:bubble-chat heroicons:chat-bubble-oval-left proicons:chat akar-icons:chat-bubble f7:bubble-left uil:chat meteor-icons:messages',
  code: 'tabler:code lucide:code hugeicons:source-code mynaui:code heroicons:code-bracket system-uicons:code charm:code',
  sidebar: 'lucide:panel-left ph:sidebar-simple hugeicons:sidebar-left mynaui:sidebar proicons:panel-left f7:sidebar-left charm:layout-sidebar',
  plus: 'ph:plus hugeicons:add-01 f7:plus system-uicons:plus heroicons:plus-circle solar:add-circle mynaui:plus',
  artifacts: 'tabler:cards lucide:box hugeicons:package heroicons:square-2-stack f7:cube-box lucide:shapes ph:squares-four',
  system: 'hugeicons:cpu heroicons:cpu-chip mynaui:microchip lucide:activity hugeicons:gauge tabler:device-desktop-analytics hugeicons:activity-01',
  settings: 'ph:gear heroicons:cog-6-tooth proicons:settings akar-icons:gear humbleicons:cog iconoir:settings hugeicons:settings-02',
  attach: 'ph:paperclip hugeicons:attachment-01 mynaui:paperclip heroicons:paper-clip proicons:attach akar-icons:attach f7:paperclip',
  mic: 'lucide:mic ph:microphone hugeicons:mic-01 heroicons:microphone charm:microphone proicons:microphone system-uicons:microphone',
  globe: 'lucide:globe ph:globe hugeicons:globe heroicons:globe-alt f7:globe iconoir:globe lucide:earth',
  wifi: 'tabler:wifi ph:wifi-high hugeicons:wifi-01 heroicons:wifi akar-icons:wifi humbleicons:wifi system-uicons:wifi',
  send: 'ph:paper-plane-right hugeicons:sent heroicons:paper-airplane charm:paper-plane system-uicons:paper-plane lucide:arrow-up lucide:circle-arrow-up',
  stop: 'tabler:player-stop hugeicons:stop heroicons:stop akar-icons:stop lucide:circle-stop mynaui:stop-circle solar:stop',
  'chevron-down': CHEV.replaceAll('{d}', 'down'),
  'chevron-left': CHEV.replaceAll('{d}', 'left'),
  'chevron-right': CHEV.replaceAll('{d}', 'right'),
  close: 'ph:x hugeicons:cancel-01 heroicons:x-mark akar-icons:cross f7:xmark humbleicons:times system-uicons:close',
  copy: 'ph:copy hugeicons:copy-01 heroicons:document-duplicate mynaui:copy proicons:copy akar-icons:copy f7:doc-on-doc',
  save: 'lucide:save ph:floppy-disk hugeicons:floppy-disk mage:save-floppy proicons:save charm:floppy-disk heroicons:arrow-down-tray',
  layers: 'lucide:layers hugeicons:layers-01 hugeicons:layers-02 mage:stack mynaui:layers-two f7:layers charm:stack',
  check: 'ph:check hugeicons:tick-02 heroicons:check f7:checkmark proicons:checkmark system-uicons:check lucide:circle-check',
  'win-min': 'ph:minus hugeicons:minus-sign f7:minus system-uicons:minus',
  'win-max': 'ph:square hugeicons:square mynaui:square lucide:maximize mage:maximize system-uicons:maximise',
  'win-restore': 'ph:copy-simple proicons:chrome-restore proicons:chrome-restore-var lucide:minimize-2 mynaui:minimize f7:square-on-square iconoir:copy',
  'win-close': 'ph:x hugeicons:cancel-01 heroicons:x-mark f7:xmark akar-icons:cross humbleicons:times system-uicons:close',
  cpu: 'hugeicons:cpu mage:chip heroicons:cpu-chip mynaui:microchip charm:chip octicon:cpu uil:processor',
  gpu: 'tabler:gpu tabler:gpu-2 ph:graphics-card hugeicons:gpu hugeicons:fan-01 lucide:monitor system-uicons:display',
  ram: 'lucide:memory-stick hugeicons:ram-memory hugeicons:memory-stick lucide:database heroicons:circle-stack tabler:server-2 system-uicons:database',
  search: 'ph:magnifying-glass hugeicons:search-01 mage:search heroicons:magnifying-glass akar-icons:search charm:search f7:search',
  folder: 'lucide:folder hugeicons:folder-01 hugeicons:folder-02 heroicons:folder proicons:folder charm:folder f7:folder',
  pin: 'tabler:pin ph:push-pin hugeicons:pin akar-icons:pin meteor-icons:pin solar:pin ri:pushpin',
  trash: 'ph:trash hugeicons:delete-02 hugeicons:delete-01 heroicons:trash akar-icons:trash-can humbleicons:trash charm:bin',
  edit: 'lucide:pencil ph:pencil-simple hugeicons:pencil-edit-01 hugeicons:edit-02 mage:edit meteor-icons:pencil f7:pencil',
  eject: 'tabler:player-eject ph:eject mynaui:eject f7:eject lucide:square-arrow-out-up-right lucide:log-out tabler:logout',
  refresh: 'tabler:refresh ph:arrow-clockwise hugeicons:refresh hugeicons:reload heroicons:arrow-path proicons:arrow-sync ri:refresh',
  spark: 'lucide:sparkles ph:sparkle hugeicons:sparkles hugeicons:sparkle heroicons:sparkles meteor-icons:sparkle iconoir:sparks',
  clock: 'ph:clock hugeicons:clock-01 hugeicons:clock-02 heroicons:clock charm:clock f7:clock system-uicons:clock',
  sliders: 'tabler:adjustments-horizontal ph:sliders-horizontal hugeicons:sliders-horizontal akar-icons:settings-horizontal humbleicons:adjustments solar:tuning-2 system-uicons:sliders',
  more: 'tabler:dots ph:dots-three hugeicons:more-horizontal humbleicons:dots-horizontal proicons:more solar:menu-dots heroicons:ellipsis-horizontal',
  plug: 'lucide:plug tabler:plug-connected ph:plug hugeicons:plug-socket heroicons:puzzle-piece ri:plug uil:plug',
  tasks: 'hugeicons:task-01 hugeicons:task-02 heroicons:clipboard-document-check mage:checklist solar:checklist-minimalistic lucide:list-todo lucide:square-check-big',
  'folder-plus': 'lucide:folder-plus tabler:folder-plus hugeicons:folder-add heroicons:folder-plus f7:folder-badge-plus iconoir:folder-plus solar:add-folder',
  'folder-open': 'lucide:folder-open hugeicons:folder-open heroicons:folder-open proicons:folder-open humbleicons:folder-open ri:folder-open solar:folder-open',
  file: 'hugeicons:file-01 hugeicons:file-02 mage:file proicons:file akar-icons:file charm:file heroicons:document',
  diff: 'tabler:git-compare ph:git-diff hugeicons:git-compare proicons:diff octicon:diff tabler:file-diff octicon:git-compare',
  terminal: 'tabler:terminal-2 ph:terminal-window heroicons:command-line mynaui:terminal proicons:terminal charm:terminal ri:terminal-box',
  bell: 'ph:bell hugeicons:notification-01 heroicons:bell akar-icons:bell humbleicons:bell charm:bell ri:notification',
  mail: 'ph:envelope-simple hugeicons:mail-01 heroicons:envelope akar-icons:envelope f7:envelope ri:mail iconoir:mail',
  play: 'ph:play hugeicons:play proicons:play mynaui:play tabler:player-play lucide:circle-play system-uicons:play-button',
};

const cache = {};
const load = (set) => (cache[set] ??= JSON.parse(readFileSync(join(NM, set, 'icons.json'), 'utf8')));

// One icon, normalised: { viewBox, body, kind } or null when missing or it would need ids (masks, clip paths).
function get(set, base) {
  const j = load(set);
  const name = SETS[set].full(base);
  let e = j.icons[name];
  const a = j.aliases?.[name]; // a plain alias (no rotation or flip) is the parent drawing
  if (!e && a && !a.rotate && !a.hFlip && !a.vFlip) e = j.icons[a.parent];
  if (!e) return null;
  const w = e.width ?? j.width ?? 16, h = e.height ?? j.height ?? w; // iconify's default grid is 16
  let b = e.body.replace(/<!--[\s\S]*?-->/g, '').replace(/\s(class|id|data-[\w-]+)="[^"]*"/g, '');
  if (/<mask|<clipPath|<defs|url\(#|<linearGradient/.test(b)) return null;
  b = b.replace(/\s(fill|stroke)="(?!none|currentColor|url)[^"]*"/g, (m, k) => ` ${k}="currentColor"`)
    .replace(/\s(fill-opacity|stroke-opacity|opacity)="[^"]*"/g, '');
  const stroke = /\sstroke="(?!none)/.test(b);
  const sw = +(STROKE * Math.max(w, h) / 24).toFixed(3);
  const body = stroke
    ? `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${sw}">${b.replace(/\s(stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit)="[^"]*"/g, '')}</g>`
    : `<g fill="currentColor" stroke="none">${b}</g>`;
  return { viewBox: `${e.left ?? j.left ?? 0} ${e.top ?? j.top ?? 0} ${w} ${h}`, body: body.replace(/\s+/g, ' ').replace(/> </g, '><').trim(), kind: stroke ? 'stroke' : 'fill' };
}

function custom(name) {
  const raw = readFileSync(join(root, 'icons/custom', `${name}.svg`), 'utf8');
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  return { viewBox: /viewBox="([^"]+)"/.exec(raw)[1], body: `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${STROKE}">${inner}</g>`, kind: 'stroke' };
}

const CAP = 8;
const icons = {}, kinds = {}, missing = [];
for (const name of Object.keys(map)) {
  const [rs, rn] = map[name].ref.split(':');
  const specs = [`${PROJ[rs] ?? rs}:${rn}`, ...(PICKS[name] ?? '').split(/\s+/).filter(Boolean)];
  const seen = new Set(), bodies = new Set(), list = [];
  for (const spec of specs) {
    const [set, base] = spec.split(':');
    const id = `${OUTID[set] ?? set}:${base}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const g = set === 'custom' ? custom(base) : get(set, base);
    if (!g) { missing.push(`${name}: ${id}`); continue; }
    if (bodies.has(g.body)) continue; // identical drawing from two sets
    bodies.add(g.body);
    (kinds[OUTID[set] ?? set] ??= { stroke: 0, fill: 0 })[g.kind]++;
    list.push({ id, viewBox: g.viewBox, body: g.body });
  }
  icons[name] = list.slice(0, CAP);
}
const sets = {};
for (const s of Object.keys(META)) if (kinds[s]) sets[s] = { name: META[s][0], licence: META[s][1], kind: kinds[s].stroke >= kinds[s].fill ? 'stroke' : 'fill', note: META[s][2] };

const line = (o) => JSON.stringify(o);
writeFileSync(join(root, 'icons/candidates.json'),
  '{\n "sets": {\n' + Object.entries(sets).map(([k, v]) => `  ${line(k)}: ${line(v)}`).join(',\n') + '\n },\n "icons": {\n'
  + Object.entries(icons).map(([k, v]) => `  ${line(k)}: [\n` + v.map((c) => `   ${line(c)}`).join(',\n') + '\n  ]').join(',\n') + '\n }\n}\n');
console.log(`${Object.keys(sets).length} sets, ${Object.values(icons).reduce((n, l) => n + l.length, 0)} candidates, ${missing.length} missing`);
if (missing.length) console.log(missing.join('\n'));
