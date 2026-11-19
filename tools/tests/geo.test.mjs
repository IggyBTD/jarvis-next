import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, iconBasis, callsignMatches } from '../../src/core/geo.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not near ${b}`);

test('advance: due east along the equator moves longitude only, 10 km is 0.0899 degrees', () => {
  const [lat, lng] = advance(0, 10, 90, 1000, 10);
  close(lat, 0, 1e-9);
  close(lng, 10.0899, 1e-3);
});
test('advance: due north moves latitude only; no time means no move', () => {
  const [lat, lng] = advance(40, -3, 0, 250, 60); // 15 km in a minute
  close(lng, -3, 1e-9);
  close(lat, 40.1349, 1e-3);
  assert.deepEqual(advance(40, -3, 0, 250, 0), [40, -3]);
});
test('advance: wraps over the date line', () => {
  const [, lng] = advance(0, 179.99, 90, 2000, 10);
  assert.ok(lng < -179 && lng > -180, String(lng));
});
test('iconBasis: at the equator and lng 0, heading north points the icon up (y) and out is +z', () => {
  const b = iconBasis(0, 0, 0);
  b.z.forEach((v, i) => close(v, [0, 0, 1][i]));
  b.y.forEach((v, i) => close(v, [0, 1, 0][i]));
  b.x.forEach((v, i) => close(v, [1, 0, 0][i])); // right-handed: x = y cross z
});
test('iconBasis: heading east turns the icon towards +x there', () => {
  const b = iconBasis(0, 0, 90);
  b.y.forEach((v, i) => close(v, [1, 0, 0][i]));
});
test('iconBasis: three unit axes at right angles anywhere', () => {
  const b = iconBasis(41.2, -73.9, 137);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  close(dot(b.x, b.x), 1); close(dot(b.y, b.y), 1); close(dot(b.z, b.z), 1);
  close(dot(b.x, b.y), 0); close(dot(b.y, b.z), 0); close(dot(b.x, b.z), 0);
});
test('callsignMatches: the airline code then digits', () => {
  assert.ok(callsignMatches('AFR1234', ['AFR']));
  assert.ok(callsignMatches('KLC21', ['KLM', 'KLC']));
  assert.ok(!callsignMatches('AFRICA1', ['AFR']));
  assert.ok(!callsignMatches('', ['AFR']));
});
