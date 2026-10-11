// The OSINT tab: a 3D globe with every aircraft in the air (OpenSky, through the sidecar) and, with a free
// aisstream.io key, every ship that reports its position (AIS, a websocket straight from the page), with the
// tankers (AIS ship types 80 to 89: oil, chemical and gas carriers) in their own layer and colour.
// The globe is the one thing in the app drawn by the GPU (the integrated one; see src-tauri/src/lib.rs).
// The globe is only drawn, polled and streamed while this tab is the one in view, and it is drawn on demand: the
// render loop runs only while you drag, zoom, hover or while new data is going in, then stops (idle costs nothing;
// a loop that never stops used a whole CPU core, because this interface is drawn by the CPU).
import { aircraft as fetchAircraft } from './browser-client.js';
import { activeIntelTab } from './intel-tabs.js';

const $ = (id) => document.getElementById(id);
const host = $('osint-map');
const status = $('osint-status');
const KEY_STORE = 'jarvis.ais.key';
const SHIP_CAP = 40000;
const TANKER_CAP = 25000;

let globe = null;
let loading = null;
let air = [];
let ships = new Map(); // other vessels: mmsi -> [lat, lng, speed knots, course, name]
let tankers = new Map(); // tankers: same shape
const tankerInfo = new Map(); // mmsi -> { name, dest, draught, length, imo } from the ship's own static message
let tankOn = true;
let renderedBy = '';
let airOn = true;
let seaOn = true;
let socket = null;
let timers = [];
let airMeta = '';
let airTime = 0; // OpenSky's time stamp of the list on screen, so an unchanged list is not downloaded or redrawn
let shipsDirty = false;
let colours = {};
let sleepTimer = 0;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const say = (text) => { status.textContent = text; };

// --- draw on demand --------------------------------------------------------------------------------
const readColours = () => { colours = { accent: css('--accent'), warm: css('--warm'), cap: css('--surface-3'), line: css('--border-strong'), sphere: css('--surface-1'), ship: css('--text-3') }; };
let waking = false;
let drawn = 0; // frames drawn so far
function wake(ms = 500) {
  if (!globe || waking || activeIntelTab() !== 'osint' || document.hidden) return;
  waking = true; // starting the loop draws a frame, which can announce a change, which would start the loop again
  try { globe.resumeAnimation(); } finally { waking = false; }
  clearTimeout(sleepTimer);
  const mark = drawn;
  const check = () => { if (drawn - mark < 3) sleepTimer = setTimeout(check, 100); else globe?.pauseAnimation(); }; // never stop before the last change is on screen
  sleepTimer = setTimeout(check, ms);
}
const rest = () => { clearTimeout(sleepTimer); globe?.pauseAnimation(); };

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
  // Which adapter is drawing? On the GPU the globe is sharp (device pixels, up to 2x); if the browser fell back to a software
  // renderer (JARVIS_GPU=off, or no GPU), one pixel per pixel keeps it light.
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
  host.addEventListener('pointermove', () => wake(300), { passive: true });
  host.addEventListener('wheel', () => wake(400), { passive: true });
  // A click on the globe is turned into a position by one ray against the sphere (toGlobeCoords). The library's own
  // click handlers (onGlobeClick, onPolygonClick) would test every country shape on every frame, so they stay off.
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
  draw();
  wake(1500); // the first frames: country shapes are built in pieces
}

// Aircraft and ships are two particle sets: one draw call for thousands of points.
function draw() {
  if (!globe) return;
  const sets = [];
  const at = (list, alt) => list.map((s) => ({ lat: s[0], lng: s[1], alt }));
  if (seaOn) sets.push({ color: colours.ship, size: 0.8, coords: at([...ships.values()], 0.004) });
  if (tankOn) sets.push({ color: colours.warm, size: 1.2, coords: at([...tankers.values()], 0.006) });
  if (airOn) sets.push({ color: colours.accent, size: 0.9, coords: air.map((a) => ({ lat: a[0], lng: a[1], alt: 0.012 })) });
  shipsDirty = false;
  globe.particlesData(sets).particlesList((d) => d.coords).particleLat('lat').particleLng('lng').particleAltitude('alt').particlesSize((d) => d.size).particlesColor((d) => d.color);
  $('osint-air-n').textContent = air.length ? air.length.toLocaleString('en-US') : '--';
  const needKey = $('osint-key').value ? '0' : 'key';
  $('osint-sea-n').textContent = ships.size ? ships.size.toLocaleString('en-US') : needKey;
  $('osint-tank-n').textContent = tankers.size ? tankers.size.toLocaleString('en-US') : needKey;
  wake(900);
}

// the thing nearest to where you clicked (within about 2 degrees)
function pick(lat, lng) {
  let best = null;
  let bestD = 4;
  const near = (la, ln) => ((la - lat) ** 2 + ((ln - lng) * Math.cos((lat * Math.PI) / 180)) ** 2);
  if (airOn) for (const a of air) { const d = near(a[0], a[1]); if (d < bestD) { bestD = d; best = { kind: 'Aircraft', a }; } }
  if (seaOn) for (const s of ships.values()) { const d = near(s[0], s[1]); if (d < bestD) { bestD = d; best = { kind: 'Ship', s }; } }
  if (tankOn) for (const [mmsi, s] of tankers) { const d = near(s[0], s[1]); if (d < bestD * 1.5) { bestD = Math.min(bestD, d); best = { kind: 'Tanker', s, mmsi }; } } // a tanker wins a near tie
  if (!best) { say(airMeta); return; }
  if (best.kind === 'Aircraft') {
    const [la, ln, alt, track, icao, call, country, speed] = best.a;
    say(`Aircraft ${call || icao}  |  ${country}  |  ${Math.round(alt * 3.281).toLocaleString('en-US')} ft  |  ${Math.round(speed * 1.944)} kt  |  heading ${track}  |  ${la.toFixed(2)}, ${ln.toFixed(2)}`);
  } else if (best.kind === 'Tanker') {
    const [la, ln, speed, course, name] = best.s;
    const t = tankerInfo.get(best.mmsi) ?? {};
    say(`Tanker ${t.name || name || best.mmsi}  |  ${t.dest ? `to ${t.dest}  |  ` : ''}${t.length ? `${t.length} m  |  ` : ''}${t.draught ? `draught ${t.draught} m  |  ` : ''}${speed.toFixed(1)} kt  |  course ${Math.round(course)}  |  ${la.toFixed(2)}, ${ln.toFixed(2)}`);
  } else {
    const [la, ln, speed, course, name] = best.s;
    say(`Ship ${name || 'unknown'}  |  ${speed.toFixed(1)} kt  |  course ${Math.round(course)}  |  ${la.toFixed(2)}, ${ln.toFixed(2)}`);
  }
}

async function loadAir(force = false) {
  try {
    const r = await fetchAircraft(force, airTime);
    if (r.unchanged) { airMeta = airMeta.replace(/positions from [^|]*/, `positions from ${r.ageSec < 90 ? 'just now' : `${Math.round(r.ageSec / 60)} min ago`}  `); say(airMeta); return; }
    airTime = r.time;
    air = r.aircraft;
    const age = r.ageSec < 90 ? 'just now' : `${Math.round(r.ageSec / 60)} min ago`;
    airMeta = `${r.count.toLocaleString('en-US')} aircraft, positions from ${age}${r.credits != null ? `  |  ${r.credits} OpenSky credits left today` : ''}${r.error ? `  |  ${r.error}` : ''}  |  drawn by ${renderedBy}  |  click the globe to inspect`;
    say(airMeta);
  } catch (e) { say(e.message ?? String(e)); }
  draw();
}

// --- ships: aisstream.io -----------------------------------------------------------------
// A position report says where a vessel is, not what it is. What it is (its AIS ship type, name, destination,
// size) comes in a separate static report every few minutes. Until a vessel's static report arrives it is drawn
// as an ordinary ship; when it says it is a tanker it moves to the tankers layer for good.
const isTanker = (type) => type >= 80 && type <= 89;
function evict(map, cap, key) { if (map.size >= cap && !map.has(key)) map.delete(map.keys().next().value); }

function onAis(m) {
  const mmsi = m.MetaData?.MMSI;
  if (!mmsi) return;
  const p = m.Message?.PositionReport;
  if (p) {
    const row = [p.Latitude, p.Longitude, p.Sog ?? 0, p.Cog ?? 0, (m.MetaData.ShipName ?? '').trim()];
    if (tankerInfo.has(mmsi)) { evict(tankers, TANKER_CAP, mmsi); tankers.set(mmsi, row); } else { evict(ships, SHIP_CAP, mmsi); ships.set(mmsi, row); }
    shipsDirty = true;
    return;
  }
  const st = m.Message?.ShipStaticData;
  if (!st || !isTanker(st.Type)) return;
  const known = tankerInfo.get(mmsi);
  if (known) { known.dest = (st.Destination ?? known.dest).trim(); return; } // a fresher destination
  const d = st.Dimension ?? {};
  tankerInfo.set(mmsi, { name: (st.Name ?? '').trim(), dest: (st.Destination ?? '').trim(), draught: st.MaximumStaticDraught || 0, length: (d.A ?? 0) + (d.B ?? 0), imo: st.ImoNumber });
  const seen = ships.get(mmsi);
  if (seen) { ships.delete(mmsi); evict(tankers, TANKER_CAP, mmsi); tankers.set(mmsi, seen); }
  shipsDirty = true;
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

// --- on and off with the tab -----------------------------------------------------------------
function start() {
  if (!loading) loading = build().catch((e) => { loading = null; say(`The globe could not start: ${e.message ?? e}`); });
  loading.then(() => {
    if (activeIntelTab() !== 'osint') return;
    wake(900);
    loadAir();
    connectShips();
    timers = [setInterval(() => loadAir(), 60000), setInterval(() => { if (shipsDirty && (seaOn || tankOn)) draw(); }, 5000)];
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

$('osint-air').addEventListener('click', (e) => { airOn = !airOn; e.currentTarget.setAttribute('aria-pressed', String(airOn)); draw(); });
const syncStream = () => { if (seaOn || tankOn) connectShips(); else disconnectShips(); draw(); };
$('osint-sea').addEventListener('click', (e) => { seaOn = !seaOn; e.currentTarget.setAttribute('aria-pressed', String(seaOn)); syncStream(); });
$('osint-tank').addEventListener('click', (e) => { tankOn = !tankOn; e.currentTarget.setAttribute('aria-pressed', String(tankOn)); syncStream(); });
$('osint-refresh').addEventListener('click', () => { say('Asking OpenSky...'); loadAir(true); });
$('osint-key').addEventListener('keydown', (e) => e.stopPropagation());
$('osint-key').addEventListener('change', () => {
  try { localStorage.setItem(KEY_STORE, $('osint-key').value.trim()); } catch { /* storage blocked */ }
  disconnectShips();
  ships = new Map();
  tankers = new Map();
  tankerInfo.clear();
  connectShips();
  draw();
});
try { $('osint-key').value = localStorage.getItem(KEY_STORE) ?? ''; } catch { /* storage blocked */ }
document.addEventListener('jarvis:theme', () => { if (!globe) return; readColours(); globe.globeMaterial().color.set(colours.sphere); globe.atmosphereColor(colours.accent); globe.polygonCapColor(() => colours.cap).polygonStrokeColor(() => colours.line); draw(); });
