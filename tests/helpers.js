// Test helpers: temp directories, a config copy that tests may edit, a tiny HTTP request function.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ROOT, loadConfig } from '../server/core/config.js';

export const tmpDir = (name = 'jarvis') => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
export const rmDir = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } };

// Copies config/server into a temp dir, applies edit(files) where files maps name -> parsed JSON, and loads it.
export function testConfig(edit = () => {}) {
  const dir = tmpDir('cfg');
  const src = path.join(ROOT, 'config', 'server');
  fs.cpSync(src, dir, { recursive: true });
  const files = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) files[f] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const before = Object.keys(files);
  Object.assign(files['models.json'], { thinkingMethod: 'chat_template_kwargs', thinking: { chat: false, tools: false, digest: false, agent: true } }); // tests pin the thinking policy; which model models.json names does not matter to them
  edit(files);
  for (const f of before) if (!(f in files)) fs.rmSync(path.join(dir, f));
  for (const [f, json] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(json));
  const dataDir = tmpDir('data');
  return { cfg: loadConfig({ configDir: dir, dataDir }), dir, dataDir, cleanup() { rmDir(dir); rmDir(dataDir); } };
}

export function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

export const waitFor = async (fn, { timeout = 3000, step = 10 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, step));
  }
};
