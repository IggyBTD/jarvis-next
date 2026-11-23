// The page of a function plot (a chart artifact whose JSON has "functions": see formula.js): a Chart.js line drawn from the
// formulas by the frame itself, and under it one slider per variable. Moving a slider redraws the curves at once, so the model
// sends a formula and its ranges instead of hundreds of points. Built from the app's tokens like every artifact frame
// (`p` is pal() in artifact-renderer.js); the script runs inside the sandboxed iframe next to Chart.js and formula.js.

const rgbaFn = `function rgba(c, a) { var h = String(c).replace('#', ''); if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return c; if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }`;

const css = (p, mono) => `
  html, body { height: 100%; overflow: hidden; }
  #plot { position: absolute; inset: 0; display: flex; flex-direction: column; }
  .plot-chart { position: relative; flex: 1 1 auto; min-height: 160px; padding: 16px 16px 8px; }
  .note { margin: 0; padding: 0 16px 8px; font-size: 12px; line-height: 16px; color: ${p.err}; }
  .vars { box-sizing: border-box; flex: 0 0 auto; max-height: 45%; overflow: auto; border-top: 1px solid ${p.line}; padding: 4px 16px 16px; }
  .vars-head { display: flex; align-items: center; justify-content: space-between; height: 32px; }
  .vars-head h2 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; color: ${p.muted}; }
  .vars-head button { height: 28px; padding: 0 12px; background: transparent; border-color: ${p.ctlLine}; font-size: 12px; line-height: 16px; font-weight: 600; color: ${p.muted}; }
  .vars-head button:hover { background: ${p.ctl}; color: ${p.fg}; border-color: ${p.ctlLine}; }
  .vars-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); column-gap: 24px; }
  .row { display: grid; grid-template-columns: var(--namew) minmax(0, 1fr) 72px; grid-template-areas: "name slider val"; column-gap: 12px; align-items: center; height: 32px; font-family: ${mono}; }
  .name { grid-area: name; display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  input[type=range] { grid-area: slider; }
  input.val { grid-area: val; }
  .sym { flex: none; font-size: 13px; color: ${p.fg}; }
  .desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; font-size: 12px; color: ${p.text3}; }
  input.val { width: 100%; box-sizing: border-box; height: 28px; padding: 0 8px; text-align: right; font-family: ${mono}; font-size: 12px; font-variant-numeric: tabular-nums; -moz-appearance: textfield; }
  input.val::-webkit-inner-spin-button, input.val::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 32px; margin: 0; padding: 0; background: transparent; border: 0; border-radius: 0; cursor: pointer; }
  input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: ${p.lineStrong}; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6px; border: 0; border-radius: 50%; background: ${p.accentMid}; box-shadow: inset 0 0 0 1.5px ${p.atomRim}; }
  input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: ${p.lineStrong}; }
  input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border: 0; border-radius: 50%; background: ${p.accentMid}; box-shadow: inset 0 0 0 1.5px ${p.atomRim}; }
  input[type=range]:hover::-webkit-slider-thumb, input[type=range]:active::-webkit-slider-thumb { background: ${p.accent}; }
  input[type=range]:focus-visible { outline: none; }
  input[type=range]:focus-visible::-webkit-slider-thumb { outline: 2px solid ${p.accent}; outline-offset: 2px; }
  input[type=range]:focus-visible::-moz-range-thumb { outline: 2px solid ${p.accent}; outline-offset: 2px; }
  pre.err { margin: 0; padding: 16px; white-space: pre-wrap; color: ${p.err}; }
  @media (pointer: coarse) {
    .row { height: 44px; }
    input[type=range] { height: 44px; }
    input[type=range]::-webkit-slider-thumb { width: 24px; height: 24px; margin-top: -10px; }
    input[type=range]::-moz-range-thumb { width: 24px; height: 24px; }
    input.val, .vars-head button { height: 40px; }
    .vars-head { height: 44px; }
  }
  @media (max-width: 480px) { /* narrow (a phone): the name and the number share a line, the slider gets the full width under them */
    .vars-grid { grid-template-columns: minmax(0, 1fr); }
    .row { grid-template-columns: minmax(0, 1fr) 72px; grid-template-areas: "name val" "slider slider"; height: auto; row-gap: 0; padding-top: 4px; }
  }
`;

// The in-frame program. It needs Chart and the formula.js functions (compileFormula is used through normalizeSpec) as globals.
const client = (palette, mono) => `
  (function () {
    var P = ${JSON.stringify(palette)}, mono = ${JSON.stringify(mono)};
    ${rgbaFn}
    var root = document.getElementById('plot');
    function fail(message) {
      var pre = document.createElement('pre');
      pre.className = 'err';
      pre.textContent = message;
      root.replaceChildren(pre);
    }
    function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function fmt(v) { v = Number(v); if (!isFinite(v)) return ''; return (v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3)) ? v.toExponential(3) : String(+v.toPrecision(5)); }
    try {
      var N = normalizeSpec(JSON.parse(document.getElementById('spec').textContent));
      var SAMPLES = 800;
      var scope = Object.create(null);
      var view = N.y.fixed ? { min: N.y.min, max: N.y.max } : null;
      var pending = 0;

      if (N.errors.length) { var note = document.getElementById('note'); note.textContent = N.errors.join(' '); note.hidden = false; }

      Chart.defaults.animation = false; // nothing moves, which also honours reduced motion
      Chart.defaults.color = P.text3;
      Chart.defaults.font.family = mono;
      Chart.defaults.font.size = 11;
      var colours = [P.accentMid, P.muted];
      var grid = function (c) { return c.tick && c.tick.value === 0 ? P.lineStrong : rgba(P.text3, 0.18); };
      var axis = function (label) {
        return { type: 'linear', title: { display: !!label, text: label, color: P.text3, font: { family: mono, size: 11 } }, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { padding: 8, maxTicksLimit: 9 } };
      };
      var xAxis = axis(N.x.label); xAxis.min = N.x.min; xAxis.max = N.x.max;
      var yAxis = axis(N.y.label);
      var chart = new Chart(document.getElementById('c'), {
        type: 'line',
        data: { datasets: N.fns.map(function (f, i) {
          return { label: f.label, data: [], parsing: false, normalized: true, spanGaps: false, tension: 0, borderWidth: 2, borderColor: colours[i % 2], backgroundColor: colours[i % 2], borderDash: i > 1 ? [6, 4] : [], pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 12 };
        }) },
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } },
          interaction: { mode: 'index', axis: 'x', intersect: false },
          scales: { x: xAxis, y: yAxis },
          plugins: {
            legend: { display: true, align: 'start', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { family: mono, size: 12 } } },
            tooltip: { backgroundColor: P.bg, titleColor: P.fg, bodyColor: P.muted, borderColor: P.line, borderWidth: 1, padding: 8, displayColors: false, titleFont: { family: mono }, bodyFont: { family: mono },
              callbacks: {
                title: function (items) { return items.length ? 'x = ' + fmt(items[0].raw.x) : ''; },
                label: function (item) { return item.raw && item.raw.y != null ? item.dataset.label + ' = ' + fmt(item.raw.y) : ''; },
              } },
          },
        },
      });

      function draw() {
        pending = 0;
        N.params.forEach(function (p) { scope[p.name] = p.value; });
        var ys = N.fns.map(function (f) { return sampleFormula(f.fn, scope, N.x.min, N.x.max, SAMPLES); });
        if (!N.y.fixed) {
          var fit = fitRange([].concat.apply([], ys));
          view = view ? growRange(view, fit) : fit;
        }
        chart.data.datasets.forEach(function (d, i) { d.data = formulaPoints(ys[i], N.x.min, N.x.max, view); });
        chart.options.scales.y.min = view.min;
        chart.options.scales.y.max = view.max;
        chart.update('none');
      }
      function redraw() { if (!pending) pending = requestAnimationFrame(draw); } // one draw per frame while a slider moves

      var panel = document.getElementById('vars');
      var rows = document.getElementById('rows');
      panel.hidden = !N.params.length;
      var longest = N.params.reduce(function (m, p) { return Math.max(m, p.name.length); }, 1);
      rows.style.setProperty('--namew', 'calc(' + longest + 'ch + ' + (N.params.some(function (p) { return p.label; }) ? 128 : 8) + 'px)');
      var ui = N.params.map(function (p) {
        var row = el('div', 'row');
        var name = el('span', 'name');
        name.appendChild(el('span', 'sym', p.name));
        if (p.label) { var d = el('span', 'desc', p.label); d.title = p.label; name.appendChild(d); }
        var slider = el('input'); slider.type = 'range';
        var box = el('input', 'val'); box.type = 'number';
        [slider, box].forEach(function (n) { n.min = p.min; n.max = p.max; n.step = p.step; });
        slider.setAttribute('aria-label', p.label ? p.label + ' (' + p.name + ')' : p.name);
        box.setAttribute('aria-label', p.name + ' value');
        function show() { slider.value = p.value; box.value = p.value.toFixed(p.decimals); }
        slider.addEventListener('input', function () { p.value = Number(slider.value); box.value = p.value.toFixed(p.decimals); redraw(); });
        box.addEventListener('change', function () {
          var v = Number(box.value);
          p.value = isFinite(v) && box.value !== '' ? Math.min(p.max, Math.max(p.min, v)) : p.value;
          show(); redraw();
        });
        show();
        row.append(name, slider, box);
        rows.appendChild(row);
        return { p: p, show: show };
      });
      document.getElementById('reset').addEventListener('click', function () {
        ui.forEach(function (u) { u.p.value = u.p.initial; u.show(); });
        view = N.y.fixed ? view : null;
        redraw();
      });
      draw();
    } catch (e) {
      fail(String(e && e.message || e));
    }
  })();
`;

// -> { head, body, scripts } for wrap() in artifact-renderer.js; the Chart.js text, the formula.js text and the palette `p` come from there.
export function formulaPlot({ content, chartLib, formulaLib, p, jsonForScript }) {
  const palette = { muted: p.muted, text3: p.text3, line: p.line, lineStrong: p.lineStrong, accentMid: p.accentMid, accent: p.accent, bg: p.bg, fg: p.fg };
  const mono = p.mono;
  return {
    head: `<style>${css(p, mono)}</style>`,
    body: `<div id="plot"><div class="plot-chart"><canvas id="c"></canvas></div><p class="note" id="note" hidden></p><section class="vars" id="vars" aria-label="Variables" hidden><div class="vars-head"><h2>Variables</h2><button type="button" id="reset">Reset</button></div><div class="vars-grid" id="rows"></div></section></div>`,
    scripts: `<script type="application/json" id="spec">${jsonForScript(content)}</script><script>${chartLib}</script><script>${formulaLib}</script><script>${client(palette, mono)}</script>`,
  };
}
