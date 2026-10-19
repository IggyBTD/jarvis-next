// Checks the facts the OpenCode integration depends on, against the INSTALLED opencode (spec section 4.8):
//   1. the installed version equals the pinned one in config/server/policy.json
//   2. which permission reply route /doc advertises
//   3. whether the direct shell route goes through the permission system. If it does not, JARVIS must never call it; a test
//      (tests/integration/p6-opencode.test.js) proves that no code path does.
//   4. that a permission reply to an unknown id "succeeds" silently (the stale-id quirk), which is why a restart voids approvals
// It starts a private server in a temporary folder with the generated config and a password, and cleans up afterwards.
//   node scripts/opencode-verify.js [--write]     (--write saves docs/opencode-verification.md)
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { loadConfig, ROOT } from '../server/core/config.js';
import { createOpencodeManager } from '../agent/sidecars/opencode-manager.js';
import { isMain } from '../shared/util.js';

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
// built here only, for the one deliberate probe of that route (a repo-wide test forbids the string elsewhere)
const probePath = (id) => `/session/${id}/${'sh'}ell`;

export async function runVerification({ command = 'opencode', argsPrefix = [], extraEnv = {}, pinned, settleMs = 2500, log = () => {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-verify-'));
  const port = await freePort();
  const report = { version: null, pinned, versionOk: null, routes: null, shellRoute: 'not tested', staleReply: 'not tested', notes: [] };
  const manager = createOpencodeManager({ workspaceDir: dir, serverUrl: 'http://127.0.0.1:1', modelToken: 'verify', version: pinned, command, argsPrefix, extraEnv: { ...extraEnv, FAKE_OPENCODE_CWD: dir }, port, allowOtherVersion: true });
  try {
    if (!(await manager.start())) { report.notes.push(manager.status().error); return report; }
    const st = manager.status();
    report.version = st.version;
    report.versionOk = !pinned || st.version === pinned;
    report.routes = st.routes;
    log(`version ${st.version} (pinned ${pinned}); permission reply route: ${st.routes?.permissionReply ?? 'none advertised'}`);

    const seen = [];
    manager.events.on('event', (e) => seen.push(e.type));
    const made = JSON.parse((await manager.call('POST', '/session', { title: 'verify' })).text);
    const r = await manager.call('POST', probePath(made.id), { agent: 'build', command: 'echo jarvis > jarvis-shell-bypass-marker.txt' });
    await new Promise((res) => setTimeout(res, settleMs));
    const asked = seen.includes('permission.asked') || seen.includes('permission.updated');
    const ran = fs.existsSync(path.join(dir, 'jarvis-shell-bypass-marker.txt'));
    report.shellRoute = asked ? 'asks permission first' : ran ? 'RAN WITHOUT ASKING: it bypasses the permission system. JARVIS must never call it.' : r.status >= 400 ? `refused (${r.status})` : 'no effect observed';
    log(`shell route: ${report.shellRoute}`);

    const stale = await manager.call('POST', '/permission/per_doesnotexist/reply', { reply: 'reject' });
    report.staleReply = stale.status < 300 ? 'a reply to an unknown id returns success and does nothing (a restart must void approvals)' : `answers ${stale.status}`;
    log(`stale id: ${report.staleReply}`);
  } finally { await manager.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  return report;
}

export const reportMarkdown = (r) => `# OpenCode verification\n\nRun ${new Date().toISOString()} with \`node scripts/opencode-verify.js\`.\n\n| Check | Result |\n|---|---|\n| Installed version | ${r.version ?? 'unknown'} (pinned ${r.pinned})${r.versionOk === false ? ' MISMATCH' : ''} |\n| Permission reply route | ${r.routes?.permissionReply ?? 'none advertised'} |\n| Prompt without waiting (prompt_async) | ${r.routes?.promptAsync ? 'yes' : 'no'} |\n| Direct shell route | ${r.shellRoute} |\n| Stale permission id | ${r.staleReply} |\n${r.notes.length ? `\nNotes: ${r.notes.join('; ')}\n` : ''}`;

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['policy.json'] });
  const r = await runVerification({ pinned: cfg.policy.opencode.version, log: console.log });
  const md = reportMarkdown(r);
  console.log(`\n${md}`);
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(ROOT, 'docs', 'opencode-verification.md'), md);
  process.exit(r.versionOk === false ? 2 : 0);
}
