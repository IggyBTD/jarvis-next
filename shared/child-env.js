// The one place that decides the environment a child program gets (docs/security/secrets-design.md).
// From the parent's environment only an allowlist survives: what a program needs to start. A name that looks like a secret is
// dropped even when the caller passes it as an extra, unless the caller lists it in allowSecret. Pure: no reads of process.env.

// Proxy variables are left out on purpose (their addresses can carry a password); SSH_AUTH_SOCK too (it lends out the user's keys).
const KEEP = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|ALLUSERSPROFILE|PUBLIC|PROGRAMFILES(\(X86\))?|PROGRAMW6432|COMMONPROGRAMFILES(\(X86\))?|COMMONPROGRAMW6432|USER|USERNAME|USERDOMAIN|COMPUTERNAME|LOGNAME|LANG|LANGUAGE|LC_\w+|TZ|SHELL|TERM|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|XDG_\w+|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|__CF_USER_TEXT_ENCODING)$/i;

const SECRET_WORD = /TOKEN|KEY|SECRET|PASS|_PWD$|AUTH|COOKIE|CRED|SESSION|BEARER|PRIVATE|SIGNATURE|DSN|CONNECTION_?STRING/i;
const SECRET_PREFIX = /^(OPENCODE|JARVIS|ANTHROPIC|CLAUDE|OPENAI|AZURE|AWS|GCP|GOOGLE|GEMINI|GITHUB|GH|GITLAB|NPM_CONFIG|DOCKER|HF|HUGGINGFACE|OPENSKY|AISSTREAM|MS|MICROSOFT|STRIPE|SLACK|TWILIO|SENTRY)_/i;

export const isSecretName = (name) => typeof name !== 'string' || SECRET_WORD.test(name) || SECRET_PREFIX.test(name);

/**
 * base: the parent's environment (filtered by the allowlist, minus secret-looking names).
 * extra: variables this child needs (kept, unless the name looks secret and is not in allowSecret). An extra replaces a base
 * variable of the same name in any letter case, as Windows would.
 * allowSecret: exact names (any case) or RegExps the caller hands over on purpose, for example OpenCode's own password.
 * Always returns a new object.
 */
export function childEnv(base, extra = {}, { allowSecret = [] } = {}) {
  const allow = Array.isArray(allowSecret) ? allowSecret : [];
  const deliberate = (k) => allow.some((a) => (a instanceof RegExp ? new RegExp(a.source, a.flags.replace(/[gy]/g, '')).test(k) : String(a).toUpperCase() === k.toUpperCase()));
  const out = new Map();
  const put = (k, v) => { if (k && !/[=\0]/.test(k) && v != null && !String(v).includes('\0')) out.set(k.toUpperCase(), [k, String(v)]); };
  for (const [k, v] of Object.entries(base ?? {})) if (KEEP.test(k) && !isSecretName(k)) put(k, v);
  for (const [k, v] of Object.entries(extra ?? {})) if (!isSecretName(k) || deliberate(k)) put(k, v);
  return Object.fromEntries(out.values());
}
