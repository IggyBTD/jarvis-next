// Fake Google: token endpoint, Calendar events and Gmail messages. Scriptable failures: tokenError ('invalid_grant'), calendarStatus, gmailStatus.
import http from 'node:http';

export async function startFakeGoogle() {
  const state = { tokenError: null, calendarStatus: 200, gmailStatus: 200, events: [], mails: [], tokenCalls: 0, requests: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    state.requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/token') { state.tokenCalls += 1; return state.tokenError ? json(400, { error: state.tokenError }) : json(200, { access_token: 'acc', expires_in: 3600 }); }
    if (req.headers.authorization !== 'Bearer acc') return json(401, {});
    if (url.pathname.startsWith('/calendar/')) return state.calendarStatus === 200 ? json(200, { items: state.events }) : json(state.calendarStatus, {});
    if (url.pathname === '/gmail/users/me/messages') return state.gmailStatus === 200 ? json(200, { messages: state.mails.map((m) => ({ id: m.id })) }) : json(state.gmailStatus, {});
    const m = url.pathname.match(/^\/gmail\/users\/me\/messages\/(\w+)$/);
    if (m) { const mail = state.mails.find((x) => x.id === m[1]); return json(200, { threadId: `th${mail.id}`, snippet: mail.snippet, payload: { headers: [{ name: 'From', value: mail.from }, { name: 'Subject', value: mail.subject }] } }); }
    return json(404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { state, endpoints: { token: `${base}/token`, calendar: `${base}/calendar`, gmail: `${base}/gmail` }, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
