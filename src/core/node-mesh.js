// The node mesh from the old HUD (a sphere of linked, drifting nodes) as the loading icon: one shared simulation, drawn into every
// icon on the page (the "Thinking..." line, the running step, the line under a reply being written).
//
// Reacting to text without jitter: letters are not applied when they arrive. Each chunk goes into a queue, and the queue is drained
// at a steady pace (a burst of 40 letters is spread over ~0.12 s). Every letter drained nudges one node outward on a critically damped
// spring (so no overshoot, no flutter) and adds a little energy; the energy leaks away over ~0.3 s and the sphere's "openness" follows
// it through another critically damped spring. So every letter is felt, a fast writer opens it wide, a pause closes it gently.
//
// Performance: one requestAnimationFrame loop, running only while at least one icon is connected AND on screen (IntersectionObserver);
// icons that were removed or hidden are dropped. Colours come from the design tokens (--accent, --text), read again when the theme changes.

const N = 30;               // nodes: more than this turns to mush at 24 to 32 px
const LINK = 0.8;           // longest link, in sphere radii
const SPIN = 0.5;           // rad/s at rest
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// Fibonacci sphere (even spread, no clumping at the poles) with a fixed drift per node, so the picture is the same on every start.
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const nodes = Array.from({ length: N }, (_, i) => {
  const y = 1 - (i / (N - 1)) * 2;
  const ring = Math.sqrt(1 - y * y);
  const th = i * 2.399963; // golden angle
  const x = Math.cos(th) * ring;
  const z = Math.sin(th) * ring;
  let tx = z, tz = -x;
  const tl = Math.hypot(tx, tz);
  if (tl < 0.01) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
  return { x, y, z, tx, tz, kick: 0, kickV: 0, phase: i * 2.399963, pulseSpeed: 0.45 + (i % 5) * 0.08,
    dAmp: 0.07 + rnd() * 0.07, f1: 0.25 + rnd() * 0.3, f2: 0.6 + rnd() * 0.45, p1: rnd() * 6.2832, p2: rnd() * 6.2832, wAmp: 0.03 + rnd() * 0.04, f3: 0.2 + rnd() * 0.25, p3: rnd() * 6.2832 };
});

// ---- the simulation ---------------------------------------------------------------------------------------------------------------
const queue = [];           // letters waiting to be felt (char codes)
let head = 0;
let energy = 0;             // leaky sum of the letters just written
let level = 0, levelV = 0;  // how open the sphere is, 0..1, through a critically damped spring
let spin = 0, spinV = SPIN, letters = 0;
const LEVEL_K = 80;         // spring stiffness: ~0.15 s to settle
const KICK_K = 140;
const ENERGY_TAU = 0.25;    // s: how long writing is remembered
const LETTER = 0.022;       // energy per letter, tuned to real streaming (a local model writes 100 to 250 letters/s): 160/s is about three quarters open

export function feedMesh(text, weight = 1) {
  if (calm.matches || !text || ![...icons.values()].some((i) => !i.frozen)) return; // nothing is animating: nobody to show it to
  if (queue.length - head > 400) head = queue.length - 400; // a pasted wall of text: only the newest is shown
  for (let i = 0; i < text.length; i++) queue.push(weight < 1 ? -text.charCodeAt(i) : text.charCodeAt(i)); // negative = quieter (reasoning)
  start();
}
// The chat gives the text so far, not the new part: feed only what is new. A shorter text means a new round started.
const lengths = new Map();
export function feedMeshTotal(key, full, weight = 1) {
  const from = Math.min(lengths.get(key) ?? 0, full.length);
  lengths.set(key, full.length);
  if (full.length > from) feedMesh(full.slice(from), weight);
}
export const resetMeshFeed = () => lengths.clear();

function drain(dt) {
  const waiting = queue.length - head;
  if (waiting <= 0) { if (head) { queue.length = 0; head = 0; } return; }
  // steady pace: at least 30 letters/s, and fast enough to clear the queue in ~0.12 s
  const take = Math.min(waiting, Math.max(1, Math.round(Math.max(30, waiting / 0.12) * dt)));
  for (let i = 0; i < take; i++) {
    const raw = queue[head++];
    const quiet = raw < 0;
    const code = Math.abs(raw);
    if (code === 32) { energy += LETTER * 0.3; continue; }                  // a space: barely a beat
    const gain = (code === 10 ? 4 : /[.,;:!?]/.test(String.fromCharCode(code)) ? 1.6 : 1) * (quiet ? 0.5 : 1);
    energy += LETTER * gain;
    const n = nodes[(code * 31 + letters++ * 17) % N];
    n.kickV += 3.2 * gain; // peak outward offset ~0.1 of the radius, over ~0.15 s
  }
  if (energy > 1.6) energy = 1.6;
}

function step(dt, t) {
  drain(dt);
  energy *= Math.exp(-dt / ENERGY_TAU);
  const idle = 0.08 + 0.05 * Math.sin(t * 2.2); // something is working: a slow breath even before the first letter
  const target = Math.min(1, energy * 0.9 + idle);
  levelV += (LEVEL_K * (target - level) - 2 * Math.sqrt(LEVEL_K) * levelV) * dt;
  level += levelV * dt;
  if (level < 0) level = 0;
  spinV += (SPIN * (1 + 0.8 * level) - spinV) * Math.min(1, dt * 1.4);
  spin += spinV * dt;
  const c = 2 * Math.sqrt(KICK_K);
  for (const n of nodes) { n.kickV += (-KICK_K * n.kick - c * n.kickV) * dt; n.kick += n.kickV * dt; }
}

// ---- colours from the tokens ------------------------------------------------------------------------------------------------------
const probe = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
const token = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = v; // the canvas turns any CSS colour (hex, oklch, color-mix) into rgb
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
};
let ink = [0, 0, 0], core = [255, 255, 255], inkAt = -1e9;
const readInk = (now) => { if (now - inkAt < 2000) return; inkAt = now; ink = token('--accent', ink); core = token('--text', core); };

// ---- drawing ----------------------------------------------------------------------------------------------------------------------
function project(t) {
  const cosS = Math.cos(spin), sinS = Math.sin(spin), tilt = 0.32, cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  return nodes.map((n) => {
    const d = Math.sin(t * n.f1 + n.p1) * 0.65 + Math.sin(t * n.f2 + n.p2) * 0.35; // two slow sines: every node drifts on its own
    const r = (1 + n.dAmp * d * (1 + 0.25 * level)) * (1 + 0.3 * level + n.kick);
    const w = n.wAmp * Math.sin(t * n.f3 + n.p3);
    const bx = n.x * r + n.tx * w, by = n.y * r, bz = n.z * r + n.tz * w;
    const x1 = bx * cosS + bz * sinS, z1 = -bx * sinS + bz * cosS;
    return { x: x1, y: by * cosT - z1 * sinT, f: (by * sinT + z1 * cosT + 1.4) / 2.8 }; // f: 0 far side, 1 near side
  });
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
function draw(ctx, size, pts, t) {
  ctx.clearRect(0, 0, size, size);
  const c = size / 2, scale = size * 0.3;
  let g = ctx.createRadialGradient(c, c, 0, c, c, scale * 1.4);
  g.addColorStop(0, rgba(ink, 0.05 + 0.12 * level));
  g.addColorStop(1, rgba(ink, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const px = pts.map((p) => ({ x: c + p.x * scale, y: c + p.y * scale, f: p.f }));
  ctx.lineWidth = Math.max(0.7, size / 34);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) / scale;
      if (d >= LINK) continue;
      const k = 1 - d / LINK;
      const a = Math.min(1, k * k * (3 - 2 * k) * (0.2 + 0.8 * (px[i].f + px[j].f) / 2) * 1.1 * (1 + 0.7 * level));
      ctx.strokeStyle = rgba(ink, a);
      ctx.beginPath(); ctx.moveTo(px[i].x, px[i].y); ctx.lineTo(px[j].x, px[j].y); ctx.stroke();
    }
  }
  for (let i = 0; i < N; i++) {
    const p = px[i], n = nodes[i];
    const beat = (Math.sin(t * n.pulseSpeed + n.phase) + 1) / 2;
    const r = (size / 30) * (0.6 + 0.9 * p.f) * (0.85 + 0.3 * beat) * (1 + 0.5 * level + Math.min(1, Math.abs(n.kick) * 3));
    g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
    g.addColorStop(0, rgba(ink, 0.12 + 0.3 * p.f));
    g.addColorStop(1, rgba(ink, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, 6.2832); ctx.fill();
    ctx.fillStyle = rgba(core, 0.45 + 0.55 * p.f);
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.75, 0, 6.2832); ctx.fill();
  }
}

// ---- icons and the one loop -------------------------------------------------------------------------------------------------------
const icons = new Map();    // canvas -> { ctx, size, visible }
let raf = 0, last = 0;
const sizes = new ResizeObserver((entries) => {
  for (const e of entries) {
    const icon = icons.get(e.target);
    if (!icon) continue;
    const size = Math.round(e.contentRect.width);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (!size || size === icon.size) continue;
    icon.size = size;
    e.target.width = e.target.height = Math.round(size * dpr);
    icon.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (calm.matches || icon.frozen) paintOnce(icon);
  }
});
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) { const icon = icons.get(e.target); if (icon) icon.visible = e.isIntersecting; }
  start();
});

function paintOnce(icon) { readInk(performance.now()); draw(icon.ctx, icon.size, project(1), 1); }
const live = () => { for (const [cv, icon] of icons) if (!cv.isConnected && !icon.keep) { icons.delete(cv); sizes.unobserve(cv); seen.unobserve(cv); } return [...icons.values()].filter((i) => i.visible && i.size && !i.frozen); };

function frame(now) {
  raf = 0;
  const on = live();
  if (!on.length) { last = 0; return; } // nothing to show: the loop ends here and the next icon starts it again
  const dt = Math.min((now - (last || now)) / 1000, 0.05);
  last = now;
  const t = now / 1000;
  readInk(now);
  step(dt, t);
  const pts = project(t);
  for (const icon of on) { draw(icon.ctx, icon.size, pts, t); if (icon.restAt && now > icon.restAt) icon.frozen = true; } // the last frame drawn stays as it is
  raf = requestAnimationFrame(frame);
}
function start() { if (!raf && !calm.matches && icons.size) raf = requestAnimationFrame(frame); }

// A new icon. Give it the class "orb" for its size (CSS --orb-size); it removes itself from the loop when it leaves the page, unless
// keep is set (an icon that is moved around the page and put back).
export function meshIcon({ keep = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'orb';
  canvas.setAttribute('aria-hidden', 'true');
  icons.set(canvas, { ctx: canvas.getContext('2d'), size: 0, visible: false, keep, restAt: 0, frozen: false });
  sizes.observe(canvas);
  seen.observe(canvas);
  return canvas;
}

calm.addEventListener('change', () => { if (calm.matches) { cancelAnimationFrame(raf); raf = 0; queue.length = 0; head = 0; for (const i of icons.values()) if (i.size) paintOnce(i); } else start(); });

export const meshLevel = () => level; // how open the sphere is now (for tests)

// Rest: on = the icon closes gently, then keeps its last picture and costs nothing (no loop). off = it moves again.
export function restMesh(canvas, on) {
  const icon = icons.get(canvas);
  if (!icon) return;
  icon.frozen = false;
  icon.restAt = on ? performance.now() + 900 : 0;
  if (on && (calm.matches || !icon.size)) { icon.frozen = true; if (icon.size) paintOnce(icon); return; }
  start();
}

// A resting icon is a picture: redraw it when the theme changes.
const repaintResting = () => { inkAt = -1e9; for (const i of icons.values()) if (i.frozen && i.size) paintOnce(i); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaintResting);
new MutationObserver(repaintResting).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
