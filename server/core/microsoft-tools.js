// Model-facing Microsoft 365 tools, read only: Outlook mail, Calendar and OneDrive search for every Microsoft account connected on
// the Accounts page, through Microsoft Graph. Same rules as google-tools.js (definitions in config/server/actions.json, category
// `google`, one encrypted refresh token per account, nothing is ever written). Without an `account` argument a call covers every
// connected account.
import { AuthError, saveToken, loadToken } from '../digest/google.js';
import { cleanBody } from './google-tools.js';
import { login, SCOPE } from '../accounts/microsoft-accounts.js';
import { readJson, clip } from '../../shared/util.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const HINT = ' If it keeps happening, remove the account on the Accounts page and connect it again.';
const BODY = 1200;
const BODY_FULL = 5000;
const q = encodeURIComponent;
const who = (r) => (r?.emailAddress ? `${r.emailAddress.name ?? ''} <${r.emailAddress.address ?? ''}>`.trim() : '');

export function createMicrosoft({ clientFile, tokenFile, fetchImpl = fetch, now = Date.now, loginBase = login }) {
  let access = null;
  async function accessToken() {
    if (access && access.exp > now() + 60_000) return access.token;
    const c = readJson(clientFile);
    let saved;
    try { saved = loadToken(tokenFile); } catch (e) { throw new AuthError(`the saved Microsoft token cannot be read (${e.message})`); }
    if (!c?.client_id || !saved?.refresh_token) throw new AuthError('Microsoft is not set up for this account.');
    const res = await fetchImpl(`${loginBase(c.tenant)}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, refresh_token: saved.refresh_token, grant_type: 'refresh_token', scope: SCOPE }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) throw new AuthError(`Microsoft refused the sign-in (${j.error ?? res.status}${j.error_description ? `: ${j.error_description.split('\r')[0]}` : ''})`);
      throw new Error(`Microsoft token endpoint answered ${res.status}`);
    }
    if (j.refresh_token && j.refresh_token !== saved.refresh_token) saveToken(tokenFile, { refresh_token: j.refresh_token }); // Microsoft rotates them
    access = { token: j.access_token, exp: now() + (j.expires_in ?? 3600) * 1000 };
    return access.token;
  }
  async function api(path, headers = {}) {
    const res = await fetchImpl(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${await accessToken()}`, ...headers } });
    if (res.status === 401 || res.status === 403) {
      access = null;
      let why = '';
      try { why = (await res.json())?.error?.message ?? ''; } catch { /* no body */ }
      throw new AuthError(`Microsoft refused the request (${res.status}${why ? `: ${why}` : ''})`);
    }
    if (!res.ok) throw Object.assign(new Error(`Microsoft answered ${res.status}`), { status: res.status });
    return res.json();
  }
  return { api };
}

export function registerMicrosoftTools(router, { accounts, clientFile, create = createMicrosoft, now = Date.now }) {
  const clients = new Map();
  const clientFor = (a) => { if (!clients.has(a.id)) clients.set(a.id, create({ clientFile, tokenFile: a.tokenFile })); return clients.get(a.id); };
  const label = (a) => a.email || a.name;
  const why = (e) => e.message + (e instanceof AuthError ? HINT : '');

  function pick(account) {
    const all = accounts.connected();
    if (!all.length) throw new Error('No Microsoft account is connected. Connect one on the Accounts page.');
    if (!account) return all;
    const w = account.trim().toLowerCase();
    const hit = all.filter((a) => [a.name, a.email, a.kind].some((x) => x && x.toLowerCase() === w));
    if (!hit.length) throw new Error(`No connected account matches "${account}". Connected: ${all.map(label).join(', ')}.`);
    return hit;
  }
  async function gather(account, fn) {
    const runs = await Promise.all(pick(account).map(async (a) => { try { return { items: await fn(clientFor(a), a) }; } catch (e) { return { error: `${label(a)}: ${why(e)}` }; } }));
    const errors = runs.filter((r) => r.error).map((r) => r.error);
    if (errors.length === runs.length) throw new Error(errors.join('; '));
    return { items: runs.flatMap((r) => r.items ?? []), ...(errors.length ? { errors } : {}) };
  }
  async function firstOf(account, fn) {
    const errors = [];
    for (const a of pick(account)) {
      try { return await fn(clientFor(a), a); } catch (e) { errors.push(`${label(a)}: ${e.status === 404 || e.status === 400 ? 'not found' : why(e)}`); }
    }
    throw new Error(errors.join('; '));
  }
  const reg = (name, handler) => router.register({ name, handler });

  reg('microsoft_calendar_events', ({ account, days = 7 }) => {
    const from = new Date(now());
    const to = new Date(from.getTime() + days * 86_400_000);
    return gather(account, async (g, a) => {
      // ponytail: each account's default calendar only; add /me/calendars if shared or school calendars are needed
      const j = await g.api(`/me/calendarView?startDateTime=${q(from.toISOString())}&endDateTime=${q(to.toISOString())}&$orderby=start/dateTime&$top=50&$select=subject,start,end,location,isAllDay,isCancelled`, { prefer: 'outlook.timezone="UTC"' });
      const iso = (t) => (t?.dateTime ? new Date(`${t.dateTime.slice(0, 19)}Z`).toISOString() : undefined);
      return (j.value ?? []).filter((e) => !e.isCancelled).map((e) => ({ account: label(a), start: iso(e.start), end: iso(e.end), allDay: !!e.isAllDay, title: e.subject ?? '(no title)', location: e.location?.displayName ?? '' }));
    }).then((r) => ({ ...r, items: r.items.sort((x, y) => Date.parse(x.start) - Date.parse(y.start)) }));
  });

  reg('microsoft_mail_search', ({ account, query, max = 10, unread }) => gather(account, async (g, a) => {
    const sel = '$select=id,subject,from,receivedDateTime,isRead,bodyPreview';
    // Graph cannot sort a $search, so a query is ranked by relevance; no query lists the inbox newest first.
    const path = query
      ? `/me/messages?$search=${q(`"${query.replace(/"/g, '')}"`)}&$top=${max}&${sel}`
      : `/me/mailFolders/inbox/messages?$top=${max}&$orderby=receivedDateTime desc${unread ? `&$filter=${q('isRead eq false')}` : ''}&${sel}`;
    const j = await g.api(path);
    return (j.value ?? []).map((m) => ({ account: label(a), id: m.id, from: who(m.from), subject: m.subject ?? '', date: m.receivedDateTime, unread: m.isRead === false, snippet: m.bodyPreview ?? '' }));
  }));

  const readMail = (account, id, limit) => firstOf(account, async (g, a) => {
    const m = await g.api(`/me/messages/${q(id)}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview&$expand=attachments($select=name)`, { prefer: 'outlook.body-content-type="text"' });
    return { account: label(a), id, from: who(m.from), to: (m.toRecipients ?? []).map(who).join(', '), cc: (m.ccRecipients ?? []).map(who).join(', '), subject: m.subject ?? '', date: m.receivedDateTime, attachments: (m.attachments ?? []).map((x) => x.name), body: clip(cleanBody(m.body?.content) || m.bodyPreview || '', limit) };
  });
  reg('microsoft_mail_read', async ({ account, id, ids, full }) => {
    if (!ids?.length) { if (!id) throw new Error('Give an id, or ids to read several mails at once.'); return readMail(account, id, full ? BODY_FULL : BODY); }
    const limit = full ? Math.min(BODY_FULL, Math.floor(12_000 / ids.length)) : BODY;
    return { items: await Promise.all(ids.map((i) => readMail(account, i, limit).catch((e) => ({ id: i, error: e.message })))) };
  });

  // ponytail: search only (names, dates, ids); reading file contents needs per-type conversion, add when asked
  reg('microsoft_onedrive_search', ({ account, query, max = 10 }) => gather(account, async (g, a) => {
    const j = await g.api(`/me/drive/root/search(q='${q(query.replace(/'/g, "''"))}')?$top=${max}&$select=id,name,file,folder,lastModifiedDateTime,createdBy,webUrl`);
    return (j.value ?? []).map((f) => ({ account: label(a), id: f.id, name: f.name, type: f.folder ? 'folder' : f.file?.mimeType ?? '', modified: f.lastModifiedDateTime, owner: f.createdBy?.user?.displayName ?? '', link: f.webUrl }));
  }));
}
