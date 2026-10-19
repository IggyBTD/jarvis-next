// The browser sidecar's rules, as pure functions: which addresses may be opened, which clicks look like a submit, which fields may
// never be typed into. The sidecar enforces these itself; the router's gate is a second layer, not the only one.
import dns from 'node:dns/promises';
import net from 'node:net';

const toInt = (ip) => ip.split('.').reduce((x, y) => x * 256 + Number(y), 0);
const PRIV = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]];
const inCidr = (ip, [base, bits]) => { const size = 2 ** (32 - bits); const s = toInt(base); const x = toInt(ip); return x >= s && x < s + size; };

// True for any address that is not a normal public one: loopback, private, link-local (cloud metadata), CGNAT, multicast,
// unique-local IPv6, and IPv4 hidden inside IPv6 (mapped, 6to4 style forms).
export function isPrivateAddress(ip) {
  let a = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = a.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/) ?? a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) a = mapped[2] ? `${parseInt(mapped[1], 16) >> 8}.${parseInt(mapped[1], 16) & 255}.${parseInt(mapped[2], 16) >> 8}.${parseInt(mapped[2], 16) & 255}` : mapped[1];
  if (net.isIPv4(a)) return PRIV.some((c) => inCidr(a, c));
  if (net.isIPv6(a)) return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff') || a.startsWith('2002:') || a.startsWith('64:ff9b') || a.startsWith('100:');
  return true; // not an address we understand: treat as unsafe
}

const hostMatches = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * Decides whether a page may open `raw`. Returns { ok: true, ask?: reason } or { ok: false, reason }.
 * `ask` marks addresses that could carry data out (very long, many parameters, long opaque values): the router asks the user.
 * resolve: injectable DNS (every address a name resolves to must be public). allowLoopback is for the test fixture only.
 */
export async function checkUrl(raw, { allow = [], deny = [], resolve = (h) => dns.lookup(h, { all: true }), allowLoopback = false } = {}) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'not a valid address' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'only http and https addresses are opened' };
  if (u.username || u.password) return { ok: false, reason: 'addresses with a user name or password are not opened' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, reason: 'no host in the address' };
  if (hostMatches(host, deny)) return { ok: false, reason: 'this site is on the deny list' };
  if (allow.length && !hostMatches(host, allow)) return { ok: false, reason: 'this site is not on the allow list' };
  const loop = (a) => allowLoopback && /^(127\.|::1$)/.test(a);
  if (net.isIP(host)) { if (isPrivateAddress(host) && !loop(host)) return { ok: false, reason: 'private and local network addresses are blocked' }; } else {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) { if (!(allowLoopback && host === 'localhost')) return { ok: false, reason: 'local names are blocked' }; } else {
      let addrs;
      try { addrs = await resolve(host); } catch { return { ok: false, reason: 'the host name does not resolve' }; }
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address) && !loop(a.address))) return { ok: false, reason: 'the host name points at a private or local address' };
    }
  }
  const params = [...u.searchParams];
  const opaque = params.some(([, v]) => v.length > 120 || /^[A-Za-z0-9+/=_-]{60,}$/.test(v));
  if (raw.length > 300 || params.length > 8 || opaque || u.hash.length > 200) return { ok: true, ask: 'long or data-carrying address' };
  return { ok: true };
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}`, 'iu');

// A click or Enter that would submit, pay, send, delete or confirm: by element type and by the words on it.
export function isSubmitLike({ tag, type, text, role, insideForm = false, patterns }) {
  const t = norm(tag);
  const ty = norm(type);
  if (ty === 'submit' || ty === 'image') return true;
  const label = norm(text);
  const buttonish = t === 'button' || role === 'button' || (t === 'input' && ['button', 'reset'].includes(ty)) || t === 'a';
  if (!buttonish) return false;
  if (t === 'button' && !ty && insideForm) return true; // a bare <button> inside a form submits it
  return patterns.some((p) => wordRe(p).test(label));
}

const SENSITIVE = /(pass(word|wd|code)?|pwd|cc-?(number|num|csc|exp|name)|card[-_ ]?(number|num|no|cvc|cvv)|cvc|cvv|csc|iban|account[-_ ]?number|routing|ssn|social[-_ ]?security|one[- ]time[- ]code|otp|pin\b)/i;
// Password and payment fields may never be typed into, whatever the page calls them.
export function isSensitiveField({ type, name, id, autocomplete, placeholder, ariaLabel }) {
  if (norm(type) === 'password') return true;
  if (/^(cc-|one-time-code|current-password|new-password)/i.test(autocomplete ?? '')) return true;
  return [name, id, autocomplete, placeholder, ariaLabel].some((v) => SENSITIVE.test(String(v ?? '')));
}

const CAPTCHA_FRAME = /(recaptcha|hcaptcha|turnstile|challenges\.cloudflare|captcha-delivery|arkoselabs|funcaptcha)/i;
const CAPTCHA_TEXT = /(verify you are (a )?human|are you a robot|i'?m not a robot|unusual traffic|complete the security check|press and hold)/i;
export const looksLikeCaptcha = ({ frameUrls = [], text = '' }) => frameUrls.some((u) => CAPTCHA_FRAME.test(u)) || CAPTCHA_TEXT.test(text.slice(0, 4000));
