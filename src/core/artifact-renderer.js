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

// Artifacts follow the app theme (the Settings choice, else Windows).
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const PAL = {
  dark: { bg: '#262624', fg: '#faf9f5', muted: '#c2c0b6', line: '#3a3936', ctl: '#30302e', ctlLine: '#54524d', accent: '#3fc1b0', err: '#ef7d78', sel: 'rgba(63,193,176,0.3)' },
  light: { bg: '#faf9f5', fg: '#141413', muted: '#4d4c46', line: '#e6e3d9', ctl: '#f0eee6', ctlLine: '#cfcbbe', accent: '#0b7f73', err: '#b3342f', sel: 'rgba(11,127,115,0.25)' },
};
// An interface can restyle artifacts with --art-<key> custom properties on :root (the nodes
// interface does); without them the palette above applies.
const pal = () => {
  const base = { ...PAL[isDark() ? 'dark' : 'light'], series: '#8b897f' };
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, css.getPropertyValue(`--art-${k}`).trim() || v]));
};
const baseCss = () => {
  const p = pal();
  return `
  html { color-scheme: ${isDark() ? 'dark' : 'light'}; }
  body { margin: 0; background: ${p.bg}; color: ${p.fg}; font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: ${p.ctlLine}; border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
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

// A full HTML document: inject the CSP as the very first thing in <head>.
function htmlDocument(source) {
  const base = `${cspMeta(CSP_SCRIPTS)}<style>${baseCss()}</style>${GUARD_TAG}`;
  if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">${base}`);
  if (/<html[\s>]/i.test(source)) return source.replace(/<html([^>]*)>/i, `<html$1><head><meta charset="utf-8">${base}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${source}</body></html>`;
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
      return wrap('<div style="position:absolute;inset:12px"><canvas id="c"></canvas></div>', {
        policy: CSP_SCRIPTS,
        scripts: `<script type="application/json" id="spec">${jsonForScript(content)}</script><script>${lib}</script><script>
          try {
            var spec = JSON.parse(document.getElementById('spec').textContent);
            Chart.defaults.animation = false; // draw immediately; does not depend on animation frames
            Chart.defaults.color = '${pal().muted}';
            Chart.defaults.borderColor = '${pal().line}';
            // Datasets without their own colour use the app's bar grey (at least 3:1 on both themes);
            // Chart.js's own default, 10% black, all but disappears on the dark canvas.
            Chart.defaults.backgroundColor = '${pal().series}';
            Chart.defaults.elements.line.borderColor = '${pal().series}';
            Chart.defaults.elements.point.backgroundColor = '${pal().series}';
            Chart.defaults.font.family = 'Segoe UI, system-ui, sans-serif';
            spec.options = Object.assign({ responsive: true, maintainAspectRatio: false }, spec.options || {});
            new Chart(document.getElementById('c'), spec);
          } catch (e) {
            document.body.insertAdjacentHTML('beforeend', '<pre style="color:${pal().err};padding:16px;white-space:pre-wrap">' + String(e && e.message || e).replace(/</g, '&lt;') + '</pre>');
          }
        </script>`,
      });
    }

    default:
      return null;
  }
}
