// Read-only Google access for the digest: Gmail (gmail.readonly) and Calendar (calendar.readonly) over the REST APIs, with the
// OAuth refresh token kept encrypted on disk (AES-256-GCM, key from JARVIS_TOKEN_KEY). JARVIS never sends, labels, trashes or
// deletes mail. An expired or revoked grant is an AuthError, which the digest shows as a banner instead of an empty digest.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { writeFileAtomic, readJson } from '../../shared/util.js';

export class AuthError extends Error { constructor(m) { super(m); this.name = 'AuthError'; } }

const keyFor = (salt) => {
  const secret = process.env.JARVIS_TOKEN_KEY;
  if (!secret || secret.length < 16) throw new Error('set JARVIS_TOKEN_KEY (at least 16 characters) to store the Google token');
  return crypto.scryptSync(secret, salt, 32);
};
export function saveToken(file, obj) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(salt), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  writeFileAtomic(file, JSON.stringify({ v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }), 0o600);
}
export function loadToken(file) {
  const j = readJson(file);
  if (!j) return null;
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(Buffer.from(j.salt, 'base64')), Buffer.from(j.iv, 'base64'));
  d.setAuthTag(Buffer.from(j.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(j.data, 'base64')), d.final()]).toString('utf8'));
}

const GOOGLE = { token: 'https://oauth2.googleapis.com/token', calendar: 'https://www.googleapis.com/calendar/v3', gmail: 'https://gmail.googleapis.com/gmail/v1', drive: 'https://www.googleapis.com/drive/v3' };

export function createGoogle({ clientFile, tokenFile, fetchImpl = fetch, endpoints = GOOGLE, now = Date.now }) {
  let access = null;
  async function accessToken() {
    if (access && access.exp > now() + 60_000) return access.token;
    const client = readJson(clientFile);
    const c = client?.installed ?? client?.web;
    let saved;
    try { saved = loadToken(tokenFile); } catch (e) { throw new AuthError(`the saved Google token cannot be read (${e.message})`); }
    if (!c || !saved?.refresh_token) throw new AuthError('Google is not set up: run node scripts/google-auth.js');
    const res = await fetchImpl(endpoints.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: saved.refresh_token, grant_type: 'refresh_token' }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) throw new AuthError(j.error === 'invalid_grant' ? 'Google sign-in expired or was revoked: run node scripts/google-auth.js again' : `Google refused the sign-in (${j.error ?? res.status})`);
      throw new Error(`Google token endpoint answered ${res.status}`);
    }
    access = { token: j.access_token, exp: now() + (j.expires_in ?? 3600) * 1000 };
    return access.token;
  }
  // as: 'json' or 'text'. A refusal carries Google's own reason (API not enabled, scope not granted) so the person can act on it.
  async function api(base, path, as = 'json') {
    const res = await fetchImpl(`${base}${path}`, { headers: { authorization: `Bearer ${await accessToken()}` } });
    if (res.status === 401 || res.status === 403) {
      access = null;
      let why = '';
      try { why = (await res.json())?.error?.message ?? ''; } catch { /* no body */ }
      throw new AuthError(`Google refused the request (${res.status}${why ? `: ${why}` : ''})`);
    }
    if (!res.ok) throw Object.assign(new Error(`Google answered ${res.status}`), { status: res.status });
    return as === 'text' ? res.text() : res.json();
  }
  return {
    api, endpoints,
    async calendar(fromIso, toIso) {
      const j = await api(endpoints.calendar, `/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(fromIso)}&timeMax=${encodeURIComponent(toIso)}`);
      return (j.items ?? []).map((e) => ({ start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, allDay: !e.start?.dateTime, summary: e.summary ?? '(no title)', location: e.location ?? '' }));
    },
    // ponytail: snippet only (Google's own short preview); fetch and decode full bodies if the digest needs more than that.
    async gmailUnread(max = 25) {
      const list = await api(endpoints.gmail, `/users/me/messages?q=${encodeURIComponent('is:unread newer_than:2d -category:promotions')}&maxResults=${max}`);
      const out = [];
      for (const m of list.messages ?? []) {
        const d = await api(endpoints.gmail, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
        const h = (n) => d.payload?.headers?.find((x) => x.name === n)?.value ?? '';
        out.push({ id: m.id, threadId: d.threadId, from: h('From'), subject: h('Subject'), snippet: d.snippet ?? '' });
      }
      return out;
    },
  };
}
