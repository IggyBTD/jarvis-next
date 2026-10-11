// The OSINT tab: a 3D globe with aircraft and ships drawn as icons that glide along their course.
//   Aircraft: OpenSky (through the sidecar). Only the airlines in config/osint-watch.json unless "Only my list" is off.
//   Ships: aisstream.io (a free key, a websocket straight from the page). Tankers are the vessels whose AIS type is 80 to 89;
//          the companies in config/osint-watch.json are matched by name, number or destination (AIS never says who owns a ship).
// Icons are three instanced meshes (planes, tankers, boats), one draw call each, lying flat on the globe and turned to their heading.
// Between position reports every icon is moved along its speed and course once a second (dead reckoning, geo.js), so the
// map is alive without asking for anything. The globe is only drawn while you move it or something moved: when nothing
// does, the render loop is asleep.
import * as THREE from 'three';
import { aircraft as fetchAircraft, osintLogin, osintLoginStatus, osintWatch } from './browser-client.js';
import { activeIntelTab } from './intel-tabs.js';
import { advance, iconBasis } from './geo.js';

const $ = (id) => document.getElementById(id);
const host = $('osint-map');
const status = $('osint-status');
const KEY_STORE = 'jarvis.ais.key';
const KNOT = 0.514444; // metres a second
const GLOBE_R = 100;
const CAP = { plane: 20000, tanker: 20000, boat: 45000 };
const VESSEL_CAP = 60000;

let globe = null;
let loading = null;
let watch = { airlines: [], companies: [] };
let air = []; // { lat, lng, alt, track, icao, call, country, speed (m/s), airline, t0 (ms) }
let airTime = 0;
let airMeta = { count: 0, total: 0, credits: null, authed: false, refreshSec: 900, error: '' };
const vessels = new Map(); // mmsi -> { lat, lng, sog, cog, name, t0, type, dest, length, draught, imo, company, why }
let onlyMine = true;
let airOn = true;
let tankOn = true;
let seaOn = true;
let socket = null;
let timers = [];
let renderedBy = '';
let colours = {};
let sleepTimer = 0;
let meshes = null;
let sizeScale = 1;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const say = (text) => { status.textContent = text; };
const fmt = (n) => n.toLocaleString('en-US');

// --- draw on demand --------------------------------------------------------------------------------
const readColours = () => { colours = { accent: css('--accent'), warm: css('--warm'), cap: css('--surface-3'), line: css('--border-strong'), sphere: css('--surface-1'), ship: css('--text-2') }; };
let waking = false;
let drawn = 0; // frames drawn so far
function wake(ms = 500) {
  if (!globe || waking || activeIntelTab() !== 'osint' || document.hidden) return;
  waking = true; // starting the loop draws a frame, which can announce a change, which would start the loop again
  try { globe.resumeAnimation(); } finally { waking = false; }
  clearTimeout(sleepTimer);
  const mark = drawn;
  const check = () => { if (drawn - mark < 3) sleepTimer = setTimeout(check, 60); else globe?.pauseAnimation(); }; // never stop before the last change is on screen
  sleepTimer = setTimeout(check, ms);
}
const rest = () => { clearTimeout(sleepTimer); globe?.pauseAnimation(); };

// --- icons ---------------------------------------------------------------------------------------------
// Each icon is drawn once on a canvas in white with a dark outline; the instance colour tints the white.
function iconTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const stroked = (g, path, fill = '#fff') => { g.fillStyle = fill; g.strokeStyle = 'rgba(8, 12, 18, 0.92)'; g.lineWidth = 7; g.stroke(path); g.fill(path); };
const SHAPES = {
  // 100 by 100, nose up
  plane: () => iconTexture(128, 128, (g, w, h) => {
    g.scale(w / 100, h / 100);
    stroked(g, new Path2D('M50 3 L56 28 L96 54 L96 63 L56 52 L54 80 L67 89 L67 95 L50 91 L33 95 L33 89 L46 80 L44 52 L4 63 L4 54 L44 28 Z'));
  }),
  // 100 by 250, bow up, deckhouse at the stern, cargo hatches along the deck
  tanker: () => iconTexture(64, 160, (g, w, h) => {
    g.scale(w / 100, h / 250);
    stroked(g, new Path2D('M50 4 C78 34 84 72 84 112 L84 238 Q84 248 74 248 L26 248 Q16 248 16 238 L16 112 C16 72 22 34 50 4 Z'));
    g.fillStyle = 'rgba(8, 12, 18, 0.55)';
    [78, 108, 138, 168].forEach((y) => g.fillRect(34, y, 32, 22));
    g.fillStyle = 'rgba(8, 12, 18, 0.9)';
    g.fillRect(26, 204, 48, 34);
  }),
  // 100 by 140
  boat: () => iconTexture(64, 90, (g, w, h) => {
    g.scale(w / 100, h / 140);
    stroked(g, new Path2D('M50 4 C74 28 80 56 80 86 L80 132 L20 132 L20 86 C20 56 26 28 50 4 Z'));
    g.fillStyle = 'rgba(8, 12, 18, 0.85)';
    g.fillRect(34, 84, 32, 28);
  }),
};
// width and length in globe units (the globe's radius is 100, about 300 px on screen at the start)
const SIZE = { plane: [6.4, 6.4], tanker: [3.4, 8.6], boat: [2.6, 5.6] };
const ALT = { plane: 0.018, tanker: 0.009, boat: 0.008 };

function buildMeshes() {
  const out = {};
  for (const kind of Object.keys(SHAPES)) {
    const mat = new THREE.MeshBasicMaterial({ map: SHAPES[kind](), transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, CAP[kind]);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP[kind] * 3).fill(1), 3);
    mesh.frustumCulled = false; // its bounds are those of one icon at the origin
    mesh.count = 0;
    globe.scene().add(mesh);
    out[kind] = mesh;
  }
  return out;
}
function tint() {
  const set = { plane: colours.accent, tanker: colours.warm, boat: colours.ship };
  for (const [kind, mesh] of Object.entries(meshes)) {
    const c = new THREE.Color(set[kind]);
    const a = mesh.instanceColor.array;
    for (let i = 0; i < CAP[kind]; i += 1) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    mesh.instanceColor.needsUpdate = true;
  }
}

// --- what is where right now ----------------------------------------------------------------------------
const isTanker = (v) => (v.type >= 80 && v.type <= 89) || !!v.company;
const speedOf = (v) => (v.sog < 102 && v.cog < 360 ? v.sog * KNOT : 0); // 102.3 and 360 mean "not available" in AIS
const place = (e, now, cap) => (e.speed > 0.3 ? advance(e.lat, e.lng, e.track, e.speed, Math.min((now - e.t0) / 1000, cap)) : [e.lat, e.lng]);
const vesselPlace = (v, now) => place({ lat: v.lat, lng: v.lng, track: v.cog, speed: speedOf(v), t0: v.t0 }, now, 1200);

// Fills the three meshes for this moment. Called once a second, and whenever the data or a layer changes.
function layout() {
  if (!globe || !meshes) return;
  const now = Date.now();
  // icons keep a steady size on screen: a little smaller as you zoom in (they are drawn at a fixed size on the globe)
  const zoom = Math.min(1, Math.max(0.3, ((globe.pointOfView().altitude ?? 1.9) / 1.9) ** 0.8));
  const k = sizeScale * (onlyMine ? 1 : 0.7) * zoom;
  const counts = { plane: 0, tanker: 0, boat: 0 };
  const put = (kind, lat, lng, heading) => {
    const i = counts[kind];
    if (i >= CAP[kind]) return;
    counts[kind] += 1;
    const { x, y, z } = iconBasis(lat, lng, heading);
    const r = GLOBE_R * (1 + ALT[kind]);
    const [sx, sy] = SIZE[kind];
    const a = meshes[kind].instanceMatrix.array;
    const o = i * 16;
    a[o] = x[0] * sx * k; a[o + 1] = x[1] * sx * k; a[o + 2] = x[2] * sx * k; a[o + 3] = 0;
    a[o + 4] = y[0] * sy * k; a[o + 5] = y[1] * sy * k; a[o + 6] = y[2] * sy * k; a[o + 7] = 0;
    a[o + 8] = z[0]; a[o + 9] = z[1]; a[o + 10] = z[2]; a[o + 11] = 0;
    a[o + 12] = z[0] * r; a[o + 13] = z[1] * r; a[o + 14] = z[2] * r; a[o + 15] = 1;
  };
  if (airOn) {
    const cap = Math.max(300, airMeta.refreshSec * 2); // never carry a stale position on for more than twice the refresh
    for (const e of air) { const [lat, lng] = place(e, now, cap); put('plane', lat, lng, e.track); }
  }
  let mineTankers = 0;
  let otherTankers = 0;
  let boats = 0;
  for (const v of vessels.values()) {
    const tanker = isTanker(v);
    if (v.company) mineTankers += 1; else if (tanker) otherTankers += 1; else boats += 1;
    if (onlyMine && !v.company) continue; // "Only my list": the vessels of the companies in the watch list
    if (tanker ? !tankOn : !seaOn) continue;
    const [lat, lng] = vesselPlace(v, now);
    put(tanker ? 'tanker' : 'boat', lat, lng, v.cog < 360 ? v.cog : 0);
  }
  for (const [kind, mesh] of Object.entries(meshes)) { mesh.count = counts[kind]; mesh.instanceMatrix.needsUpdate = true; }
  const needKey = $('osint-key').value ? '0' : 'key';
  $('osint-air-n').textContent = air.length ? fmt(air.length) : '--';
  $('osint-tank-n').textContent = mineTankers + (onlyMine ? 0 : otherTankers) ? fmt(mineTankers + (onlyMine ? 0 : otherTankers)) : needKey;
  $('osint-sea-n').textContent = boats ? fmt(boats) : needKey;
  wake(60);
}

// --- inspect ----------------------------------------------------------------------------------------------
function pick(lat, lng) {
  const now = Date.now();
  const alt = globe.pointOfView().altitude ?? 1.9;
  const limit = Math.max(0.35, alt * 1.1) ** 2; // degrees squared: closer in, a smaller circle
  const near = (la, ln) => (la - lat) ** 2 + ((ln - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
  let best = null;
  let bestD = limit;
  if (airOn) {
    for (const e of air) { const [la, ln] = place(e, now, 900); const d = near(la, ln); if (d < bestD) { bestD = d; best = { kind: 'air', e, la, ln }; } }
  }
  for (const v of vessels.values()) {
    const tanker = isTanker(v);
    if (onlyMine && !v.company) continue;
    if (tanker ? !tankOn : !seaOn) continue;
    const [la, ln] = vesselPlace(v, now);
    const d = near(la, ln) * (tanker ? 0.8 : 1);
    if (d < bestD) { bestD = d; best = { kind: tanker ? 'tanker' : 'boat', v, la, ln }; }
  }
  if (!best) { say(statusLine()); return; }
  const at = `${best.la.toFixed(2)}, ${best.ln.toFixed(2)}`;
  if (best.kind === 'air') {
    const e = best.e;
    say(`${e.airline ? `${e.airline}  |  ` : ''}Flight ${e.call || e.icao}  |  ${e.country}  |  ${fmt(Math.round(e.alt * 3.281))} ft  |  ${Math.round(e.speed * 1.944)} kt  |  heading ${e.track}  |  ${at}`);
  } else {
    const v = best.v;
    const who = v.company ? `${v.company} (${v.why})  |  ` : '';
    say(`${best.kind === 'tanker' ? 'Tanker' : 'Ship'} ${v.name || v.imo || 'unknown'}  |  ${who}${v.dest ? `to ${v.dest}  |  ` : ''}${v.length ? `${v.length} m  |  ` : ''}${v.draught ? `draught ${v.draught} m  |  ` : ''}${v.sog < 102 ? `${v.sog.toFixed(1)} kt` : 'speed unknown'}  |  course ${v.cog < 360 ? Math.round(v.cog) : '--'}  |  ${at}`);
  }
}

function statusLine() {
  const a = airMeta;
  const mode = onlyMine ? `${fmt(a.count)} aircraft of your airlines (of ${fmt(a.total)} in the air)` : `${fmt(a.total)} aircraft`;
  const fresh = a.authed ? `OpenSky login: fresh every ${a.refreshSec} s` : 'anonymous OpenSky: refreshed every 15 min, add a login for fresh positions';
  return `${mode}  |  ${fresh}${a.credits != null ? `  |  ${a.credits} credits left today` : ''}${a.error ? `  |  ${a.error}` : ''}  |  drawn by ${renderedBy}  |  click an icon to inspect`;
}

// --- aircraft -------------------------------------------------------------------------------------------------
async function loadAir(force = false) {
  try {
    const r = await fetchAircraft(force, airTime, onlyMine);
    airMeta = { count: r.count, total: r.total, credits: r.credits, authed: r.authed, refreshSec: r.refreshSec, error: r.error || '' };
    if (!r.unchanged) {
      airTime = r.time;
      const base = Date.now() - r.ageSec * 1000; // when the sidecar fetched this list
      air = r.aircraft.map((a) => ({ lat: a[0], lng: a[1], alt: a[2], track: a[3], icao: a[4], call: a[5], country: a[6], speed: a[7], airline: a[9] ?? '', t0: base - (a[8] ?? 0) * 1000 }));
    }
    say(statusLine());
  } catch (e) { say(e.message ?? String(e)); }
  layout();
}

// --- ships: aisstream.io -----------------------------------------------------------------------------------
// A position report says where a vessel is and its name, not what it is. What it is (type, destination, size, IMO) comes
// in a separate static report every few minutes: until then a vessel is an ordinary boat, unless its name is on the list.
const upper = (s) => String(s ?? '').trim().toUpperCase();
const GUESS = 'bound for one of its sites: a guess';
function matchCompany(v, mmsi) {
  for (const c of watch.companies ?? []) {
    const name = upper(v.name);
    if (name && (c.names ?? []).some((n) => upper(n) === name)) return [c.name, 'name'];
    if (name && (c.nameContains ?? []).some((w) => name.includes(upper(w)))) return [c.name, 'name'];
    if (v.imo && (c.imo ?? []).some((n) => String(n) === String(v.imo))) return [c.name, 'IMO number'];
    if ((c.mmsi ?? []).some((n) => String(n) === String(mmsi))) return [c.name, 'MMSI number'];
    const dest = upper(v.dest);
    if (v.type >= 80 && v.type <= 89 && dest && (c.destinationContains ?? []).some((w) => dest.includes(upper(w)))) return [c.name, GUESS];
  }
  return null;
}
function evict() {
  if (vessels.size < VESSEL_CAP) return;
  for (const [k, v] of vessels) if (!v.company) { vessels.delete(k); return; } // the oldest vessel that is not on the list
}
function reclass(v, mmsi) {
  if (v.company && v.why !== GUESS) return; // a firm match stays
  const m = matchCompany(v, mmsi);
  if (m) [v.company, v.why] = m; else { v.company = ''; v.why = ''; }
}

function onAis(m) {
  const mmsi = m.MetaData?.MMSI;
  if (!mmsi) return;
  const p = m.Message?.PositionReport;
  if (p) {
    let v = vessels.get(mmsi);
    if (!v) { evict(); v = { type: 0, dest: '', length: 0, draught: 0, imo: '', company: '', why: '', name: '' }; vessels.set(mmsi, v); }
    const name = (m.MetaData.ShipName ?? '').trim();
    Object.assign(v, { lat: p.Latitude, lng: p.Longitude, sog: p.Sog ?? 0, cog: p.Cog ?? 360, t0: Date.now() });
    if (name && name !== v.name) { v.name = name; reclass(v, mmsi); }
    return;
  }
  const st = m.Message?.ShipStaticData;
  const v = st && vessels.get(mmsi);
  if (!v) return; // a static report for a vessel not seen moving yet: its position will come
  const d = st.Dimension ?? {};
  Object.assign(v, { type: st.Type ?? v.type, dest: (st.Destination ?? '').trim(), length: (d.A ?? 0) + (d.B ?? 0), draught: st.MaximumStaticDraught || 0, imo: st.ImoNumber || v.imo });
  if (!v.name && st.Name) v.name = String(st.Name).trim();
  reclass(v, mmsi);
}

function connectShips() {
  const key = $('osint-key').value.trim();
  if (socket || !key || !(seaOn || tankOn)) return;
  socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
  socket.addEventListener('open', () => socket.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport', 'ShipStaticData'] })));
  socket.addEventListener('message', async (e) => {
    try {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text());
      if (m.error) { say(`AIS stream: ${m.error}`); return; }
      onAis(m);
    } catch { /* one bad message is not worth a stop */ }
  });
  socket.addEventListener('close', () => { socket = null; });
}
const disconnectShips = () => { socket?.close(); socket = null; };

// --- the globe ----------------------------------------------------------------------------------------------------
async function build() {
  const [{ default: Globe }, topo, atlas] = await Promise.all([import('globe.gl'), import('topojson-client'), import('world-atlas/countries-110m.json')]);
  const countries = topo.feature(atlas.default, atlas.default.objects.countries).features;
  readColours();
  globe = Globe()(host)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor(colours.accent)
    .atmosphereAltitude(0.18)
    .showGraticules(true)
    .polygonsData(countries)
    .polygonAltitude(0.006)
    .polygonsTransitionDuration(0) // no tween: the loop is asleep most of the time
    .polygonCapColor(() => colours.cap)
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => colours.line);
  globe.globeMaterial().color.set(colours.sphere);
  if (import.meta.env.DEV) window.__globe = globe; // for the measuring scripts
  const renderer = globe.renderer();
  // Which adapter is drawing? On a GPU the globe is sharp (device pixels, up to 2x); on a software renderer one pixel per pixel keeps it light.
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const adapter = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const soft = /SwiftShader|Basic Render|WARP|llvmpipe|software/i.test(adapter);
  renderer.setPixelRatio(soft ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderedBy = soft ? 'the CPU' : (adapter.replace(/^ANGLE \(/, '').split(',')[1] ?? adapter).split(/\s*Direct3D/)[0].replace(/\s*\(0x[0-9A-Fa-f]+\)/, '').trim() || 'the GPU';
  // count the frames really drawn, so the loop never stops before the last change is on screen
  const drawFrame = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => { drawn += 1; drawFrame(scene, camera); };
  const controls = globe.controls();
  controls.autoRotate = false;
  controls.staticMoving = true; // no coasting after a drag: the loop can stop the moment you let go
  ['start', 'end'].forEach((ev) => controls.addEventListener(ev, () => wake(400))); // not 'change': it fires inside the loop itself
  controls.addEventListener('end', () => layout()); // zooming changes the icon size
  host.addEventListener('pointermove', () => wake(300), { passive: true });
  host.addEventListener('wheel', () => wake(400), { passive: true });
  // A click on the globe is turned into a position by one ray against the sphere (toGlobeCoords). The library's own
  // click handlers would test every country shape on every frame, so they stay off.
  let down = null;
  host.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  host.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // a drag, not a click
    const r = host.getBoundingClientRect();
    const hit = globe.toGlobeCoords(e.clientX - r.left, e.clientY - r.top);
    if (hit) pick(hit.lat, hit.lng);
  });
  const fit = () => { globe.width(host.clientWidth).height(host.clientHeight); wake(300); };
  new ResizeObserver(fit).observe(host);
  fit();
  globe.pointOfView({ lat: 30, lng: 10, altitude: 1.9 }); // after the size is known
  meshes = buildMeshes();
  tint();
  layout();
  wake(1500); // the first frames: country shapes are built in pieces
}

// --- on and off with the tab -----------------------------------------------------------------------------------
async function refreshLogin() {
  try {
    const s = await osintLoginStatus();
    const btn = $('osint-login-btn');
    btn.textContent = s.authed ? 'OpenSky: in' : 'OpenSky';
    btn.setAttribute('aria-pressed', String(!!s.authed));
    return s;
  } catch { return null; }
}
function start() {
  if (!loading) loading = build().catch((e) => { loading = null; say(`The globe could not start: ${e.message ?? e}`); });
  loading.then(async () => {
    if (activeIntelTab() !== 'osint') return;
    try { watch = await osintWatch(); } catch { /* the sidecar is not up yet: the lists stay empty until it is */ }
    refreshLogin();
    wake(900);
    loadAir();
    connectShips();
    timers = [
      setInterval(() => loadAir(), 30000), // the sidecar decides when OpenSky is really asked; this just picks up new lists
      setInterval(layout, 1000), // the glide: everything moves along its course
    ];
  });
}
function stop() {
  timers.forEach(clearInterval);
  timers = [];
  disconnectShips();
  rest();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) rest(); else wake(600); });
document.addEventListener('jarvis:intel-tab', (e) => { stop(); if (e.detail.tab === 'osint') start(); });

// --- the toolbar -------------------------------------------------------------------------------------------------------
const streamSwitch = () => { if (seaOn || tankOn) connectShips(); else disconnectShips(); };
const toggle = (id, get, set, after) => $(id).addEventListener('click', (e) => { set(!get()); e.currentTarget.setAttribute('aria-pressed', String(get())); after?.(); layout(); });
toggle('osint-air', () => airOn, (v) => { airOn = v; });
toggle('osint-tank', () => tankOn, (v) => { tankOn = v; }, streamSwitch);
toggle('osint-sea', () => seaOn, (v) => { seaOn = v; }, streamSwitch);
toggle('osint-mine', () => onlyMine, (v) => { onlyMine = v; airTime = 0; }, () => loadAir());
$('osint-bigger').addEventListener('click', () => { sizeScale = Math.min(2.4, sizeScale * 1.25); layout(); });
$('osint-smaller').addEventListener('click', () => { sizeScale = Math.max(0.5, sizeScale / 1.25); layout(); });
$('osint-refresh').addEventListener('click', () => { say('Asking OpenSky...'); loadAir(true); });

$('osint-key').addEventListener('keydown', (e) => e.stopPropagation());
$('osint-key').addEventListener('change', () => {
  try { localStorage.setItem(KEY_STORE, $('osint-key').value.trim()); } catch { /* storage blocked */ }
  disconnectShips();
  vessels.clear();
  connectShips();
  layout();
});
try { $('osint-key').value = localStorage.getItem(KEY_STORE) ?? ''; } catch { /* storage blocked */ }

// OpenSky login: an API client (id and secret) from the free account page. It goes to the sidecar, which keeps it in
// data/opensky.json (git-ignored) and never sends the secret back; the fields are emptied as soon as it is saved.
const loginRow = $('osint-login');
$('osint-login-btn').addEventListener('click', () => { loginRow.hidden = !loginRow.hidden; if (!loginRow.hidden) $('osint-client-id').focus(); });
loginRow.addEventListener('keydown', (e) => e.stopPropagation());
const loginNote = (t, bad = false) => { const n = $('osint-login-note'); n.textContent = t; if (bad) n.dataset.bad = ''; else delete n.dataset.bad; };
$('osint-login-save').addEventListener('click', async () => {
  const clientId = $('osint-client-id').value.trim();
  const clientSecret = $('osint-client-secret').value.trim();
  if (!clientId || !clientSecret) { loginNote('Enter both the client id and the client secret.', true); return; }
  loginNote('Checking the login...');
  try {
    await osintLogin(clientId, clientSecret);
    $('osint-client-id').value = '';
    $('osint-client-secret').value = '';
    loginNote('Signed in. Aircraft now refresh every 100 seconds.');
    await refreshLogin();
    airTime = 0;
    loadAir(true);
  } catch (e) { loginNote(e.message ?? String(e), true); }
});
$('osint-login-remove').addEventListener('click', async () => {
  try { await osintLogin('', ''); loginNote('Login removed. Back to anonymous.'); await refreshLogin(); airTime = 0; loadAir(true); } catch (e) { loginNote(e.message ?? String(e), true); }
});

document.addEventListener('jarvis:theme', () => {
  if (!globe) return;
  readColours();
  globe.globeMaterial().color.set(colours.sphere);
  globe.atmosphereColor(colours.accent);
  globe.polygonCapColor(() => colours.cap).polygonStrokeColor(() => colours.line);
  if (meshes) tint();
  layout();
});
