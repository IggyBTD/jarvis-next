// One-time Google sign-in for the digest (read-only Gmail and Calendar). Needs data/tokens/google-client.json (an OAuth
// "Desktop app" client downloaded from Google Cloud) and JARVIS_TOKEN_KEY. Opens a loopback listener, prints the link to
// visit, exchanges the code and stores the refresh token encrypted. Set the consent screen to "In production" first, or the
// token expires after 7 days (HUMAN_TODO.md section 4).
import http from 'node:http';
import crypto from 'node:crypto';
import { loadConfig, resolveData } from '../server/core/config.js';
import { saveToken } from '../server/digest/google.js';
import { readJson, isMain } from '../shared/util.js';

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['digest.json', 'machines.json'] });
  const client = readJson(resolveData(cfg, cfg.digest.google.clientFile));
  const c = client?.installed;
  if (!c) { console.error(`Put the OAuth desktop client JSON at ${cfg.digest.google.clientFile} first.`); process.exit(1); }
  const state = crypto.randomBytes(16).toString('hex');
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { res.writeHead(400); return res.end('Wrong state or no code.'); }
    const port = server.address().port;
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: c.client_id, client_secret: c.client_secret, redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code' }) });
    const j = await r.json();
    if (!j.refresh_token) { res.end('Google gave no refresh token. Remove JARVIS from https://myaccount.google.com/permissions and try again.'); console.error('No refresh token returned.'); process.exit(1); }
    saveToken(resolveData(cfg, cfg.digest.google.tokenFile), { refresh_token: j.refresh_token });
    res.end('JARVIS is signed in. You can close this tab.');
    console.log('Saved. The digest can now read your mail and calendar (read only).');
    server.close();
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const q = new URLSearchParams({ client_id: c.client_id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', access_type: 'offline', prompt: 'consent', state, scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly' });
    console.log(`Open this link and approve:\n\nhttps://accounts.google.com/o/oauth2/v2/auth?${q}\n`);
  });
}
