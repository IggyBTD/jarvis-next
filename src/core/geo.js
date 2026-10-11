// Small pure geometry for the OSINT map (no DOM, no three.js, so it can be tested in node).
const RAD = Math.PI / 180;
const EARTH_M = 6371008.8;

// Where a vessel is after `seconds` more at `speedMs` metres a second on `courseDeg` (0 = north, clockwise),
// along a great circle. Returns [lat, lng]. This is how an icon glides between position reports.
export function advance(lat, lng, courseDeg, speedMs, seconds) {
  const d = (speedMs * seconds) / EARTH_M; // angular distance
  if (!d) return [lat, lng];
  const brg = courseDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lng * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / RAD, ((((l2 / RAD + 180) % 360) + 360) % 360) - 180];
}

// The three axes of a flat icon lying on the globe at lat/lng, pointing along `headingDeg`:
// x to its right, y along its heading, z straight out of the surface. (three-globe: y is up, lng 0 is on +z.)
export function iconBasis(lat, lng, headingDeg) {
  const phi = lat * RAD;
  const theta = lng * RAD;
  const n = [Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)]; // out of the surface
  const east = [Math.cos(theta), 0, -Math.sin(theta)];
  const north = [-Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta)];
  const h = headingDeg * RAD;
  const y = [0, 1, 2].map((i) => north[i] * Math.cos(h) + east[i] * Math.sin(h));
  const x = [y[1] * n[2] - y[2] * n[1], y[2] * n[0] - y[0] * n[2], y[0] * n[1] - y[1] * n[0]];
  return { x, y, z: n };
}

// A flight's callsign starts with its airline's code and then digits: AFR1234, IBE0642 (never AFRICA1)
export const callsignMatches = (callsign, prefixes) => prefixes.some((p) => callsign.startsWith(p) && /^\d/.test(callsign.slice(p.length)));
