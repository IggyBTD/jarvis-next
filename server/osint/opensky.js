// Aircraft for the OSINT globe, fetched by the server because OpenSky refuses requests from a browser page (CORS) and because the
// OpenSky login must stay on the PC. Same behaviour as the old Intel sidecar (sidecars/browser/server.mjs): anonymous is cached
// 15 minutes (400 credits a day), a saved API client refreshes every 100 s (4000 a day); data/opensky.json holds the login.
// The globe itself is drawn by whichever browser shows the page; this only feeds it.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://opensky-network.org/api/states/all';
const AUTH = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

export function createOpensky({ dataDir, watchFile, fetchImpl = fetch, now = Date.now, apiUrl = API, authUrl = AUTH }) {
  const credFile = path.join(dataDir, 'opensky.json');
  let creds = readJson(credFile, null);
  let token = { value: '', until: 0 };
  let authed = false;
  let cache = { at: 0, time: 0, credits: null, list: [], error: '' };

  async function bearer() {
    if (!creds?.clientId || !creds?.clientSecret) return '';
    if (token.value && now() < token.until) return token.value;
    const res = await fetchImpl(authUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { authed = false; throw new Error(res.status === 400 || res.status === 401 ? 'OpenSky refused the login (check the client id and secret)' : `OpenSky login answered ${res.status}`); }
    const body = await res.json();
    token = { value: body.access_token, until: now() + Math.max(60, (body.expires_in ?? 1800) - 60) * 1000 };
    authed = true;
    return token.value;
  }

  async function load(force) {
    const ttl = authed ? 100_000 : 900_000;
    const gap = authed ? 30_000 : 60_000;
    const age = now() - cache.at;
    if (cache.list.length && ((age < ttl && !force) || age < gap)) return cache;
    try {
      let bear = '';
      try { bear = await bearer(); } catch (e) { cache = { ...cache, error: String(e.message) }; }
      const res = await fetchImpl(apiUrl, { headers: bear ? { authorization: `Bearer ${bear}` } : {}, signal: AbortSignal.timeout(25_000) });
      if (res.status === 401 && bear) { token = { value: '', until: 0 }; authed = false; throw new Error('OpenSky refused the saved login'); }
      if (res.status === 429) throw new Error('OpenSky says the daily limit is used up');
      if (!res.ok) throw new Error(`OpenSky answered ${res.status}`);
      const body = await res.json();
      // [lat, lon, altitude m, track deg, icao24, callsign, country, speed m/s, seconds since the position was taken], airborne only
      const list = (body.states ?? []).filter((r) => r[6] != null && r[5] != null && !r[8]).map((r) => [r[6], r[5], Math.round(r[13] ?? r[7] ?? 0), Math.round(r[10] ?? 0), r[0], (r[1] ?? '').trim(), r[2], Math.round(r[9] ?? 0), Math.max(0, (body.time ?? 0) - (r[3] ?? body.time ?? 0))]);
      cache = { at: now(), time: body.time, credits: Number(res.headers.get('x-rate-limit-remaining')) || null, list, error: cache.error && !authed && creds ? cache.error : '' };
    } catch (e) { cache = { ...cache, error: String(e?.message ?? e) }; } // keep the old list on screen and say why it is old
    return cache;
  }

  const watch = () => readJson(watchFile, { airlines: [], companies: [] });
  function watched(list) {
    const rules = (watch().airlines ?? []).map((a) => ({ name: a.name, prefixes: a.prefixes ?? [] }));
    const out = [];
    for (const row of list) {
      const call = row[5];
      const hit = call && rules.find((r) => r.prefixes.some((p) => call.startsWith(p) && /^\d/.test(call.slice(p.length))));
      if (hit) out.push([...row, hit.name]);
    }
    return out;
  }

  return {
    watch,
    async aircraft({ force = false, since = 0, mine = true } = {}) {
      const a = await load(force);
      const list = mine ? watched(a.list) : a.list;
      const head = { time: a.time, ageSec: Math.round((now() - a.at) / 1000), credits: a.credits, error: a.error, count: list.length, total: a.list.length, authed, refreshSec: authed ? 100 : 900 };
      return a.time && Number(since) === a.time ? { ...head, unchanged: true } : { ...head, aircraft: list };
    },
    status: () => ({ configured: !!creds, authed }),
    // Empty strings remove the saved login; a login is kept only if OpenSky accepts it.
    async login(clientId = '', clientSecret = '') {
      const ok = (v) => typeof v === 'string' && v.length <= 200 && /^[\w@.\-~+=]*$/.test(v);
      if (!ok(clientId) || !ok(clientSecret)) throw Object.assign(new Error('That is not a client id and secret.'), { status: 400 });
      token = { value: '', until: 0 };
      authed = false;
      if (!clientId && !clientSecret) { creds = null; fs.rmSync(credFile, { force: true }); return { configured: false, authed: false }; }
      creds = { clientId, clientSecret };
      try { await bearer(); } catch (e) { creds = null; throw Object.assign(e, { status: 400 }); }
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(credFile, JSON.stringify(creds), { mode: 0o600 });
      cache.at = 0;
      return { configured: true, authed };
    },
  };
}
