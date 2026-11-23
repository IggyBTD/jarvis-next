// Builds the sandboxed document for an artifact. The result is loaded into an
// <iframe sandbox="allow-scripts"> (no allow-same-origin): the page cannot touch
// the app, storage or cookies, and the CSP below blocks every network request.
// Libraries come from the local bundle, never a CDN: Chart.js is inlined into the
// document, Mermaid is rendered to SVG here in the app so the iframe needs no script.
// (A parent-origin blob: URL cannot be loaded by an opaque-origin iframe.)

const CSP_BASE = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
];
const CSP_SCRIPTS = [...CSP_BASE, "script-src 'unsafe-inline'"].join('; ');

// One script of ours runs in every frame: it swallows the browser's right-click menu and middle
// click autoscroll, and tells the app where the right-click happened so the app's own menu opens
// there (native-chrome.js). It only ever posts two numbers.
const GUARD = "addEventListener('contextmenu',function(e){e.preventDefault();parent.postMessage({jarvis:'contextmenu',x:e.clientX,y:e.clientY},'*')});addEventListener('mousedown',function(e){if(e.button===1)e.preventDefault()});";
const GUARD_TAG = `<script>${GUARD}</script>`;

// Static previews (svg, mermaid) allow no scripts except the guard, pinned by its hash.
let staticPolicy = null;
async function cspStatic() {
  if (!staticPolicy) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(GUARD));
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    staticPolicy = [...CSP_BASE, `script-src 'sha256-${hash}'`].join('; ');
  }
  return staticPolicy;
}

import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?inline';
import formulaSource from './formula.js?raw';
import { isFormulaSpec } from './formula.js';
import { formulaPlot } from './formula-plot.js';

// Artifacts follow the app theme (the Settings choice, else Windows).
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pal = () => ({
  bg: token('--bg'), fg: token('--text'), muted: token('--text-2'), text3: token('--text-3'), line: token('--border'), lineStrong: token('--border-strong'),
  ctl: token('--surface-3'), ctlLine: token('--border-strong'), accent: token('--accent'), accentMid: token('--accent-mid'), accentDim: token('--accent-dim'),
  warm: token('--warm'), err: token('--danger'), sel: token('--accent-wash'),
  atomRim: token('--atom-rim') || token('--accent'), mono: token('--mono') || "'JetBrains Mono', ui-monospace, monospace",
});
const baseCss = () => {
  const p = pal();
  return `
  @font-face { font-family: 'JetBrains Mono'; font-weight: 400; src: url(${monoFont}) format('woff2'); }
  html { color-scheme: ${isDark() ? 'dark' : 'light'}; }
  body { margin: 0; background: ${p.bg}; color: ${p.fg}; font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: ${p.ctl}; border-radius: 8px; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
  ::selection { background: ${p.sel}; }
  /* themed starting point for controls a page does not style itself (no browser-grey buttons) */
  button, input, select, textarea { font: inherit; color: inherit; background: ${p.ctl}; border: 1px solid ${p.ctlLine}; border-radius: 8px; padding: 0.4em 0.8em; }
  button { cursor: pointer; }
  button:hover { border-color: ${p.accent}; }
  :focus-visible { outline: 2px solid ${p.accent}; outline-offset: 2px; }
  a { color: ${p.accent}; }
  input, textarea { caret-color: ${p.accent}; }
`;
};

let mermaidReady = null;
let mermaidCounter = 0;

async function renderMermaid(source) {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    return mermaid;
  });
  const mermaid = await mermaidReady;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: mermaidTheme() }); // each time, so a theme change applies
  mermaidCounter += 1;
  return (await mermaid.render(`mmd-${mermaidCounter}`, source)).svg;
}

// Chart.js UMD build as text, loaded on demand. Relative path on purpose: the
// package "exports" map does not expose dist files.
let chartSource = null;
async function chartLibrary() {
  chartSource ??= (await import('../../node_modules/chart.js/dist/chart.umd.js?raw')).default;
  return chartSource.replaceAll('</script', '<' + '\\/script');
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Safe inside <script type="application/json">: no "</script" or "<!--" sequences.
const jsonForScript = (s) => s.replace(/</g, '\\u003c');

const cspMeta = (policy) => `<meta http-equiv="Content-Security-Policy" content="${policy}">`;

function wrap(body, { head = '', scripts = '', policy }) {
  return `<!doctype html><html><head><meta charset="utf-8">${cspMeta(policy)}<style>${baseCss()}</style>${GUARD_TAG}${head}</head><body>${body}${scripts}</body></html>`;
}

// A full HTML document: the CSP goes at offset 0, before anything the document says. The HTML parser puts a leading <meta> into the
// head it creates itself, so no <head> in a comment, in a script string or after earlier content can come before the policy. The
// document's own <html> and <head> tags that follow are merged into those (the browser ignores the repeats).
function htmlDocument(source) {
  return `<!doctype html><meta charset="utf-8">${cspMeta(CSP_SCRIPTS)}<style>${baseCss()}</style>${GUARD_TAG}${source}`;
}

const mermaidTheme = () => {
  const p = pal();
  return { background: p.bg, primaryColor: p.ctl, primaryTextColor: p.fg, primaryBorderColor: p.accent, lineColor: p.muted, secondaryColor: p.line, tertiaryColor: p.bg, textColor: p.fg, fontFamily: 'Segoe UI, system-ui, sans-serif' };
};

// Resolves to a srcdoc string, or null if this type has no iframe preview.
export async function buildSrcdoc(type, content) {
  switch (type) {
    case 'html':
      return htmlDocument(content);

    case 'svg':
      return wrap(`<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:12px;box-sizing:border-box">${content}</div>`,
        { head: '<style>svg{max-width:100%;max-height:92vh;height:auto}</style>', policy: await cspStatic() });

    case 'mermaid': {
      let inner;
      try {
        inner = await renderMermaid(content);
      } catch (e) {
        document.querySelectorAll('[id^="dmmd-"], [id^="mmd-"]').forEach((n) => n.remove()); // mermaid leaves its error graphic behind
        inner = `<pre style="color:${pal().err};padding:16px;white-space:pre-wrap">${escapeHtml(String(e.message || e))}</pre>`;
      }
      return wrap(`<div style="display:flex;justify-content:center;padding:16px;box-sizing:border-box">${inner}</div>`, { policy: await cspStatic() });
    }

    case 'chart': {
      const lib = await chartLibrary();
      const p = pal();
      // {"type":"function","functions":["a*sin(b*x)"],...}: drawn from the formulas here, with a slider per variable (formula-plot.js)
      if (isFormulaSpec(content)) {
        const { head, body, scripts } = formulaPlot({ content, chartLib: lib, formulaLib: formulaSource.replace(/^export /gm, ''), jsonForScript, p });
        return wrap(body, { head, scripts, policy: CSP_SCRIPTS });
      }
      const boot = `var P = ${JSON.stringify({ muted: p.muted, text3: p.text3, line: p.line, accentMid: p.accentMid, accentDim: p.accentDim, accent: p.accent, warm: p.warm, bg: p.bg, fg: p.fg })};`;
      return wrap('<div style="position:absolute;inset:0;padding:16px 16px 12px"><canvas id="c"></canvas></div>', {
        policy: CSP_SCRIPTS,
        scripts: `<script type="application/json" id="spec">${jsonForScript(content)}</script><script>${lib}</script><script>
          try {
            ${boot}
            var spec = JSON.parse(document.getElementById('spec').textContent);
            var sets = (spec.data && spec.data.datasets) || [];
            var single = sets.length === 1 && (spec.type === 'line' || !spec.type);
            var mono = "'JetBrains Mono', ui-monospace, monospace";
            Chart.defaults.animation = false; // also honours reduced motion: nothing moves
            Chart.defaults.color = P.text3;
            Chart.defaults.font.family = mono;
            Chart.defaults.font.size = 11;
            Chart.defaults.elements.point.radius = 0;
            Chart.defaults.elements.point.hoverRadius = 4;
            Chart.defaults.elements.point.hitRadius = 12;
            Chart.defaults.elements.line.borderWidth = 1.5;
            Chart.defaults.elements.line.tension = 0.25;
            // a percentage axis gets % on its ticks and a fixed 25-point step
            var label = (sets[0] && sets[0].label || '') + ' ' + (((spec.options || {}).scales || {}).y && spec.options.scales.y.title && spec.options.scales.y.title.text || '');
            var unit = /%/.test(label) ? '%' : '';
            var yTicks = { callback: function (v) { return v + unit; }, padding: 8 };
            var y = (spec.options && spec.options.scales && spec.options.scales.y) || {};
            if (unit && y.min === 0 && y.max === 100) yTicks.stepSize = 25;
            // series colour: one quiet blue for a single series; area fades to nothing
            function rgba(hex, a) { var h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
            var palette = [P.accentMid, P.warm, P.muted, P.accentDim];
            sets.forEach(function (d, i) {
              var colour = single ? P.accentMid : (d.borderColor || palette[i % palette.length]);
              d.borderColor = colour;
              if (!d.fill && !d.backgroundColor) d.backgroundColor = colour; // bars and points get the series colour, not Chart.js's 10 % grey
              if (d.fill) {
                d.fill = true;
                d.backgroundColor = function (ctx) {
                  var area = ctx.chart.chartArea; if (!area) return 'transparent';
                  var g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                  g.addColorStop(0, rgba(P.accent, 0.25)); g.addColorStop(1, rgba(P.accent, 0));
                  return g;
                };
              }
            });
            var o = spec.options = Object.assign({ responsive: true, maintainAspectRatio: false }, spec.options || {});
            o.layout = Object.assign({ padding: { top: 12, right: 12, bottom: 8, left: 8 } }, o.layout || {});
            o.plugins = o.plugins || {};
            o.plugins.legend = Object.assign({ display: !single, labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true } }, o.plugins.legend || {});
            o.plugins.tooltip = Object.assign({ backgroundColor: P.bg, titleColor: P.fg, bodyColor: P.muted, borderColor: P.line, borderWidth: 1, padding: 8, displayColors: false, titleFont: { family: mono }, bodyFont: { family: mono } }, o.plugins.tooltip || {});
            o.scales = o.scales || {};
            o.scales.x = Object.assign({ grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, padding: 6 } }, o.scales.x || {});
            o.scales.y = Object.assign({}, o.scales.y, { grid: Object.assign({ color: rgba(P.text3, 0.18), drawTicks: false }, (o.scales.y || {}).grid || {}), border: { display: false }, ticks: Object.assign(yTicks, (o.scales.y || {}).ticks || {}) });
            // the highest sample of a single series is marked once, in the warm colour, with its value
            spec.plugins = (spec.plugins || []).concat(single ? [{
              id: 'peak',
              afterDatasetsDraw: function (chart) {
                var data = chart.data.datasets[0].data.map(Number), max = Math.max.apply(null, data);
                if (!isFinite(max) || max === Math.min.apply(null, data)) return;
                var i = data.indexOf(max), pt = chart.getDatasetMeta(0).data[i], c = chart.ctx;
                c.save(); c.fillStyle = P.warm; c.beginPath(); c.arc(pt.x, pt.y, 4, 0, 6.2832); c.fill();
                c.font = '11px ' + mono; c.textAlign = 'center'; c.fillText(max + unit, Math.min(Math.max(pt.x, 20), chart.width - 20), pt.y - 10); c.restore();
              },
            }] : []);
            new Chart(document.getElementById('c'), spec);
          } catch (e) {
            document.body.insertAdjacentHTML('beforeend', '<pre style="color:${p.err};padding:16px;white-space:pre-wrap">' + String(e && e.message || e).replace(/</g, '&lt;') + '</pre>');
          }
        </script>`,
      });
    }

    default:
      return null;
  }
}
