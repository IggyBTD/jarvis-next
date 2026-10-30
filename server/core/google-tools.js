// Model-facing Google tools, read only: Calendar, Gmail and Drive for every account connected on the Accounts page. The
// definitions (names, parameters, tier) are in config/server/actions.json; this file holds the handlers. Each call goes through
// the router like any other tool (policy, audit, untrusted wrapping), uses the account's own encrypted refresh token and never
// writes anything to Google. Without an `account` argument a call covers every connected account.
import { createGoogle, AuthError } from '../digest/google.js';
import { clip } from '../../shared/util.js';

const q = encodeURIComponent;
const b64 = (s) => Buffer.from(s ?? '', 'base64url').toString('utf8');
const HINT = ' If it keeps happening, remove the account on the Accounts page and connect it again.';
const DOC = 'application/vnd.google-apps.';

const stripHtml = (h) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

export function mailBody(payload) {
  const found = { plain: null, html: null };
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data) found.plain ??= b64(p.body.data);
    else if (p.mimeType === 'text/html' && p.body?.data) found.html ??= b64(p.body.data);
    (p.parts ?? []).forEach(walk);
  };
  walk(payload);
  return found.plain ?? (found.html ? stripHtml(found.html) : '');
}
const attachments = (payload) => { const out = []; const walk = (p) => { if (p?.filename) out.push(p.filename); (p?.parts ?? []).forEach(walk); }; walk(payload); return out; };

export function registerGoogleTools(router, { accounts, clientFile, create = createGoogle, now = Date.now }) {
  const clients = new Map(); // account id -> client, which keeps that account's short-lived access token
  const clientFor = (a) => { if (!clients.has(a.id)) clients.set(a.id, create({ clientFile, tokenFile: a.tokenFile })); return clients.get(a.id); };
  const label = (a) => a.email || a.name;
  const why = (e) => e.message + (e instanceof AuthError ? HINT : '');

  function pick(account) {
    const all = accounts.connected();
    if (!all.length) throw new Error('No Google account is connected. Connect one on the Accounts page.');
    if (!account) return all;
    const w = account.trim().toLowerCase();
    const hit = all.filter((a) => [a.name, a.email, a.kind].some((x) => x && x.toLowerCase() === w));
    if (!hit.length) throw new Error(`No connected account matches "${account}". Connected: ${all.map(label).join(', ')}.`);
    return hit;
  }

  // Runs fn for each chosen account. One account failing does not hide the others; all failing is an error.
  async function gather(account, fn) {
    const runs = await Promise.all(pick(account).map(async (a) => { try { return { items: await fn(clientFor(a), a) }; } catch (e) { return { error: `${label(a)}: ${why(e)}` }; } }));
    const errors = runs.filter((r) => r.error).map((r) => r.error);
    if (errors.length === runs.length) throw new Error(errors.join('; '));
    return { items: runs.flatMap((r) => r.items ?? []), ...(errors.length ? { errors } : {}) };
  }

  // For an id: asks each chosen account until one has it.
  async function firstOf(account, fn) {
    const errors = [];
    for (const a of pick(account)) {
      try { return await fn(clientFor(a), a); } catch (e) { errors.push(`${label(a)}: ${e.status === 404 || e.status === 400 ? 'not found' : why(e)}`); }
    }
    throw new Error(errors.join('; '));
  }

  const reg = (name, handler) => router.register({ name, handler });

  reg('google_calendar_events', ({ account, days = 7 }) => {
    const from = new Date(now());
    const to = new Date(from.getTime() + days * 86_400_000);
    return gather(account, async (g, a) => {
      // ponytail: each account's primary calendar only; add calendarList if shared or school calendars are needed
      const j = await g.api(g.endpoints.calendar, `/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${q(from.toISOString())}&timeMax=${q(to.toISOString())}`);
      return (j.items ?? []).filter((e) => e.status !== 'cancelled').map((e) => ({ account: label(a), start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, allDay: !e.start?.dateTime, title: e.summary ?? '(no title)', location: e.location ?? '' }));
    }).then((r) => ({ ...r, items: r.items.sort((x, y) => Date.parse(x.start) - Date.parse(y.start)) }));
  });

  reg('google_gmail_search', ({ account, query = 'in:inbox', max = 10 }) => gather(account, async (g, a) => {
    const list = await g.api(g.endpoints.gmail, `/users/me/messages?q=${q(query)}&maxResults=${max}`);
    return Promise.all((list.messages ?? []).map(async (m) => {
      const d = await g.api(g.endpoints.gmail, `/users/me/messages/${q(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const h = (n) => d.payload?.headers?.find((x) => x.name === n)?.value ?? '';
      return { account: label(a), id: m.id, from: h('From'), subject: h('Subject'), date: h('Date'), unread: (d.labelIds ?? []).includes('UNREAD'), snippet: d.snippet ?? '' };
    }));
  }));

  reg('google_gmail_read', ({ account, id }) => firstOf(account, async (g, a) => {
    const d = await g.api(g.endpoints.gmail, `/users/me/messages/${q(id)}?format=full`);
    const h = (n) => d.payload?.headers?.find((x) => x.name === n)?.value ?? '';
    return { account: label(a), id, from: h('From'), to: h('To'), cc: h('Cc'), subject: h('Subject'), date: h('Date'), attachments: attachments(d.payload), body: clip(mailBody(d.payload) || d.snippet || '', 5000) };
  }));

  reg('google_drive_search', ({ account, query, max = 10 }) => gather(account, async (g, a) => {
    const t = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const params = `q=${q(`trashed = false and (name contains '${t}' or fullText contains '${t}')`)}&pageSize=${max}&orderBy=${q('modifiedTime desc')}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${q('files(id,name,mimeType,modifiedTime,owners(displayName))')}`;
    const j = await g.api(g.endpoints.drive, `/files?${params}`);
    return (j.files ?? []).map((f) => ({ account: label(a), id: f.id, name: f.name, type: f.mimeType.startsWith(DOC) ? f.mimeType.slice(DOC.length) : f.mimeType, modified: f.modifiedTime, owner: f.owners?.[0]?.displayName ?? '' }));
  }));

  reg('google_drive_read', ({ account, id }) => firstOf(account, async (g, a) => {
    const meta = await g.api(g.endpoints.drive, `/files/${q(id)}?supportsAllDrives=true&fields=${q('id,name,mimeType,size,modifiedTime')}`);
    const base = { account: label(a), id, name: meta.name, type: meta.mimeType, modified: meta.modifiedTime };
    const exportAs = meta.mimeType === `${DOC}spreadsheet` ? 'text/csv' : [`${DOC}document`, `${DOC}presentation`].includes(meta.mimeType) ? 'text/plain' : null;
    const plain = meta.mimeType.startsWith('text/') || meta.mimeType === 'application/json';
    if (!exportAs && !(plain && Number(meta.size ?? 0) <= 2_000_000)) return { ...base, note: 'This is not a text file (or it is very large), so only its details are available.' };
    const path = exportAs ? `/files/${q(id)}/export?mimeType=${q(exportAs)}` : `/files/${q(id)}?alt=media&supportsAllDrives=true`;
    return { ...base, content: clip(await g.api(g.endpoints.drive, path, 'text'), 5000) };
  }));
}
