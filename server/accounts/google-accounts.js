// Google accounts added from the Accounts page. "Connect" returns Google's consent link (the app opens it in the browser), a
// one-shot loopback listener catches the redirect (PKCE + state), the code becomes an encrypted refresh token per account and the
// account's address is read from Gmail. Read-only scopes. Sign-in happens on the PC: the listener is this server's 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { saveToken, loadToken } from '../digest/google.js';
import { readJson, writeFileAtomic } from '../../shared/util.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE = { token: 'https://oauth2.googleapis.com/token', profile: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', revoke: 'https://oauth2.googleapis.com/revoke' };
const KINDS = ['Personal', 'School', 'Work'];
const WAIT_MS = 24 * 3_600_000; // an unfinished sign-in is dropped after this (a connected account never expires on our side)

export function createGoogleAccounts({ dataDir, clientFile, fetchImpl = fetch, endpoints = GOOGLE, authUrl = AUTH, now = Date.now }) {
  const listFile = path.join(dataDir, 'accounts.json');
  const tokenFor = (id) => path.join(dataDir, 'tokens', `google-${id}.enc`);
  const read = () => { const v = readJson(listFile, []); return Array.isArray(v) ? v : []; };
  const write = (l) => writeFileAtomic(listFile, JSON.stringify(l, null, 2), 0o600);
  const patch = (id, p) => write(read().map((a) => (a.id === id ? { ...a, ...p } : a)));
  const listeners = new Map(); // id -> server, so a restart-free retry or remove can close it
  const flows = new Map(); // id -> { state, handle(params) }: a sign-in waiting for Google's answer, from the listener or a pasted address

  function finish(id, p) { patch(id, p); listeners.get(id)?.close(); listeners.delete(id); flows.delete(id); }

  return {
    // what the model's Google tools read from: connected accounts only, with the file that holds each one's refresh token
    connected: () => read().filter((a) => a.status === 'connected').map((a) => ({ id: a.id, name: a.name, kind: a.kind, email: a.email, tokenFile: tokenFor(a.id) })),
    list() {
      return read().map((a) => (a.status === 'pending' && now() - a.added > WAIT_MS ? { ...a, status: 'error', error: 'Sign-in was not finished. Try again.' } : a));
    },
    async start({ kind, name }) {
      const c = readJson(clientFile)?.installed;
      if (!c) throw Object.assign(new Error('Put the Google OAuth desktop client JSON at data/tokens/google-client.json first (HUMAN_TODO.md section 4).'), { status: 409 });
      const id = crypto.randomBytes(5).toString('hex');
      const state = crypto.randomBytes(16).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      let server;
      // Google's answer (the query of the redirect), whoever brings it: -> { status, text }
      const handle = async (params) => {
        const reply = (s, t) => ({ status: s, text: t });
        if (params.get('state') !== state) return reply(400, 'Wrong state.');
        const code = params.get('code');
        if (!code) { finish(id, { status: 'error', error: 'Sign-in was cancelled.' }); return reply(200, 'Sign-in was cancelled. You can close this tab.'); }
        try {
          const redirect = `http://127.0.0.1:${server.address().port}`;
          const t = await fetchImpl(endpoints.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
          const j = await t.json();
          if (!j.refresh_token) throw new Error('Google gave no refresh token. Remove JARVIS at myaccount.google.com/permissions and try again.');
          const p = await (await fetchImpl(endpoints.profile, { headers: { authorization: `Bearer ${j.access_token}` } })).json();
          saveToken(tokenFor(id), { refresh_token: j.refresh_token });
          finish(id, { status: 'connected', email: p.emailAddress ?? '' });
          return reply(200, 'JARVIS is connected. You can close this tab.');
        } catch (e) {
          finish(id, { status: 'error', error: e.message });
          return reply(200, `Sign-in failed: ${e.message}`);
        }
      };
      server = http.createServer(async (req, res) => {
        const out = await handle(new URL(req.url, 'http://127.0.0.1').searchParams);
        res.writeHead(out.status, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(out.text);
      });
      flows.set(id, { state, handle });
      await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
      listeners.set(id, server);
      setTimeout(() => { if (listeners.get(id) === server) finish(id, { status: 'error', error: 'Sign-in was not finished. Try again.' }); }, WAIT_MS).unref();
      const q = new URLSearchParams({ client_id: c.client_id, redirect_uri: `http://127.0.0.1:${server.address().port}`, response_type: 'code', access_type: 'offline', prompt: 'consent', state, scope: SCOPE, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      write([...read(), { id, provider: 'google', kind: KINDS.includes(kind) ? kind : 'Personal', name: String(name ?? '').trim().slice(0, 40) || kind || 'Personal', email: '', status: 'pending', added: now() }]);
      return { id, url: `${authUrl}?${q}` };
    },
    // The browser that signed in is not always on this PC (the Mac's is not): Google's redirect then lands on the Mac's own localhost and
    // fails. The address the Mac's browser shows is pasted here instead; it only works for a sign-in that is waiting (the state is secret).
    async complete(pasted) {
      let u;
      try { u = new URL(String(pasted ?? '').trim()); } catch { throw Object.assign(new Error('That is not an address. Copy the whole address from the browser bar.'), { status: 400 }); }
      const flow = [...flows.values()].find((f) => f.state === u.searchParams.get('state'));
      if (!flow) throw Object.assign(new Error('No sign-in is waiting for this address. It may have timed out: connect again.'), { status: 400 });
      const out = await flow.handle(u.searchParams);
      return { ok: out.status === 200 && /connected/.test(out.text), message: out.text };
    },
    async remove(id) {
      const a = read().find((x) => x.id === id);
      if (!a) return false;
      listeners.get(id)?.close(); listeners.delete(id);
      try {
        const t = fs.existsSync(tokenFor(id)) && loadToken(tokenFor(id));
        if (t?.refresh_token) await fetchImpl(`${endpoints.revoke}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }).catch(() => {});
      } catch { /* unreadable token: still remove the account */ }
      fs.rmSync(tokenFor(id), { force: true });
      write(read().filter((x) => x.id !== id));
      return true;
    },
  };
}
