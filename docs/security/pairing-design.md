# Per-device pairing

Module: `server/core/devices.js`. Test: `tests/unit/sec-c-devices.test.js`. Answers F3-1 and F3-4 of the audit in `fix-run.md`. The module is written and tested; nothing calls it yet. The wiring list is at the end.

## The threat

One shared UI token is full authority on every device. It sits in a link (Safari history, Share sheet), on a command line and in a zip. A lost phone or a leaked link, plus tailnet access, can approve anything, T3 included, set Bypass and read every chat. The only remedy is to re-enrol everything, and the old token keeps working for 60 minutes on 7410 and until a restart on 7411.

## What changes

Each device has its own random 256-bit token. `data/devices.json` holds only a sha256 of it, with id, name, kind, scopes, createdAt, lastSeenAt, lastIp and revokedAt. Every call reads the file, so a revoke or a rotation applies at once in the server, in the starter, and to sockets that are already open (`can()` looks the device up again, it does not trust the object kept on the socket). Writers take a lock file, so two processes cannot undo each other. A file that cannot be parsed lets nobody in and is never overwritten.

## Scopes

| Scope | Covers | Why |
| --- | --- | --- |
| `chat` | Send and stop messages, read chats and state, digest, voice, reminders, `action.invoke`, `agent.task`, `wake.pc`, model list, environment, OSINT, the starter's `/health` and `/start`, and `target.set` | Everything here either reads or ends at the gate. The target picks where a gated action runs; it does not make the gate ask less. The phone app has a target switch and nothing else from the rows below. |
| `approve` | `gate.reply` approve for T0 to T2. T3 also needs the step-up. | Splits "can talk to the model" from "can let the model act". |
| `settings` | `mode.set` (not bypass), `backend.set`, `POST /api/model`, `GET /api/audit`, `/api/browser/*`, the OpenSky key, the device list | Each one changes how much the gate asks, or reads everything, or drives a logged-in browser. |
| step-up (`admin`) | `mode.set bypass`, `POST /api/project`, start a pairing, revoke or rotate another device, change the PIN | Needs `settings` and the step-up. Each one removes a protection or creates authority. |

Step-up means one of two things: the device is of kind `desktop` and the request comes from loopback, or the owner's PIN is sent with the request. A desktop can only be paired with the command on the PC, so loopback alone is never enough. Any device may deny a request. A device may always revoke or rotate itself. A device can approve a request its own chat caused: that is the normal flow and cannot be told apart from an attack; the split that matters is that T3 never passes on a token alone.

Defaults: desktop `chat approve settings`, Mac browser `chat approve settings`, phone `chat approve`. The one who starts the pairing may give fewer. The new device cannot choose its kind or scopes.

## Pairing

1. Someone with authority asks for a code: the command on the PC, or Settings > Devices > Add device on a device that passes the step-up. They pick the kind.
2. The code is 8 characters from `ABCDEFGHJKMNPQRSTVWXYZ23456789`, shown as `XXXX-XXXX`. It works once and lasts 5 minutes. At most 3 wait at a time. The store keeps a hash of it.
3. The new device opens the plain address (no token in it), types the code and a name, and gets its token once in the response body. It keeps it in localStorage.
4. Wrong codes: 5 from one address block that address for 10 minutes, right code included. 10 from anywhere kill every waiting code. A guess has a 1 in 6.5 x 10^11 chance, so the limit is far below what a search needs.

First device: nothing is paired, so the command on the PC makes the code (`node scripts/devices.js pair desktop`), and the desktop window shows the code field on first run. Phone and Mac browser: the code comes from the desktop's Add device button or from the same command with `phone` or `browser`.

## PIN

Set from the desktop on loopback or with the command on the PC; the command also replaces a forgotten PIN. Changing it from another device needs the current PIN. 6 to 64 characters, stored as scrypt (N 32768, r 8, p 1, 16-byte salt), compared in constant time. 5 wrong PINs lock it for 15 minutes; each lockout in a row doubles that, up to a day. While locked the right PIN is refused too. The lock covers every device, because there is one PIN; the desktop on loopback still works. A 6-digit PIN does not survive an attacker who can read `data/devices.json` (a million scrypt runs), so that file must stay unreadable for the coding agent (stage A already makes `data/` T3).

## Rotation and revocation

`revoke(id)` ends one device at once; ws.js then closes its sockets. `rotate(id)` gives one device a new token with no grace; a device can do this for itself over its own connection. `rotate('all')` is for the command on the PC after a leak: every paired token dies at once. The new tokens are printed once, but a phone cannot take a 64-character token by hand, so in practice: `rotate all`, `revoke legacy`, then pair each device again.

## The starter on 7411

It builds its own `createDevices({ dataDir, legacyToken })` on the same folder and calls `authenticate()` then `can(p, 'chat')` on every request. No token is read at start any more, so a revoked or rotated token fails there on the next request. It also needs the failures-only limiter from auth.js (F3-2).

## Migration, for the owner

Until step 5 the old `ui.token` keeps working as a device called `legacy` with `chat` and `approve`: the phone and the Mac go on chatting, approving T0 to T2 and switching target. It cannot touch settings, and cannot approve T3 until a PIN exists.

1. On the PC: `node scripts/devices.js pair desktop`. Open the desktop window and type the code.
2. In the desktop window: Settings > Devices > set a PIN.
3. Phone: Add device > Phone on the desktop. On the phone remove the old home-screen icon, open the plain address in Safari, Add to Home Screen, open it and type the code. Clear the old link from Safari history.
4. Mac: Add device > Browser. Open the plain address on the Mac, type the code. Do the same for anything on the Mac that reads `ui.token` (`open-mac.js`).
5. On the PC: `node scripts/devices.js revoke legacy`. The command also rotates `ui.token` with no grace, so the leaked value stays dead even if `devices.json` is ever deleted.
6. Delete `dist-mac/jarvis-mac-with-tokens.zip` and stop using `client-link.js` links.

Machine and model tokens (agents, OpenCode) are untouched.

## What this does not cover

- Traffic is plain HTTP inside the tailnet. A token or PIN sent to a raw home address is readable on that network (F3-6). Fix: TLS with server authentication, tailnet names only.
- DNS rebinding passes the Origin check (F3-7). Fix: a Host allowlist.
- A proxy on the PC (`tailscale serve`) makes every caller loopback. The desktop rule also needs the desktop's own token, but a stolen desktop token would then pass T3 through the proxy. The driver must pass a non-loopback `ip` when a forwarding header is present (see wiring).
- Script that runs in a paired page (CH-3, no CSP yet) has that device's token. Scopes and the PIN limit what it can do; CSP is the fix.
- The browser view shares one logged-in profile; `settings` gates who can drive it, nothing more.
- A process that can write `data/devices.json` can add a device. Stage A keeps the coding agent out of `data/`.
- Wrong codes can be used to kill a waiting code, and wrong PINs to lock the PIN. Both fail closed.

## Wiring, for the driver

Create one instance in `server/index.js`: `createDevices({ dataDir: cfg.dataDir, legacyToken: () => <current ui.token, read from the file each call, never the .prev file> })`.

- **auth.js** `authenticate()`: for a bearer, call `devices.authenticate(token, { ip })` first and return its principal. Remove the direct match against `tokens.ui` (and its `.prev` grace); if it stays, a revoked legacy token still gets in. Machine and model matching stays as it is.
- **ws.js** upgrade: keep the principal as `c.principal`. Every handler calls `devices.can(c.principal, what, opts)` before acting and answers `{ type: 'error', reason }` on a no. `chat.send`, `chat.abort`, `action.invoke`, `agent.task`, `agent.abort`, `digest.*`, `voice.*`, `reminder.dismiss`, `wake.pc`: `'chat'`. `target.set`: `'target'`. `backend.set`: `'settings'`. `mode.set`: `'admin'` with `m.pin` when the mode is bypass, else `'settings'`. `gate.reply` deny: `'deny'`. `gate.reply` approve: `'approve'` with `{ tier, pin: m.pin, ip }`, where `tier` is read from `gate.pending()` by id. Never take the tier from the client message. Pass `c.principal.deviceId` on as the clientId so the audit names the device.
- **ip** everywhere: `req.socket.remoteAddress`, kept on the client at upgrade. If the request has `x-forwarded-for`, `forwarded` or a `tailscale-*` header, pass `'proxied'` instead.
- **protocol.js**: allow an optional `pin` string (at most 64) on `gate.reply` and `mode.set`. Never log or audit it.
- **http.js**: `can(verdict.principal, ...)` per route for the `ui` role: `/api/project` `'admin'`; `/api/audit`, `/api/model` POST, `/api/browser/*`, OpenSky key `'settings'`; the rest `'chat'`. New routes: `POST /api/devices/pair` (no token; caller allowlist and Origin check still apply; body `{ code, name }`; answers `completePairing()` with `cache-control: no-store`), `POST /api/devices/pair/start` (`startPairing({ by, kind, scopes, pin, ip })`), `GET /api/devices` (`'settings'`; `{ devices: list(), ...info() }`), `POST /api/devices/revoke`, `/rotate`, `/pin` (pass `by`, `pin`, `ip`; the module checks the rest). After a revoke or rotate, close that device's sockets.
- **pc-starter.js**: as above. No token in the launcher address.
- **scripts/devices.js** (new CLI, PC only, passes `by: LOCAL`): `pair <desktop|browser|phone>`, `list`, `revoke <id|legacy>` (for legacy also `rotateToken(cfg, 'ui', { graceMs: 0 })`), `rotate <id|all>`, `pin` (read from a prompt, not from argv).
- **Audit** one line for each: pairing started, device paired, revoke, rotate, PIN changed, PIN refused or locked, with the device id and never a secret.
- **launch-app.js, client-link.js, phone-launcher.js, make-mac-bundle.js**: stop putting a token in an address, on a command line or in a zip.

Client screens:

- Phone app and desktop: a first-run screen with a code field (8 characters, shown as `XXXX-XXXX`, capitals, `autocapitalize="characters"`, `autocomplete="off"`) and a name field. It replaces reading `#token` from the address.
- T3 approval cards: a PIN field (`type="password"`, `inputmode="numeric"`, `autocomplete="off"`) unless this is the desktop window. Show "wrong PIN" and "locked until" from the reason. The same field for Bypass and for the trusted project folder.
- Desktop Settings > Devices: the list (name, kind, scopes, last seen, last address), Revoke per row, Add device (kind, then the code and its countdown), Set PIN, and a warning row while `info().legacy` is true.
- Any device: "Sign out this device" (revokes itself), and a hint to pair again when a settings action is refused.

Open point: the phone's launcher (7411) and the app (7410) are two origins, so they do not share localStorage, and the token may not travel in the address between them. Simplest fix: the starter serves the built phone app itself, so the phone has one origin and one token, and the app calls 7410 across origins with the bearer (add that origin to the server's list). This has to be checked on a real phone.
