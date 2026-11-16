# Secrets: storage, child environments, OpenCode (F4-5, part of CH-2)

Code: `shared/secret-store.js`, `shared/child-env.js`. Tests: `tests/unit/sec-c-secrets.test.js`. Nothing is wired yet; section 7 is the wiring list.

## 1. The threat

Every command the coding agent or an action runs is a program of the same OS user as JARVIS. Today it can read: the token files in `data/tokens` (plain text), the `JARVIS_TOKEN_KEY` user variable (`HKCU:\Environment`, and the command line of the windows `jarvis.ps1` opens), and whatever environment it inherited: the agent's whole environment for registry actions, and for OpenCode's commands very likely OpenCode's own password and the model token. Policy rates a read of `data/` as T3, but `set` or `Get-ChildItem env:` is T2, and T2 runs unasked in Bypass.

## 2. What each backend does and does not do

| Backend | Where | Stops | Does not stop |
|---|---|---|---|
| `dpapi` (win32) | `<dir>/<name>.dpapi`, DPAPI CurrentUser, the name bound in as entropy | a file read (`read_file`, `Get-Content`, a copied or backed-up folder, another Windows user, a zip) | any program running as the same user: one `ProtectedData.Unprotect` call opens it |
| `keychain` (darwin) | login Keychain, service `jarvis.<name>`, account `jarvis` | the same, plus the item is not a file in the project at all | any program of the same user that runs `security find-generic-password -w` while the Keychain is unlocked (the item trusts the `security` tool that made it) |
| `file` (other, tests, `fallbackOnly`) | `<dir>/<name>.secret`, mode 0600 | other OS users | everything else. `store.protected` is false; show that in doctor |

So the store turns "read a file" into "run a specific call". That is worth having because reads are easy to reach by accident or by injection and the call is something policy can name, but it is not isolation. Only a separate OS user is (section 4).

DPAPI over Credential Manager: Credential Manager is DPAPI underneath with the same same-user weakness, and writing it without the value on a command line (`cmdkey /pass:` is argv) needs compiled P/Invoke. DPAPI needs one fixed PowerShell line.

How the value travels. win32: `powershell.exe -NoProfile -NonInteractive -Command <fixed script>`, stdin is `<name>\n<base64>`, the blob or the value comes back as base64 on stdout. darwin: writing is `security -i` with the command `add-generic-password -U -a jarvis -s jarvis.<name> -w <hex>` on stdin, so argv is just `-i`; reading is `find-generic-password ... -w` (argv holds only names). The value is stored as hex text, so there is no quoting and no ambiguity in what `-w` prints. `security -i` reports nothing useful, so `set` reads the item back and fails if it differs. If `security -i` turns out not to work from a pipe on the real Mac, `set` returns an error (it never falls back to argv); the next best design is a random key in the Keychain made with `security add-generic-password -w` prompted by the person once, and AES files under it.

Limits: names match `^[a-z0-9][a-z0-9._-]{0,63}$` without `..`; values are 1 to 1024 bytes, no NUL. `get` is null for missing, damaged, swapped, locked or unreadable. A store on win32 or darwin without a `runProgram` refuses everything; it does not become a plain file by itself.

## 3. The child environment rule

`childEnv(base, extra, { allowSecret })` is the only thing that builds a child's environment. From `base` only the allowlist survives (PATH, SYSTEMROOT, TEMP, HOME, USERPROFILE, APPDATA, LANG and the like). A name that looks secret (TOKEN, KEY, SECRET, PASS, AUTH, COOKIE, CRED, SESSION, and the prefixes OPENCODE_, JARVIS_, ANTHROPIC_, CLAUDE_, OPENAI_, AWS_, GITHUB_, GOOGLE_, NPM_CONFIG_ and more) is dropped from `base` always and from `extra` unless it is in `allowSecret` (exact names or RegExps). `allowSecret` never lets a `base` variable through. Proxy variables and `SSH_AUTH_SOCK` are not on the allowlist; a caller that needs one passes it as an extra on purpose.

Checked against `KEEP` in `opencode-manager.js`: same set, plus SYSTEMDRIVE (was there), ALLUSERSPROFILE, PUBLIC, COMMONPROGRAMW6432, USERDOMAIN, COMPUTERNAME, LANGUAGE, TZ, SSL_CERT_FILE, SSL_CERT_DIR, `__CF_USER_TEXT_ENCODING`. `XDG_SESSION_*` now falls to the deny rule; nothing uses it. PSModulePath is left out on purpose (Windows PowerShell rebuilds it; an inherited pwsh 7 value breaks it).

## 4. OpenCode

What an exposed OpenCode password allows. The agent's proxy forwards only the listed routes (`shared/proxy-routes.js`), but that guards holders of a machine token. A command on the same machine skips the proxy and talks to 127.0.0.1:4096 with the password: the direct command route, any terminal route, "always" answers, config changes, file routes, the event stream. In effect: T3 with no approval and no audit entry, from any mode in which a command that prints the environment runs unasked. The model token in `OPENCODE_CONFIG_CONTENT` opens only `/v1` (free use of the local model, F5-2).

Can the password reach OpenCode without the environment? Not that the repo shows: the manager and the fake both use `OPENCODE_SERVER_PASSWORD` only. A flag would be argv (worse); a config field is not known. Check on the real 1.19.1: `opencode serve --help` and the config schema for a password or password-file option.

Now, in code (driver):
1. OpenCode starts with `childEnv(env, { ... }, { allowSecret: [/^OPENCODE_/] })`. Its children then inherit at most OpenCode's own variables, nothing of the agent's.
2. Tripwire in the permission bridge: the server knows every session it created and every permission answer it sent. An event for a session it did not create, or a `permission.replied` it did not send, means something else is driving OpenCode: stop the manager, void pending approvals, write an audit entry, tell the person. This does not prevent the first unasked command; it makes self-approval loud and ends the run. Check the event names on 1.19.1.
3. Policy: rate as T3 for the coding agent any command that lists the environment (`set`, `env`, `printenv`, `gci env:`, `$env:OPENCODE`, `GetEnvironmentVariable`, `process.env`), that names port 4096 or the agent and server ports, or that names `ProtectedData`, `Unprotect`, `find-generic-password` or `data/secrets`. A pattern list is a speed bump (a script file gets round it), so it comes after 1 and 2, not instead.
4. Rotation: the password is already new on every OpenCode start. Restarting OpenCode when a task ends and nothing is pending makes a leaked password useless for later tasks. It does nothing against use inside the same task, which is the main case; do it only if the restart cost (a few seconds, sessions reload from disk) is acceptable.
5. To verify, then wire if it holds: a wrapper as the shell OpenCode uses for commands (a generated script outside the workspace that unsets `OPENCODE_*` and starts the real shell, handed over through `SHELL`). Whether 1.19.1 honours `SHELL` on Windows is unknown. Even then the same user can read the parent process's environment (`ps eww` on the Mac, process memory on Windows), so this raises the bar and does not close it.

For the person (needs an administrator; not done unattended):
1. PC (Windows 11 Home: no Windows Sandbox): admin PowerShell, `New-LocalUser jarvis-agent` (standard user, not in Administrators). Give it Modify on the workspace folder only; `icacls <JARVIS root>\data /deny jarvis-agent:(OI)(CI)F`; the same for the JARVIS root if the workspace is elsewhere.
2. Install OpenCode 1.19.1 for that user. Register a scheduled task that runs a small launcher as `jarvis-agent` (stored credentials, "run whether user is logged on or not"); the agent starts the task instead of spawning OpenCode, and hands over the per-start password through a file only `jarvis-agent` and you may read. The launcher is new code to write once the account exists.
3. Mac: `sysadminctl -addUser jarvis-agent`, a sudoers line that lets your user run only `opencode serve` as it without a password, workspace group-writable. To try first without an administrator: `sandbox-exec` with a profile that denies reads of the JARVIS folder and `~/Library/Keychains` (deprecated by Apple, still present; children inherit it).
4. Test from an OpenCode command in each mode: token files, `data/secrets`, `HKCU:\Environment` and the agent's environment must be unreadable.

What remains even then: the separate user protects JARVIS's secrets and your files. It does not protect OpenCode's API from OpenCode's own commands, because the password lives in that user's process. Items 2 and 3 above stay necessary.

## 5. JARVIS_TOKEN_KEY

The key that encrypts the Google and Microsoft refresh tokens becomes the store entry `google-token-key`. At start: `secretOrEnv(store, 'google-token-key', process.env.JARVIS_TOKEN_KEY)` reads the store first, then the variable, and writes the store on that first use; then `delete process.env.JARVIS_TOKEN_KEY` so no child gets it. Existing token files keep working because the key is the same. `{ create: true }` (only in `google-auth.js`, an interactive sign-in) makes a random key on a fresh install; it never creates over an entry that exists but cannot be read, since that would orphan every saved token.

`scripts/jarvis.ps1` stops reading the key: no `GetEnvironmentVariable`, no `$env:JARVIS_TOKEN_KEY = '...'` in the command string, no warning. The windows still inherit the user variable until the person removes it, which is what makes the first-start migration work. After one start with Google working (doctor says so), the person runs `[Environment]::SetEnvironmentVariable('JARVIS_TOKEN_KEY', $null, 'User')` and opens new windows. Add that to HUMAN_TODO.md.

## 6. Not verified

- The DPAPI PowerShell line and the `security -i` path have only run against fakes. First real run: `set` then `get` of a throwaway name on the PC and on the Mac, and `ps` on the Mac while it runs.
- Whether `security -i` accepts a 2 KB line (the 1024-byte limit is a guess at its buffer) and whether the login Keychain is unlocked when the Mac agent starts from launchd or SSH (if not, `get` is null and the agent must say so, not start without a token).
- OpenCode 1.19.1: whether its commands inherit its environment, whether a password option other than the variable exists, event names for the tripwire, whether `SHELL` is honoured.
- What breaks under the clean environment: apps opened by actions lose user variables (JAVA_HOME, OneDrive and so on); `git`, `npm` and `code` started through `runProgram` need a run each.

## 7. Wiring (driver)

1. `agent/registry/common.js`: in `runProgram` and `spawnTracked`, `env: childEnv(process.env, env, { allowSecret: [/^JARVIS_A_/] })`. Registry arguments travel as `JARVIS_A_*`; without that entry every Windows action loses its arguments.
2. `agent/sidecars/opencode-manager.js`: `cleanEnv = (env, extra, allowSecret = []) => childEnv(env, extra, { allowSecret })`, drop `KEEP`; the spawn passes `[/^OPENCODE_/]`. Without it `OPENCODE_DISABLE_PROJECT_CONFIG` is dropped and project config comes back. Test extras (`FAKE_OPENCODE_*`) pass as they are.
3. `agent/sidecars/claude-manager.js`: unchanged call, `cleanEnv(env, {})`. `browser-manager.js`: allow `JARVIS_BROWSER_TOKEN` and `JARVIS_BROWSER_CHANNEL`.
4. Store construction, once per process: `createSecretStore({ dir: path.join(cfg.dataDir, 'secrets'), runProgram })`. The server may not import `child_process`; importing `runProgram` from `agent/registry/common.js` in `server/index.js` (the main block only) passes `check-chokepoint` and is the smallest way. Write that choice in decisions.md. Do this before step 1 lands or in the same commit: the PowerShell child needs nothing from the environment.
5. `server/digest/google.js`: `let tokenKey = null; export const setTokenKey = (k) => { tokenKey = k; };` and `keyFor` uses `tokenKey ?? process.env.JARVIS_TOKEN_KEY`. `server/index.js`, `scripts/google-auth.js` (with `create: true`) and `scripts/doctor.js` call `secretOrEnv` then `setTokenKey` before any token is loaded. The stale `dist-mac/stage` copy is rebuilt by the bundle script.
6. `scripts/jarvis.ps1`: section 5.
7. Token files (`server/core/auth.js`): recommended as a second step, after 1 to 6 are green. Machine tokens first (`pc-token`, `mac-token`): at start `migrateFile(store, 'pc-token', tokenPath(cfg, 'pc'))`, then `loadTokens` takes the values from the store (resolved once, kept in memory, since `loadTokens` is synchronous) and falls back to the file when the store has nothing. `rotateToken` and `generateTokens` write the store. Remove a plain file only after a restart has run on the store, and keep `.prev` handling as it is. `ui.token` is the legacy shared token: revoke it through pairing instead of moving it. The audit HMAC key of F1-5 can use the same store (`audit-hmac`), with the same same-user caveat.
8. `scripts/make-mac-bundle.js`: nothing to change; both new files arrive through the import graph once the agent imports them. Check the zip lists `shared/secret-store.js` and `shared/child-env.js` and still holds no token.
9. doctor: print `store.kind` and warn when `store.protected` is false.
