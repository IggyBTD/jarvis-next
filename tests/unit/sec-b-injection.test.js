// Security fixes, stage B: exfiltration and injection (docs/security/fix-run.md). One block per finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRig, startApi } from '../rig.js';
import { request } from '../helpers.js';
import { ROOT } from '../../server/core/config.js';

const directives = (csp) => Object.fromEntries(String(csp ?? '').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));
const noRemote = (list) => (list ?? []).every((s) => !/^(https?:|\*|http$|https$)/i.test(s) && s !== 'http:' && s !== 'https:');

// ---- F2-1 -----------------------------------------------------------------------------------------------------------------------

test('F2-1: pages the server serves carry a CSP: images, media and fonts only from itself, data: or blob:; connections only to itself', async () => {
  const r = await makeRig();
  const api = await startApi(r);
  try {
    for (const p of ['/', '/index.html', '/mobile.html']) {
      const res = await request(`${api.url}${p}`, { headers: { host: `127.0.0.1:${new URL(api.url).port}` } });
      if (res.status === 503) continue; // the app is not built in this checkout
      const d = directives(res.headers['content-security-policy']);
      assert.ok(d['img-src'] && noRemote(d['img-src']) && d['img-src'].includes("'self'"), `${p} img-src ${d['img-src']}`);
      for (const k of ['media-src', 'font-src', 'style-src']) assert.ok(noRemote(d[k] ?? d['default-src']), `${p} ${k}`);
      assert.ok(d['connect-src'] && !d['connect-src'].some((s) => /^(https?:|wss?:|\*)$/.test(s)), `${p} connect-src ${d['connect-src']}`);
      assert.deepEqual(d['object-src'], ["'none'"]);
      assert.deepEqual(d['base-uri'], ["'none'"]);
    }
  } finally { await api.close(); await r.close(); }
});

test('F2-1: the desktop window has a CSP: no remote images, media, fonts or styles', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const csp = conf.app.security.csp;
  assert.equal(typeof csp, 'string');
  const d = directives(csp);
  for (const k of ['img-src', 'media-src', 'font-src', 'style-src']) assert.ok(d[k] && noRemote(d[k]), `${k} ${d[k]}`);
  assert.deepEqual(d['object-src'], ["'none'"]);
});
