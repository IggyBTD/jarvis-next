// Microsoft (work or school) accounts added from the Accounts page. Same shape as google-accounts.js: "Connect" returns the
// Microsoft sign-in link, a one-shot loopback listener catches the redirect (PKCE + state, public client, no secret), the code
// becomes an encrypted refresh token per account and the address is read from Graph. Read-only delegated scopes.
// data/tokens/microsoft-client.json is { "client_id": "...", "tenant": "organizations" } (tenant is optional).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { saveToken } from '../digest/google.js';
import { readJson, writeFileAtomic } from '../../shared/util.js';

export const SCOPE = 'offline_access User.Read Mail.Read Calendars.Read Files.Read';
const KINDS = ['Personal', 'School', 'Work'];
const WAIT_MS = 5 * 60_000; // an unfinished sign-in is dropped after this
export const login = (tenant = 'organizations') => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
const GRAPH = { profile: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName' };

export function createMicrosoftAccounts({ dataDir, clientFile, fetchImpl = fetch, endpoints = GRAPH, loginBase = login, now = Date.now }) {
  const listFile = path.join(dataDir, 'accounts-microsoft.json');
  const tokenFor = (id) => path.join(dataDir, 'tokens', `microsoft-${id}.enc`);
  const read = () => { const v = readJson(listFile, []); return Array.isArray(v) ? v : []; };
  const write = (l) => writeFileAtomic(listFile, JSON.stringify(l, null, 2), 0o600);
  const patch = (id, p) => write(read().map((a) => (a.id === id ? { ...a, ...p } : a)));
  const listeners = new Map();

  function finish(id, p) { patch(id, p); listeners.get(id)?.close(); listeners.delete(id); }

  return {
    connected: () => read().filter((a) => a.status === 'connected').map((a) => ({ id: a.id, name: a.name, kind: a.kind, email: a.email, tokenFile: tokenFor(a.id) })),
    list() {
      return read().map((a) => (a.status === 'pending' && now() - a.added > WAIT_MS ? { ...a, status: 'error', error: 'Sign-in was not finished. Try again.' } : a));
    },
    async start({ kind, name }) {
      const c = readJson(clientFile);
      if (!c?.client_id) throw Object.assign(new Error('Put { "client_id": "..." } at data/tokens/microsoft-client.json first (see docs/microsoft-setup.md).'), { status: 409 });
      const base = loginBase(c.tenant);
      const id = crypto.randomBytes(5).toString('hex');
      const state = crypto.randomBytes(16).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        const reply = (s, t) => { res.writeHead(s, { 'content-type': 'text/plain; charset=utf-8' }); res.end(t); };
        if (u.searchParams.get('state') !== state) return reply(400, 'Wrong state.');
        const code = u.searchParams.get('code');
        if (!code) {
          const why = u.searchParams.get('error_description') || 'Sign-in was cancelled.';
          reply(200, `${why} You can close this tab.`);
          return finish(id, { status: 'error', error: why.split('\r')[0].slice(0, 300) });
        }
        try {
          const t = await fetchImpl(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: c.client_id, redirect_uri: `http://localhost:${server.address().port}`, grant_type: 'authorization_code', code_verifier: verifier, scope: SCOPE }) });
          const j = await t.json();
          if (!j.refresh_token) throw new Error(j.error_description?.split('\r')[0] ?? 'Microsoft gave no refresh token.');
          const p = await (await fetchImpl(endpoints.profile, { headers: { authorization: `Bearer ${j.access_token}` } })).json();
          saveToken(tokenFor(id), { refresh_token: j.refresh_token });
          finish(id, { status: 'connected', email: p.mail ?? p.userPrincipalName ?? '' });
          reply(200, 'JARVIS is connected. You can close this tab.');
        } catch (e) {
          finish(id, { status: 'error', error: e.message });
          reply(200, `Sign-in failed: ${e.message}`);
        }
      });
      await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
      listeners.set(id, server);
      setTimeout(() => { if (listeners.get(id) === server) finish(id, { status: 'error', error: 'Sign-in was not finished. Try again.' }); }, WAIT_MS).unref();
      const q = new URLSearchParams({ client_id: c.client_id, redirect_uri: `http://localhost:${server.address().port}`, response_type: 'code', response_mode: 'query', prompt: 'select_account', state, scope: SCOPE, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      write([...read(), { id, provider: 'microsoft', kind: KINDS.includes(kind) ? kind : 'Personal', name: String(name ?? '').trim().slice(0, 40) || kind || 'Personal', email: '', status: 'pending', added: now() }]);
      return { id, url: `${base}/authorize?${q}` };
    },
    // Microsoft has no revoke call for a refresh token: removing deletes ours; the app stays listed at myapps.microsoft.com until the user removes it there.
    async remove(id) {
      if (!read().some((x) => x.id === id)) return false;
      listeners.get(id)?.close(); listeners.delete(id);
      fs.rmSync(tokenFor(id), { force: true });
      write(read().filter((x) => x.id !== id));
      return true;
    },
  };
}
