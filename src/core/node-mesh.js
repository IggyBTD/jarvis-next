// The node mesh from the old HUD (C:\Users\bethe\Projects\JARVIS\src\main.js): a sphere of linked, drifting nodes, ported as the logo and the
// loading icon. One shared simulation, drawn into every icon on the page (the big one on the empty-chat page, the logos, the running step,
// the stamp under the newest reply).
//
// What is ported unchanged from the old HUD: 48 nodes on a Fibonacci sphere, the drifting positions, the two-pass links (a wide faint line and
// a thin bright one), the node halos, the centre glow, the click shockwave (nodes pushed by distance, a front that passes through them, links that
// light up as it goes, a bloom at the press point and rings), and the drag-to-spin with a fling and a tilt that springs back.
// What is different: colours come from the design tokens, the dots are a little bluer, the sphere is a little smaller, and it does not run
// forever: a loop runs only while something is moving, then the last picture stays.
//
// Reacting to text without jitter: letters are queued and drained at a steady pace; each letter nudges one node on a critically damped spring
// (no overshoot) and adds a little energy that leaks away over ~0.25 s; the sphere's openness follows the energy through another critically
// damped spring. Every letter is felt, a fast writer opens it wide, a pause closes it gently.
//
// Performance: one requestAnimationFrame loop, only while at least one icon is connected, on screen (IntersectionObserver) and not resting.

import { MESH_N, MESH_LINK, meshPoints } from './mesh-geometry.js';

const N = MESH_N;
const LINK = MESH_LINK;
const SPIN = 0.4;            // rad/s at rest (the old value)
const ROLL = -0.6;           // the big logo on the new-chat page turns about an axis leaning this far (rad, about 34 degrees) instead of an upright one
const SPHERE = 0.26;         // sphere radius as a share of the icon's width (a little smaller than before)
const RIPPLE_LIFE = 1.2;     // s
const RIPPLE_SPEED = 2.4;    // sphere radii per second
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The nodes (mesh-geometry.js) with a fixed drift each, so the picture is the same on every start (the old HUD used Math.random).
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const nodes = meshPoints().map((p, i) => ({ ...p, kick: 0, kickV: 0, rip: 0, ripV: 0, phase: i * 2.399963, pulseSpeed: 0.45 + (i % 5) * 0.08,
  dAmp: 0.07 + rnd() * 0.07, f1: 0.25 + rnd() * 0.3, f2: 0.6 + rnd() * 0.45, p1: rnd() * 6.2832, p2: rnd() * 6.2832, wAmp: 0.03 + rnd() * 0.04, f3: 0.2 + rnd() * 0.25, p3: rnd() * 6.2832 }));

// ---- the simulation ---------------------------------------------------------------------------------------------------------------
const queue = [];            // letters waiting to be felt (char codes)
let head = 0;
let energy = 0;              // leaky sum of the letters just written
let level = 0, levelV = 0;   // how open the sphere is, 0..1
let spin = 0, spinV = SPIN, letters = 0;
let pitch = 0, pitchV = 0;   // drag tilt: springs back to level
let dragging = false;
let lastPts = [];            // the nodes as drawn last frame (in sphere radii), for the click
const ripples = [];          // { x, y (sphere radii from the centre), t0 (s) }
const LEVEL_K = 80;          // ~0.15 s to settle
const KICK_K = 140;          // letters: critically damped
const ENERGY_TAU = 0.25;     // s: how long writing is remembered
const LETTER = 0.022;        // energy per letter, tuned to real streaming (a local model writes 100 to 250 letters/s)

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
  const take = Math.min(waiting, Math.max(1, Math.round(Math.max(30, waiting / 0.12) * dt))); // at least 30 letters/s, the queue cleared in ~0.12 s
  for (let i = 0; i < take; i++) {
    const raw = queue[head++];
    const quiet = raw < 0;
    const code = Math.abs(raw);
    if (code === 32) { energy += LETTER * 0.3; continue; } // a space: barely a beat
    const gain = (code === 10 ? 4 : /[.,;:!?]/.test(String.fromCharCode(code)) ? 1.6 : 1) * (quiet ? 0.5 : 1);
    energy += LETTER * gain;
    nodes[(code * 31 + letters++ * 17) % N].kickV += 3.2 * gain;
  }
  if (energy > 1.6) energy = 1.6;
}

// The old HUD's click reaction. A press pushes the nodes near it outward; a front then runs out from the press and pushes each node it passes;
// the nodes spring (underdamped: they overshoot once or twice, then settle).
export function rippleAt(x, y) {
  ripples.push({ x, y, t0: performance.now() / 1000 });
  if (ripples.length > 5) ripples.shift();
  for (let i = 0; i < nodes.length && i < lastPts.length; i++) {
    const p = lastPts[i];
    nodes[i].ripV += 3.4 * Math.exp(-(((p.x - x) ** 2) + ((p.y - y) ** 2)) / 0.3) * (0.4 + 0.6 * p.f);
  }
  start();
}
function stepReaction(dt, t) {
  for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].t0 > RIPPLE_LIFE) ripples.splice(i, 1);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], p = lastPts[i];
    if (p) for (const rp of ripples) {
      const age = t - rp.t0;
      const d = Math.hypot(p.x - rp.x, p.y - rp.y);
      const front = age * RIPPLE_SPEED;
      if (d <= front && d > front - RIPPLE_SPEED * dt) n.ripV += 1.8 * (1 - age / RIPPLE_LIFE) * (0.4 + 0.6 * p.f);
    }
    n.ripV += (-90 * n.rip - 6 * n.ripV) * dt;
    n.rip += n.ripV * dt;
  }
}

// Dragging (the old HUD): the sphere turns with the pointer, keeps its swing on release, and tips with the pointer's up and down, then levels.
export function dragStart() { dragging = true; spinV = 0; }
export function dragMove(dx, dy, dt, radius) {
  spin += dx / radius;
  spinV += (clamp(dx / radius / dt, -14, 14) - spinV) * 0.4;
  pitch = clamp(pitch - dy / radius, -1, 1);
  pitchV = clamp(-dy / radius / dt, -6, 6) * 0.5;
}
export function dragEnd(heldStill) { dragging = false; if (heldStill) { spinV = SPIN; pitchV = 0; } }
export const sphereRadius = (size) => size * SPHERE;

function step(dt, t) {
  drain(dt);
  energy *= Math.exp(-dt / ENERGY_TAU);
  const idle = 0.08 + 0.05 * Math.sin(t * 2.2); // something is working: a slow breath even before the first letter
  const target = Math.min(1, energy * 0.9 + idle);
  levelV += (LEVEL_K * (target - level) - 2 * Math.sqrt(LEVEL_K) * levelV) * dt;
  level += levelV * dt;
  if (level < 0) level = 0;
  if (!dragging) {
    spinV += (SPIN * (1 + 0.25 * level) - spinV) * Math.min(1, dt * 1.4); // a fling decays smoothly to the resting turn
    spin += spinV * dt;
    pitchV += (14 * (0 - pitch) - 2 * Math.sqrt(14) * pitchV) * dt; // critically damped back to level
    pitch += pitchV * dt;
  }
  stepReaction(dt, t);
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
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
// ink: halos and links (the accent). core: the dot itself, the accent with a little of the text colour (the old HUD's were nearly white; these are bluer).
// bright: the thin link and the click bloom.
let ink = [56, 189, 248], core = [150, 215, 250], bright = [150, 215, 250], inkAt = -1e9;
const readInk = (now) => { if (now - inkAt < 2000) return; inkAt = now; const text = token('--text', [255, 255, 255]); ink = token('--accent', ink); core = mix(ink, text, 0.3); bright = mix(ink, text, 0.5); };

// ---- drawing ----------------------------------------------------------------------------------------------------------------------
function project(t) {
  const cosS = Math.cos(spin), sinS = Math.sin(spin), cosT = Math.cos(pitch), sinT = Math.sin(pitch);
  lastPts = nodes.map((n) => {
    // two incommensurate sines push each node radially and one slow sine wobbles it sideways: no two nodes move alike, so the web breathes
    const d = Math.sin(t * n.f1 + n.p1) * 0.65 + Math.sin(t * n.f2 + n.p2) * 0.35;
    const r = (1 + n.dAmp * d * (1 + 0.25 * level)) * (1 + 0.3 * level + n.kick + n.rip);
    const w = n.wAmp * Math.sin(t * n.f3 + n.p3);
    const bx = n.x * r + n.tx * w, by = n.y * r, bz = n.z * r + n.tz * w;
    const x1 = bx * cosS + bz * sinS, z1 = -bx * sinS + bz * cosS;
    return { x: x1, y: by * cosT - z1 * sinT, f: (by * sinT + z1 * cosT + 1) / 2 }; // f: 0 far side, 1 near side
  });
  return lastPts;
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, a).toFixed(3)})`;
function draw(ctx, size, pts, t) {
  ctx.clearRect(0, 0, size, size);
  const c = size / 2, scale = size * (size < 40 ? 0.36 : SPHERE); // a small icon gives the sphere more of its room, or the links turn to a blob
  const m = clamp(scale / 60, 0.45, 1.2);   // dots and glow: the old sizes at the old scale, kept readable when small
  const mw = clamp(scale / 90, 0.5, 1);     // line widths
  const stride = size < 64 ? 2 : 1;         // tiny icons draw every other node: 48 nodes would be mush in 24 px
  const breath = (Math.sin(t * 0.5) + 1) / 2;

  // centre glow
  const glowR = scale * 1.1 * (1 + 0.25 * level);
  let g = ctx.createRadialGradient(c, c, 0, c, c, glowR);
  g.addColorStop(0, rgba(ink, (0.1 + breath * 0.05 + level * 0.1) * (size < 40 ? 0.5 : 1)));
  g.addColorStop(0.35, rgba(ink, 0.05));
  g.addColorStop(1, rgba(ink, 0));
  ctx.fillStyle = g;
  ctx.fillRect(c - glowR * 1.1, c - glowR * 1.1, glowR * 2.2, glowR * 2.2);

  // click bloom at the press point
  for (const rp of ripples) {
    const age = t - rp.t0;
    if (age > 0.4) continue;
    const fx = c + rp.x * scale, fy = c + rp.y * scale, fr = scale * 0.55;
    g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    g.addColorStop(0, rgba(bright, 0.35 * (1 - age / 0.4)));
    g.addColorStop(1, rgba(ink, 0));
    ctx.fillStyle = g;
    ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }

  // links: a wide faint pass and a thin bright pass (soft energy, no shadowBlur); links near the shockwave front light up
  const px = pts.map((p) => ({ x: c + p.x * scale, y: c + p.y * scale, f: p.f, ux: p.x, uy: p.y }));
  const thin = Math.max(0.7, mw);
  for (let i = 0; i < N; i += stride) {
    for (let j = i + stride; j < N; j += stride) {
      const d = Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) / scale;
      if (d >= LINK) continue;
      const k = 1 - d / LINK;
      const fade = k * k * (3 - 2 * k); // smoothstep falloff
      const depth = (px[i].f + px[j].f) / 2;
      let wave = 0;
      for (const rp of ripples) {
        const age = t - rp.t0;
        const dm = Math.hypot((px[i].ux + px[j].ux) / 2 - rp.x, (px[i].uy + px[j].uy) / 2 - rp.y);
        const e = (dm - age * RIPPLE_SPEED) / 0.3;
        wave += Math.exp(-e * e) * (1 - age / RIPPLE_LIFE);
      }
      const a = Math.min(1, fade * (0.15 + 0.85 * depth) * 0.5 * (1 + 0.5 * level + 2.2 * wave));
      ctx.beginPath(); ctx.moveTo(px[i].x, px[i].y); ctx.lineTo(px[j].x, px[j].y);
      ctx.lineWidth = thin * 3; ctx.strokeStyle = rgba(ink, a * 0.3); ctx.stroke();
      ctx.lineWidth = thin; ctx.strokeStyle = rgba(bright, a); ctx.stroke();
    }
  }

  // nodes: a radial halo and a bright core, size and alpha by depth
  for (let i = 0; i < N; i += stride) {
    const p = px[i], n = nodes[i];
    const beat = (Math.sin(t * n.pulseSpeed + n.phase) + 1) / 2;
    const r = (2 + 1.4 * p.f) * m * (0.85 + 0.3 * beat) * (1 + 0.4 * level + Math.min(1, Math.abs(n.kick + n.rip) * 3));
    const small = size < 40; // 24 dots in a 9 px sphere: smaller, fainter halos or they run into one ball
    const haloR = small ? Math.max(r * 2.2, 1.8) : Math.max(r * 4, 2.4);
    g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
    g.addColorStop(0, rgba(ink, (0.3 + 0.4 * p.f) * (small ? 0.55 : 1)));
    g.addColorStop(1, rgba(ink, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, haloR, 0, 6.2832); ctx.fill();
    ctx.fillStyle = rgba(core, 0.4 + 0.6 * p.f);
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(r * 0.55, 0.8), 0, 6.2832); ctx.fill();
  }

  // shockwave rings, clipped to the neighbourhood of the sphere
  if (ripples.length) {
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, scale * 1.35, 0, 6.2832); ctx.clip();
    for (const rp of ripples) {
      const age = t - rp.t0, life = 1 - age / RIPPLE_LIFE, R = age * RIPPLE_SPEED * scale;
      if (R < 1) continue;
      ctx.beginPath(); ctx.arc(c + rp.x * scale, c + rp.y * scale, R, 0, 6.2832);
      ctx.lineWidth = 5 * mw; ctx.strokeStyle = rgba(ink, 0.12 * life); ctx.stroke();
      ctx.lineWidth = Math.max(0.8, 1.5 * mw); ctx.strokeStyle = rgba(bright, 0.85 * life * life); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- icons and the one loop -------------------------------------------------------------------------------------------------------
const icons = new Map();    // canvas -> { ctx, size, visible, keep, restAt, frozen, hero }
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
  for (const e of entries) { const icon = icons.get(e.target); if (icon) { icon.visible = e.isIntersecting; if (icon.hero && e.isIntersecting && !calm.matches) { icon.frozen = false; icon.restAt = performance.now() + 2600; } } } // the hero's short intro
  start();
});

// the hero icon is drawn with the whole sphere rolled, so its steady turn is about a diagonal axis
const rolled = (pts) => { const c = Math.cos(ROLL), s = Math.sin(ROLL); return pts.map((p) => ({ ...p, x: p.x * c - p.y * s, y: p.x * s + p.y * c })); };
const view = (icon, pts) => (icon.hero ? rolled(pts) : pts);
function paintOnce(icon) { readInk(performance.now()); draw(icon.ctx, icon.size, view(icon, project(1)), 1); }
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
  const rolledPts = on.some((i) => i.hero) ? rolled(pts) : null;
  if (rolledPts) lastPts = rolledPts; // a click on the big logo is placed on what is drawn
  // ponytail: the hero never freezes while it is on screen (the loop ends when the page is hidden or with reduced motion); the others rest as before
  for (const icon of on) { draw(icon.ctx, icon.size, icon.hero ? rolledPts : pts, t); if (icon.restAt && now > icon.restAt && !dragging && !ripples.length && !icon.hero) icon.frozen = true; } // the last frame drawn stays as it is
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
export function restMesh(canvas, on, ms = 900) {
  const icon = icons.get(canvas);
  if (!icon) return;
  icon.frozen = false;
  icon.restAt = on ? performance.now() + ms : 0;
  if (on && (calm.matches || !icon.size)) { icon.frozen = true; if (icon.size) paintOnce(icon); return; }
  start();
}

// A resting icon is a picture: redraw it when the theme changes.
const repaintResting = () => { inkAt = -1e9; for (const i of icons.values()) if (i.frozen && i.size) paintOnce(i); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaintResting);
new MutationObserver(repaintResting).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

// The logo spots in the page (an element with data-mesh-logo, its look from CSS) become a still picture of the mesh: drawn once, no loop,
// redrawn when the theme changes. data-mesh-logo="hero" also plays an intro and reacts (see hero()).
export function mountLogos(root = document) {
  for (const spot of root.querySelectorAll('[data-mesh-logo]')) {
    const canvas = meshIcon({ keep: true });
    canvas.className = `orb ${spot.className}`.trim();
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', spot.getAttribute('aria-label') ?? 'JARVIS');
    spot.replaceWith(canvas);
    restMesh(canvas, true);
    if (spot.dataset.meshLogo === 'hero') hero(canvas, spot.dataset.meshInput);
  }
}

// The big mesh on the empty-chat page: an intro whenever the page appears, the letters typed in the message box move it, a click sends the old
// HUD's shockwave through it, a drag turns it, then it settles to a still picture. It never runs on its own beyond that.
function hero(canvas, inputId = 'hud-chat-input') {
  const icon = icons.get(canvas);
  icon.hero = true;
  canvas.classList.add('hero');
  const wake = (ms) => { if (!calm.matches && icon.visible) restMesh(canvas, true, ms); };
  document.getElementById(inputId)?.addEventListener('input', (e) => {
    if (!icon.visible || calm.matches) return;
    wake(1400);
    if (e.data) feedMesh(e.data);
    else if (e.inputType === 'insertFromPaste') feedMesh('x'.repeat(24)); // a pasted block arrives whole: the queue drains it at a steady pace
  });
  let press = null;
  const R = () => sphereRadius(icon.size);
  canvas.addEventListener('pointerdown', (e) => {
    if (calm.matches || e.button !== 0) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, down: performance.now(), last: performance.now(), dragging: false };
    canvas.setPointerCapture(e.pointerId);
    wake(2000);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    press.x = e.clientX; press.y = e.clientY;
    const before = press.moved;
    press.moved += Math.hypot(dx, dy);
    if (press.moved < 5) return; // under 5 px it is still a click
    if (before < 5) { dragStart(); press.dragging = true; } // a real drag begins
    const now = performance.now();
    dragMove(dx, dy, Math.max((now - press.last) / 1000, 0.004), R());
    press.last = now;
    wake(2000);
  });
  const end = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const now = performance.now();
    if (e.type === 'pointerup' && press.moved < 5 && now - press.down < 400) {
      const r = canvas.getBoundingClientRect();
      rippleAt((e.clientX - r.left - r.width / 2) / R(), (e.clientY - r.top - r.height / 2) / R());
    }
    if (press.dragging) dragEnd(now - press.last > 80); // held still before letting go: no fling
    press = null;
    wake(2000);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
