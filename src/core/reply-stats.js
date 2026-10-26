// What each reply cost, kept for the panel's Session card and the line under the reply. The server sends it with chat.done;
// the last 60 are kept in this browser's storage so a reload does not empty the card.
const KEY = 'jarvis.replies';
const subs = new Set();
let replies = [];
try { replies = JSON.parse(localStorage.getItem(KEY) ?? '[]').filter((r) => r && Number.isFinite(r.completionTokens)); } catch { replies = []; }

export const getReplies = () => replies.slice();
export const onReplies = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export function recordReply(stats) {
  if (!stats || !Number.isFinite(stats.completionTokens) || stats.completionTokens < 1) return;
  replies.push({ at: Date.now(), ...stats });
  replies = replies.slice(-60);
  try { localStorage.setItem(KEY, JSON.stringify(replies)); } catch { /* storage blocked */ }
  subs.forEach((cb) => cb(replies));
}
export function clearReplies() { replies = []; try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } subs.forEach((cb) => cb(replies)); }

const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
// "49 tok/s  890 tokens  18 s  2 tools": the line under a reply
export function statsLine(s) {
  const parts = [];
  if (s.tokensPerSec) parts.push(`${s.tokensPerSec} tok/s`);
  parts.push(`${fmtK(s.completionTokens)} tokens`);
  if (s.ttftMs != null) parts.push(`${(s.ttftMs / 1000).toFixed(1)} s to first token`);
  if (s.totalMs) parts.push(`${(s.totalMs / 1000).toFixed(s.totalMs < 10000 ? 1 : 0)} s`);
  if (s.tools) parts.push(`${s.tools} tool call${s.tools === 1 ? '' : 's'}`);
  return parts.join('  \u00b7  ');
}
export function summary() {
  const withSpeed = replies.filter((r) => r.tokensPerSec);
  const tokens = replies.reduce((n, r) => n + r.completionTokens, 0);
  const secs = withSpeed.reduce((n, r) => n + r.completionTokens / r.tokensPerSec, 0);
  return { count: replies.length, tokens, avg: secs ? tokens / secs : null, best: withSpeed.length ? Math.max(...withSpeed.map((r) => r.tokensPerSec)) : null, worst: withSpeed.length ? Math.min(...withSpeed.map((r) => r.tokensPerSec)) : null, speeds: withSpeed.map((r) => r.tokensPerSec) };
}
