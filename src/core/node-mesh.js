// The node mesh from the old HUD (copied from the ui-extras branch, src/core/node-mesh.js, itself a port of the HUD's src/main.js): a sphere of
// linked, drifting nodes. One shared simulation drawn into every orb on the page: the big one on the empty-chat page and the small one in the
// chat header.
//
// Kept from the old mesh: 48 nodes on a Fibonacci sphere, the drifting positions, the links, the click shockwave (nodes pushed by distance, a
// front that passes through them, links that light up as it goes, rings), and drag-to-spin with a fling and a tilt that springs back.
// Changed for this app: colours come from the design tokens (teal nodes, grey links), and there is no glow, halo, bloom or gradient.
//
// Moving while JARVIS replies (what the nodes interface does too): the sphere reads the speech and thinking level from mesh-state.js, so it
// swells while the reply streams or is spoken and breathes while the model thinks. On top of that every streamed letter nudges a node
// (feedMesh), so a fast writer opens it wider. Both go through critically damped springs, so nothing jitters.
//
// Cost: one requestAnimationFrame loop, only while an orb is on screen and the tab is visible. The header orb rests (keeps its last picture,
// no loop) a moment after the reply ends and wakes by itself on the next one (setWakeListener in mesh-state.js).
// Reduced motion: no resting spin, no swell, no drift; a drag or a click still moves it and the loop stops once it has settled.

import { MESH_N, MESH_LINK, meshPoints } from './mesh-geometry.js';
import { updateLevel, setWakeListener } from './mesh-state.js';

const N = MESH_N;
const LINK = MESH_LINK;
const SPIN = 0.4;            // rad/s at rest (the old value)
const ROLL = -0.6;           // the big orb turns about an axis leaning this far (rad, about 34 degrees) instead of an upright one
const SPHERE = 0.26;         // sphere radius as a share of the icon's width
const RIPPLE_LIFE = 1.2;     // s
const RIPPLE_SPEED = 2.4;    // sphere radii per second
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const restSpin = () => (calm.matches ? 0 : SPIN);

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
let busyNow = false;         // a reply is being written, thought or spoken
let spin = 0, spinV = restSpin(), letters = 0;
let pitch = 0, pitchV = 0;   // drag tilt: springs back to level
let dragging = false;
let lastPts = [];            // the nodes as drawn last frame (in sphere radii), for the click
const ripples = [];          // { x, y (sphere radii from the centre), t0 (s) }
const LEVEL_K = 80;          // ~0.15 s to settle
const KICK_K = 140;          // letters: critically damped
const ENERGY_TAU = 0.25;     // s: how long writing is remembered
const LETTER = 0.022;        // energy per letter, tuned to real streaming (a local model writes 100 to 250 letters/s)

export function feedMesh(text, weight = 1) {
  if (calm.matches || !text || ![...icons.values()].some((i) => i.visible && !i.frozen)) return; // nothing is animating: nobody to show it to
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
export function dragEnd(heldStill) { dragging = false; if (heldStill) { spinV = restSpin(); pitchV = 0; } }
export const sphereRadius = (size) => size * SPHERE;

function step(dt, t) {
  drain(dt);
  energy *= Math.exp(-dt / ENERGY_TAU);
  const speech = updateLevel(dt, t); // mesh-state.js: the reply streaming or spoken, or the model thinking
  busyNow = speech > 0.03 || energy > 0.03;
  const idle = 0.05 + 0.03 * Math.sin(t * 2.2); // a slow breath so a visible orb is never dead
  const target = calm.matches ? 0 : Math.min(1, Math.max(speech, energy * 0.9) + idle);
  levelV += (LEVEL_K * (target - level) - 2 * Math.sqrt(LEVEL_K) * levelV) * dt;
  level += levelV * dt;
  if (level < 0) level = 0;
  if (!dragging) {
    spinV += (restSpin() * (1 + 0.25 * level) - spinV) * Math.min(1, dt * (calm.matches ? 7 : 1.4)); // a fling decays smoothly to the resting turn (quickly with reduced motion)
    spin += spinV * dt;
    pitchV += (14 * (0 - pitch) - 2 * Math.sqrt(14) * pitchV) * dt; // critically damped back to level
    pitch += pitchV * dt;
  }
  stepReaction(dt, t);
  const c = 2 * Math.sqrt(KICK_K);
  for (const n of nodes) { n.kickV += (-KICK_K * n.kick - c * n.kickV) * dt; n.kick += n.kickV * dt; }
}

// Nothing is moving any more (used with reduced motion, where the loop only runs while a drag or a click settles).
const settled = () => !dragging && !ripples.length && Math.abs(spinV) < 0.01 && Math.abs(pitch) < 0.003 && Math.abs(pitchV) < 0.01
  && level < 0.003 && Math.abs(levelV) < 0.01
  && nodes.every((n) => Math.abs(n.kick) < 0.002 && Math.abs(n.kickV) < 0.01 && Math.abs(n.rip) < 0.002 && Math.abs(n.ripV) < 0.01);

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
// ink: the nodes and the shockwave (the accent). grey: the links at rest (the quiet text colour). Links turn to the accent where the shockwave passes.
let ink = [11, 127, 115], grey = [148, 146, 138], inkAt = -1e9;
const readInk = (now) => { if (now - inkAt < 2000) return; inkAt = now; ink = token('--accent', ink); grey = token('--text-3', grey); };

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
  const m = clamp(scale / 60, 0.45, 1.2);   // dot sizes: the old sizes at the old scale, kept readable when small
  const mw = clamp(scale / 90, 0.5, 1);     // line widths
  const stride = size < 64 ? 2 : 1;         // tiny icons draw every other node: 48 nodes would be mush in 24 px
  ctx.lineCap = 'round';

  // links: one thin pass in grey; links near the shockwave front take the accent and brighten
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
      const a = Math.min(1, fade * (0.15 + 0.85 * depth) * 0.55 * (1 + 0.5 * level + 2.2 * wave));
      ctx.beginPath(); ctx.moveTo(px[i].x, px[i].y); ctx.lineTo(px[j].x, px[j].y);
      ctx.lineWidth = thin; ctx.strokeStyle = rgba(mix(grey, ink, Math.min(1, wave * 1.5)), a); ctx.stroke();
    }
  }

  // nodes: flat discs, size and alpha by depth
  for (let i = 0; i < N; i += stride) {
    const p = px[i], n = nodes[i];
    const beat = (Math.sin(t * n.pulseSpeed + n.phase) + 1) / 2;
    const r = (2 + 1.4 * p.f) * m * (0.85 + 0.3 * beat) * (1 + 0.4 * level + Math.min(1, Math.abs(n.kick + n.rip) * 3));
    ctx.fillStyle = rgba(ink, 0.4 + 0.6 * p.f);
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(r * 0.85, 1), 0, 6.2832); ctx.fill();
  }

  // shockwave rings, one thin line, clipped to the neighbourhood of the sphere
  if (ripples.length) {
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, scale * 1.35, 0, 6.2832); ctx.clip();
    for (const rp of ripples) {
      const age = t - rp.t0, life = 1 - age / RIPPLE_LIFE, R = age * RIPPLE_SPEED * scale;
      if (R < 1) continue;
      ctx.beginPath(); ctx.arc(c + rp.x * scale, c + rp.y * scale, R, 0, 6.2832);
      ctx.lineWidth = Math.max(0.8, 1.5 * mw); ctx.strokeStyle = rgba(ink, 0.7 * life * life); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- icons and the one loop -------------------------------------------------------------------------------------------------------
const icons = new Map();    // canvas -> { ctx, size, visible, keep, restAt, frozen, hero, auto }
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
function paintOnce(icon) {
  readInk(performance.now());
  const pts = view(icon, project(1));
  if (icon.hero) lastPts = pts; // a click on the big orb is placed on what is drawn
  draw(icon.ctx, icon.size, pts, 1);
}
const live = () => { for (const [cv, icon] of icons) if (!cv.isConnected && !icon.keep) { icons.delete(cv); sizes.unobserve(cv); seen.unobserve(cv); } return [...icons.values()].filter((i) => i.visible && i.size && !i.frozen); };

function frame(now) {
  raf = 0;
  if (document.hidden) { last = 0; return; } // a hidden tab draws nothing; the visibilitychange handler restarts the loop
  const on = live();
  if (!on.length) { last = 0; return; } // nothing to show: the loop ends here and the next icon starts it again
  const dt = Math.min((now - (last || now)) / 1000, 0.05);
  last = now;
  const t = now / 1000;
  readInk(now);
  step(dt, t);
  const pts = project(calm.matches ? 1 : t); // with reduced motion the drift stands still
  const rolledPts = on.some((i) => i.hero) ? rolled(pts) : null;
  if (rolledPts) lastPts = rolledPts; // a click on the big orb is placed on what is drawn
  const busy = busyNow || dragging || ripples.length > 0;
  for (const icon of on) {
    draw(icon.ctx, icon.size, icon.hero ? rolledPts : pts, t);
    if (icon.auto) { if (busy) icon.restAt = now + 1200; else if (now > icon.restAt) icon.frozen = true; } // the header orb closes, then keeps its last picture
    else if (icon.restAt && now > icon.restAt && !dragging && !ripples.length && !icon.hero) icon.frozen = true;
  }
  if (calm.matches && settled()) return; // reduced motion: the loop only lives while a drag or a click settles
  raf = requestAnimationFrame(frame);
}
function start() { if (!raf && icons.size && !document.hidden) raf = requestAnimationFrame(frame); }

// A reply began (a streamed chunk, the model thinking, speech): the resting header orb wakes. mesh-state.js calls this.
function wakeAuto() {
  if (document.hidden) return;
  const now = performance.now();
  for (const icon of icons.values()) if (icon.auto && icon.frozen) { icon.frozen = false; icon.restAt = now + 1500; }
  start();
}
setWakeListener(wakeAuto);

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
document.addEventListener('visibilitychange', () => { last = 0; start(); });

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
document.addEventListener('jarvis:theme', () => requestAnimationFrame(repaintResting)); // Settings forced light or dark
new MutationObserver(repaintResting).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

// The orb spots in the page (an element with data-mesh-logo, its look from CSS) become a still picture of the mesh: drawn once, no loop,
// redrawn when the theme changes.
//   data-mesh-logo="hero": plays an intro, reacts to typing, drags and clicks, and never rests while it is on screen (see hero()).
//   data-mesh-logo="auto": rests as a still picture and wakes by itself while JARVIS thinks, writes or speaks.
export function mountLogos(root = document) {
  for (const spot of root.querySelectorAll('[data-mesh-logo]')) {
    const canvas = meshIcon({ keep: true });
    canvas.className = `orb ${spot.className}`.trim();
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', spot.getAttribute('aria-label') ?? 'JARVIS');
    canvas.removeAttribute('aria-hidden');
    spot.replaceWith(canvas);
    restMesh(canvas, true);
    if (spot.dataset.meshLogo === 'hero') hero(canvas, spot.dataset.meshInput);
    else if (spot.dataset.meshLogo === 'auto') icons.get(canvas).auto = true;
  }
}

// The big mesh on the empty-chat page: an intro whenever the page appears, the letters typed in the message box move it, a click sends the old
// HUD's shockwave through it, a drag turns it. It also moves with the reply like every orb (mesh-state.js).
function hero(canvas, inputId = 'hud-chat-input') {
  const icon = icons.get(canvas);
  icon.hero = true;
  canvas.classList.add('hero');
  // a touch moves it: with reduced motion the loop only has to run while it settles
  const wake = (ms) => { if (!icon.visible) return; if (calm.matches) { icon.frozen = false; start(); } else restMesh(canvas, true, ms); };
  document.getElementById(inputId)?.addEventListener('input', (e) => {
    if (!icon.visible || calm.matches) return;
    wake(1400);
    if (e.data) feedMesh(e.data);
    else if (e.inputType === 'insertFromPaste') feedMesh('x'.repeat(24)); // a pasted block arrives whole: the queue drains it at a steady pace
  });
  let press = null;
  const R = () => sphereRadius(icon.size);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
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
