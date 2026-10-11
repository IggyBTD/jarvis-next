// The OSINT tab: a 3D globe with every aircraft in the air (OpenSky, through the sidecar) and, with a free
// aisstream.io key, every ship that reports its position (AIS, a websocket straight from the page).
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

let globe = null;
let loading = null;
let air = [];
let ships = new Map(); // mmsi -> [lat, lng, speed knots, course, name]
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
const readColours = () => { colours = { accent: css('--accent'), warm: css('--warm'), cap: css('--surface-3'), line: css('--border-strong'), sphere: css('--surface-1') }; };
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
  renderer.setPixelRatio(1); // the interface is drawn by the CPU: fewer pixels is a lot less work
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
  if (airOn) sets.push({ color: colours.accent, size: 0.9, coords: air.map((a) => ({ lat: a[0], lng: a[1], alt: 0.012 })) });
  if (seaOn) sets.push({ color: colours.warm, size: 0.9, coords: [...ships.values()].map((s) => ({ lat: s[0], lng: s[1], alt: 0.004 })) });
  shipsDirty = false;
  globe.particlesData(sets).particlesList((d) => d.coords).particleLat('lat').particleLng('lng').particleAltitude('alt').particlesSize((d) => d.size).particlesColor((d) => d.color);
  $('osint-air-n').textContent = air.length ? air.length.toLocaleString('en-US') : '--';
  $('osint-sea-n').textContent = ships.size ? ships.size.toLocaleString('en-US') : $('osint-key').value ? '0' : 'key';
  wake(900);
}

// the thing nearest to where you clicked (within about 2 degrees)
function pick(lat, lng) {
  let best = null;
  let bestD = 4;
  const near = (la, ln) => ((la - lat) ** 2 + ((ln - lng) * Math.cos((lat * Math.PI) / 180)) ** 2);
  if (airOn) for (const a of air) { const d = near(a[0], a[1]); if (d < bestD) { bestD = d; best = { kind: 'Aircraft', a }; } }
  if (seaOn) for (const s of ships.values()) { const d = near(s[0], s[1]); if (d < bestD) { bestD = d; best = { kind: 'Ship', s }; } }
  if (!best) { say(airMeta); return; }
  if (best.kind === 'Aircraft') {
    const [la, ln, alt, track, icao, call, country, speed] = best.a;
    say(`Aircraft ${call || icao}  |  ${country}  |  ${Math.round(alt * 3.281).toLocaleString('en-US')} ft  |  ${Math.round(speed * 1.944)} kt  |  heading ${track}  |  ${la.toFixed(2)}, ${ln.toFixed(2)}`);
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
    airMeta = `${r.count.toLocaleString('en-US')} aircraft, positions from ${age}${r.credits != null ? `  |  ${r.credits} OpenSky credits left today` : ''}${r.error ? `  |  ${r.error}` : ''}  |  click the globe to inspect`;
    say(airMeta);
  } catch (e) { say(e.message ?? String(e)); }
  draw();
}

// --- ships: aisstream.io -----------------------------------------------------------------
function connectShips() {
  const key = $('osint-key').value.trim();
  if (socket || !key || !seaOn) return;
  socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
  socket.addEventListener('open', () => socket.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport'] })));
  socket.addEventListener('message', async (e) => {
    try {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text());
      if (m.error) { say(`AIS stream: ${m.error}`); return; }
      const p = m.Message?.PositionReport;
      if (!p || !m.MetaData) return;
      if (ships.size >= SHIP_CAP && !ships.has(m.MetaData.MMSI)) ships.delete(ships.keys().next().value);
      ships.set(m.MetaData.MMSI, [p.Latitude, p.Longitude, p.Sog ?? 0, p.Cog ?? 0, (m.MetaData.ShipName ?? '').trim()]);
      shipsDirty = true;
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
    timers = [setInterval(() => loadAir(), 60000), setInterval(() => { if (shipsDirty && seaOn) draw(); }, 5000)];
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
$('osint-sea').addEventListener('click', (e) => { seaOn = !seaOn; e.currentTarget.setAttribute('aria-pressed', String(seaOn)); if (seaOn) connectShips(); else disconnectShips(); draw(); });
$('osint-refresh').addEventListener('click', () => { say('Asking OpenSky...'); loadAir(true); });
$('osint-key').addEventListener('keydown', (e) => e.stopPropagation());
$('osint-key').addEventListener('change', () => {
  try { localStorage.setItem(KEY_STORE, $('osint-key').value.trim()); } catch { /* storage blocked */ }
  disconnectShips();
  ships = new Map();
  connectShips();
  draw();
});
try { $('osint-key').value = localStorage.getItem(KEY_STORE) ?? ''; } catch { /* storage blocked */ }
document.addEventListener('jarvis:theme', () => { if (!globe) return; readColours(); globe.globeMaterial().color.set(colours.sphere); globe.atmosphereColor(colours.accent); globe.polygonCapColor(() => colours.cap).polygonStrokeColor(() => colours.line); draw(); });
