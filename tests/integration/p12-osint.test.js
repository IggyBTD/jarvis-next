import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createOpensky } from '../../server/osint/opensky.js';
import { makeRig, startApi } from '../rig.js';
import { tmpDir, rmDir, request } from '../helpers.js';

// OpenSky state vectors: [icao24, callsign, country, time_position, last_contact, lon, lat, baro_alt, on_ground, velocity, track, vrate, sensors, geo_alt]
const row = (icao, call, lon, lat, ground = false) => [icao, `${call} `, 'Spain', 1000, 1000, lon, lat, 9000, ground, 230, 90, 0, null, 9100];
function fakeFetch() {
  const calls = { api: 0, auth: 0, bearers: [] };
  let t = 1000;
  const f = async (url, opts = {}) => {
    if (String(url).includes('openid-connect')) { calls.auth += 1; const bad = /bad/.test(String(opts.body)); return new Response(JSON.stringify(bad ? {} : { access_token: 'tok', expires_in: 1800 }), { status: bad ? 401 : 200 }); }
    calls.api += 1; calls.bearers.push(opts.headers?.authorization ?? null); t += 1;
    return new Response(JSON.stringify({ time: t, states: [row('a1', 'IBE123', 3, 40), row('a2', 'XYZ9', 4, 41), row('a3', 'RYR55', 5, 42, true)] }), { status: 200, headers: { 'x-rate-limit-remaining': '350' } });
  };
  return { f, calls };
}

test('opensky: airborne only, watch list filter, caching, unchanged flag, login kept only if accepted', async () => {
  const dir = tmpDir('os');
  try {
    const watch = path.join(dir, 'watch.json');
    fs.writeFileSync(watch, JSON.stringify({ airlines: [{ name: 'Iberia', prefixes: ['IBE'] }] }));
    const { f, calls } = fakeFetch();
    let now = 5_000_000;
    const o = createOpensky({ dataDir: dir, watchFile: watch, fetchImpl: f, now: () => now });
    const all = await o.aircraft({ mine: false });
    assert.equal(all.total, 2); // the one on the ground is dropped
    assert.equal(all.credits, 350);
    const mine = await o.aircraft({ mine: true });
    assert.deepEqual(mine.aircraft.map((r) => [r[5], r.at(-1)]), [['IBE123', 'Iberia']]);
    assert.equal(calls.api, 1); // anonymous answers are cached
    assert.equal((await o.aircraft({ mine: true, since: mine.time })).unchanged, true);
    now += 16 * 60_000;
    await o.aircraft({});
    assert.equal(calls.api, 2);

    await assert.rejects(o.login('bad', 'x'), /refused the login/);
    assert.equal(o.status().configured, false);
    assert.ok(!fs.existsSync(path.join(dir, 'opensky.json')));
    await assert.rejects(o.login('a b', 'x'), /not a client id/);
    assert.deepEqual(await o.login('good', 'secret'), { configured: true, authed: true });
    assert.equal(fs.statSync(path.join(dir, 'opensky.json')).isFile(), true);
    now += 2 * 60_000;
    await o.aircraft({ force: true });
    assert.equal(calls.bearers.at(-1), 'Bearer tok');
    assert.deepEqual(await o.login('', ''), { configured: false, authed: false });
  } finally { rmDir(dir); }
});

test('opensky: a failing upstream keeps the old list and says why', async () => {
  const dir = tmpDir('os2');
  try {
    let fail = false;
    const { f } = fakeFetch();
    let now = 1;
    const o = createOpensky({ dataDir: dir, watchFile: path.join(dir, 'none.json'), fetchImpl: async (u, op) => (fail ? new Response('{}', { status: 429 }) : f(u, op)), now: () => now });
    assert.equal((await o.aircraft({ mine: false })).total, 2);
    fail = true; now += 20 * 60_000;
    const r = await o.aircraft({ mine: false });
    assert.equal(r.total, 2);
    assert.match(r.error, /daily limit/);
  } finally { rmDir(dir); }
});

test('server routes: UI token only, data comes through the server', async () => {
  const dir = tmpDir('os3');
  const r = await makeRig();
  try {
    const { f } = fakeFetch();
    const osint = createOpensky({ dataDir: dir, watchFile: path.join(dir, 'w.json'), fetchImpl: f });
    const api = await startApi(r, { osint });
    const ui = { authorization: `Bearer ${api.uiToken}` };
    assert.equal((await request(`${api.url}/api/osint/aircraft?watch=0`)).status, 401);
    assert.equal((await request(`${api.url}/api/osint/aircraft?watch=0`, { headers: { authorization: `Bearer ${r.tokens.mac}` } })).status, 403);
    const got = await request(`${api.url}/api/osint/aircraft?watch=0`, { headers: ui });
    assert.equal(got.json.total, 2);
    assert.equal((await request(`${api.url}/api/osint/watch`, { headers: ui })).status, 200);
    assert.equal((await request(`${api.url}/api/osint/opensky`, { headers: ui })).json.configured, false);
    const bad = await request(`${api.url}/api/osint/opensky`, { method: 'POST', headers: ui, body: { clientId: 'bad', clientSecret: 'x' } });
    assert.equal(bad.status, 400);
    await api.close();
  } finally { await r.close(); rmDir(dir); }
});
