// The shape of the node mesh, with no browser in it: where the nodes sit on the sphere and how a turn of the sphere looks from the front.
// node-mesh.js animates it on a canvas; scripts/make-icon.js draws the same shape into the app icons, so the logo and the icon match.

export const MESH_N = 48;   // the old HUD's count; icons under 64 px draw every other node
export const MESH_LINK = 0.8; // longest link, in sphere radii

// Fibonacci sphere: even spread, no clumping at the poles. tx and tz are the node's sideways direction (for its slow wobble).
export function meshPoints(n = MESH_N) {
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (i / (n - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const th = i * 2.399963; // golden angle
    const x = Math.cos(th) * ring;
    const z = Math.sin(th) * ring;
    let tx = z, tz = -x;
    const tl = Math.hypot(tx, tz);
    if (tl < 0.01) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
    return { x, y, z, tx, tz };
  });
}

// The sphere turned by `spin` around its axis and tipped by `tilt`: { x, y } on the picture (radii from the centre) and f, 0 far side to 1 near side.
export function projectPoints(points, { spin = 0, tilt = 0, open = 1 } = {}) {
  const cosS = Math.cos(spin), sinS = Math.sin(spin), cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  return points.map((p) => {
    const bx = p.x * open, by = p.y * open, bz = p.z * open;
    const x1 = bx * cosS + bz * sinS, z1 = -bx * sinS + bz * cosS;
    return { x: x1, y: by * cosT - z1 * sinT, f: (by * sinT + z1 * cosT + 1) / 2 };
  });
}
