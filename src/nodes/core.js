// The JARVIS core: a ball-and-stick cage of atoms on a Fibonacci sphere, bonded to their nearest
// neighbours. Drawn flat (no gradients): each atom is a disc with a darker rim and a small highlight
// crescent, bonds are round-capped rods, and depth only changes size and tone. It reads the same
// speech and thinking level the old HUD mesh did (mesh-state.js), so it swells while JARVIS streams
// or speaks and breathes while it thinks. Drag spins it; a click knocks the atoms nearest the
// pointer outward on a spring. One animation loop drives every core on the page and stops when
// none is visible. Reduced motion: no idle spin and no swell; a drag still turns it.
import { updateLevel } from '../core/mesh-state.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const cores = new Set();
let frame = 0;
let last = 0;
let level = 0;

function sphere(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = GOLDEN * i;
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
  }
  return pts;
}

// Each atom bonds to its k nearest neighbours; duplicates are dropped.
function bonds(pts, k) {
  const seen = new Set();
  const out = [];
  pts.forEach((p, i) => {
    pts.map((q, j) => [j, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2])
      .filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, k)
      .forEach(([j]) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) { seen.add(key); out.push([Math.min(i, j), Math.max(i, j)]); }
      });
  });
  return out;
}

// Colours come from CSS custom properties on the canvas, so the theme owns them.
function readColours(canvas) {
  const s = getComputedStyle(canvas);
  const v = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
  return {
    front: v('--core-atom', '#0a8a7c'),
    rim: v('--core-rim', '#06594f'),
    back: v('--core-back', '#a9b5b3'),
    backRim: v('--core-back-rim', '#8a9896'),
    rod: v('--core-rod', '#9aa8a6'),
    shine: v('--core-shine', 'rgba(255,255,255,0.55)'),
    ground: v('--core-ground', '#f2f5f4'),
  };
}

// Mix two #rrggbb colours; t = 0 gives a, 1 gives b.
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return t < 0.5 ? a : b;
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * t)).join(',')})`;
}

export function createCore(canvas, { atoms = 48, neighbours = 3, size = 200, interactive = true, atomScale = 1 } = {}) {
  const pts = sphere(atoms);
  const links = bonds(pts, neighbours);
  const kick = new Float32Array(atoms);
  const kickV = new Float32Array(atoms);
  const ctx = canvas.getContext('2d');
  let colours = readColours(canvas);
  let yaw = 0.6;
  let pitch = 0.32;
  let spin = 0;       // extra yaw velocity from a drag, decays
  let tilt = 0;       // pitch velocity from a drag
  let dragging = null;
  let visible = true;
  let px = size;

  function resize(next = size) {
    size = next;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    px = size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now() / 1000);
  }

  function project(t) {
    const breathe = reduced.matches ? 0 : 0.012 * Math.sin(t * 1.1);
    const R = px * 0.34 * (1 + breathe + (reduced.matches ? 0 : level * 0.16));
    const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
    return pts.map(([x, y, z], i) => {
      const wobble = reduced.matches ? 0 : level * 0.05 * Math.sin(t * 6 + i * 1.7);
      const k = 1 + kick[i] + wobble;
      const x1 = (x * cy + z * sy) * k;           // turn about the vertical axis (yaw)...
      const z1 = (-x * sy + z * cy) * k;
      const y2 = y * k * cp - z1 * sp;            // ...then tilt towards the viewer (pitch)
      const z2 = y * k * sp + z1 * cp;
      const f = 3.4 / (3.4 - z2);                 // gentle perspective
      return { i, x: px / 2 + x1 * R * f, y: px / 2 + y2 * R * f, z: z2, f };
    });
  }

  function draw(t) {
    const P = project(t);
    ctx.clearRect(0, 0, px, px);
    const items = [
      ...links.map(([a, b]) => ({ kind: 'bond', z: (P[a].z + P[b].z) / 2, a: P[a], b: P[b] })),
      ...P.map((p) => ({ kind: 'atom', z: p.z, p })),
    ].sort((m, n) => m.z - n.z);
    const base = px * 0.034 * atomScale;
    for (const it of items) {
      const depth = (it.z + 1) / 2; // 0 back, 1 front
      const step = Math.round(depth * 4) / 4; // flat tone steps, not a ramp
      if (it.kind === 'bond') {
        ctx.strokeStyle = mix(colours.ground, colours.rod, 0.35 + 0.65 * step);
        ctx.lineWidth = Math.max(1, px * 0.0075 * atomScale * ((it.a.f + it.b.f) / 2));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(it.a.x, it.a.y);
        ctx.lineTo(it.b.x, it.b.y);
        ctx.stroke();
        continue;
      }
      const { p } = it;
      const r = Math.max(1.2, base * p.f * (0.7 + 0.3 * depth));
      const front = step >= 0.5;
      ctx.fillStyle = front ? mix(colours.back, colours.front, (step - 0.5) * 2 * 0.5 + 0.5) : mix(colours.ground, colours.back, 0.45 + step);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(0.75, r * 0.22);
      ctx.strokeStyle = front ? colours.rim : colours.backRim;
      ctx.stroke();
      if (front && r > 2.5) { // the highlight crescent: a short arc on the upper left
        ctx.strokeStyle = colours.shine;
        ctx.lineWidth = Math.max(0.75, r * 0.24);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.55, Math.PI * 1.05, Math.PI * 1.55);
        ctx.stroke();
      }
    }
  }

  function step(dt, t) {
    if (!dragging) {
      yaw += (reduced.matches ? 0 : 0.14) * dt + spin * dt;
      spin *= Math.exp(-dt * 2.2);
      pitch += tilt * dt;
      tilt *= Math.exp(-dt * 2.2);
      pitch += (0.32 - pitch) * Math.min(1, dt * 0.8);
    }
    for (let i = 0; i < atoms; i++) { // spring back after a click
      kickV[i] += (-60 * kick[i] - 8 * kickV[i]) * dt;
      kick[i] += kickV[i] * dt;
    }
    draw(t);
  }

  function nearest(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * px;
    const y = ((e.clientY - r.top) / r.height) * px;
    return project(performance.now() / 1000).filter((p) => p.z > -0.2)
      .map((p) => [p.i, (p.x - x) ** 2 + (p.y - y) ** 2]).sort((a, b) => a[1] - b[1]);
  }

  if (interactive) {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragging = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragging.x;
      const dy = e.clientY - dragging.y;
      const dt = Math.max(1, performance.now() - dragging.t) / 1000;
      yaw += dx * 0.012;
      pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.01));
      spin = (dx * 0.012) / dt;
      tilt = (dy * 0.01) / dt;
      dragging = { x: e.clientX, y: e.clientY, t: performance.now(), moved: dragging.moved + Math.abs(dx) + Math.abs(dy) };
      if (!frame) draw(performance.now() / 1000);
    });
    const end = (e) => {
      if (!dragging) return;
      if (dragging.moved < 4 && e.type === 'pointerup') {
        nearest(e).slice(0, 4).forEach(([i], n) => { kickV[i] += n === 0 ? 2.4 : 1.2; });
      }
      dragging = null;
      wake();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); });
  io.observe(canvas);
  const core = {
    step,
    get live() { return visible && canvas.isConnected && canvas.offsetParent !== null; },
    // With reduced motion a core only needs frames while a drag or a click is settling.
    get settled() {
      return reduced.matches && !dragging && Math.abs(spin) < 0.01 && Math.abs(tilt) < 0.01
        && kickV.every((v) => Math.abs(v) < 0.01) && kick.every((v) => Math.abs(v) < 0.002);
    },
    resize,
    recolour() { colours = readColours(canvas); draw(performance.now() / 1000); },
  };
  cores.add(core);
  resize(size);
  wake();
  return core;
}

function tick(now) {
  frame = 0;
  const t = now / 1000;
  const dt = Math.min(0.05, last ? t - last : 0.016);
  last = t;
  level = updateLevel(dt, t);
  const live = [...cores].filter((c) => c.live);
  live.forEach((c) => c.step(dt, t));
  // Keep going while something is on screen; a reduced-motion core only moves while it settles.
  if (live.some((c) => !c.settled) && !document.hidden) frame = requestAnimationFrame(tick);
  else last = 0;
}

export function wake() {
  if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
}

document.addEventListener('visibilitychange', wake);
const recolourAll = () => cores.forEach((c) => c.recolour());
document.addEventListener('jarvis:theme', () => requestAnimationFrame(recolourAll));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(recolourAll));
reduced.addEventListener('change', wake);
