// Writes docs/contrast.md: WCAG contrast of every text and icon token on the surfaces it sits on.
// Run: node scripts/contrast.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const themes = {
  dark: { bg: '#0A0E14', 'surface-1': '#0F141B', 'surface-2': '#131A23', 'surface-3': '#1A222D', 'surface-4': '#232E3C',
    text: '#E6EDF3', 'text-2': '#A9B6C4', 'text-3': '#7C8A99', accent: '#38BDF8', 'accent-mid': '#2B8FBF', 'accent-dim': '#1E6F9A',
    warm: '#F5A524', danger: '#E5484D', 'on-accent': '#04121C' },
  light: { bg: '#F6F9FC', 'surface-1': '#EDF2F7', 'surface-2': '#FFFFFF', 'surface-3': '#E3EAF2', 'surface-4': '#D6E0EB',
    text: '#0E1722', 'text-2': '#3F5062', 'text-3': '#566679', accent: '#0B6EA8', 'accent-mid': '#2478A8', 'accent-dim': '#3D7FA6',
    warm: '#A15C00', danger: '#C9342F', 'on-accent': '#FFFFFF' },
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// foreground token, the surfaces it appears on, the bar it must clear (4.5 text, 3 for icons and graphics)
const checks = [
  ['text', ['bg', 'surface-1', 'surface-2', 'surface-3'], 4.5, 'body text'],
  ['text-2', ['bg', 'surface-1', 'surface-2', 'surface-3'], 4.5, 'secondary text'],
  ['text-3', ['bg', 'surface-1', 'surface-2', 'surface-3'], 4.5, 'tertiary text (timestamps, labels, token counter)'],
  ['accent', ['bg', 'surface-1', 'surface-2'], 4.5, 'links and active labels'],
  ['accent-mid', ['bg', 'surface-2'], 3, 'chart line, icons, bars'],
  ['accent-dim', ['bg', 'surface-2'], 3, 'idle icons and strokes'],
  ['warm', ['bg', 'surface-2'], 3, 'mic active, spike highlight, warnings'],
  ['danger', ['bg', 'surface-2'], 3, 'errors, top bar level'],
  ['on-accent', ['accent'], 4.5, 'text on the accent button'],
];
let out = '# Contrast\n\nWCAG 2.2 ratios computed by `scripts/contrast.mjs` from the tokens in `src/styles/tokens.css`. Re-run it after changing a colour.\n';
let failed = 0;
for (const [theme, t] of Object.entries(themes)) {
  out += `\n## ${theme}\n\n| Token | On | Ratio | Needs | Result | Used for |\n|---|---|---|---|---|---|\n`;
  for (const [fg, bgs, need, use] of checks) {
    for (const bg of bgs) {
      const r = ratio(t[fg], t[bg]);
      const ok = r >= need;
      if (!ok) failed += 1;
      out += `| ${fg} ${t[fg]} | ${bg} ${t[bg]} | ${r.toFixed(2)} | ${need} | ${ok ? 'pass' : 'FAIL'} | ${use} |\n`;
    }
  }
}
mkdirSync('docs', { recursive: true });
writeFileSync('docs/contrast.md', out);
console.log(failed ? `${failed} pairs below target, see docs/contrast.md` : 'all pairs pass, see docs/contrast.md');
