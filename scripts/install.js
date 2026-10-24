// Autostart as data. plan(os) returns the steps (files to write, commands to run, commands only printed); the CLI prints the
// plan, and runs the safe steps with --apply. Firewall commands are ALWAYS only printed. Windows: Task Scheduler at logon (the
// agent must run in the logged-in session to open windows). macOS: LaunchAgents, not daemons.
//   node scripts/install.js --os win32|darwin [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT, expandHome } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import { runProgram } from '../agent/registry/common.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function taskXml({ name, node, script, cwd, args = '' }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>JARVIS ${esc(name)}</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>99</Count></RestartOnFailure></Settings>
  <Actions Context="Author"><Exec><Command>${esc(node)}</Command><Arguments>${esc(`"${script}" ${args}`.trim())}</Arguments><WorkingDirectory>${esc(cwd)}</WorkingDirectory></Exec></Actions>
</Task>`;
}

export function launchAgentPlist({ label, node, script, cwd, logDir, args = [] }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${esc(label)}</string>
  <key>ProgramArguments</key><array><string>${esc(node)}</string><string>${esc(script)}</string>${args.map((a) => `<string>${esc(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${esc(cwd)}</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(path.posix.join(logDir, `${label}.out.log`))}</string>
  <key>StandardErrorPath</key><string>${esc(path.posix.join(logDir, `${label}.err.log`))}</string>
</dict></plist>
`;
}

export function plan(os, { cfg = loadConfig(), root = ROOT, node = process.execPath, home = process.env.HOME ?? process.env.USERPROFILE ?? '' } = {}) {
  const P = os === 'win32' ? path.win32 : path.posix;
  const logDir = P.join(cfg.dataDir, 'logs');
  const m = cfg.machines;
  const steps = [];
  if (os === 'win32') {
    const ws = m.machines.pc.workspaceDir;
    steps.push({ title: 'Create the workspace and log folders', mkdir: [ws, logDir] });
    for (const [name, script, args] of [['server', 'server/index.js', ''], ['agent', 'agent/index.js', '--machine pc']]) {
      const file = P.join(cfg.dataDir, 'install', `jarvis-${name}.xml`);
      steps.push({ title: `Task Scheduler: JARVIS ${name} at logon`, write: { file, content: taskXml({ name, node, script: P.join(root, script), cwd: root, args }) }, run: ['schtasks.exe', ['/Create', '/F', '/TN', `JARVIS ${name}`, '/XML', file]] });
    }
    steps.push({ title: 'Keep the PC reachable when you are away (run yourself; a sleeping PC cannot answer)', print: ['powercfg /change standby-timeout-ac 0', 'powercfg /change hibernate-timeout-ac 0', '# the screen may still turn off; only sleep is disabled while plugged in'] });
    steps.push({ title: 'Firewall (run these yourself in an elevated PowerShell; they are never run for you)', print: [`New-NetFirewallRule -DisplayName "JARVIS server" -Direction Inbound -Protocol TCP -LocalPort ${m.server.port} -RemoteAddress 100.64.0.0/10 -Action Allow`, `# LAN only instead of Tailscale: -RemoteAddress 192.168.0.0/16 (weaker, see docs/network.md)`, `# The PC agent (${m.machines.pc.agentPort}) listens on localhost only and needs no rule.`] });
  } else {
    const ws = expandHome(m.machines.mac.workspaceDir.replace(/^~/, home));
    const agents = P.join(home, 'Library', 'LaunchAgents');
    steps.push({ title: 'Create the workspace and log folders', mkdir: [ws, logDir, agents] });
    const file = P.join(agents, 'com.jarvis.agent.plist');
    steps.push({ title: 'LaunchAgent for the Mac agent (runs in your login session)', write: { file, content: launchAgentPlist({ label: 'com.jarvis.agent', node, script: P.join(root, 'agent/index.js'), cwd: root, logDir, args: ['--machine', 'mac'] }) }, run: ['launchctl', ['load', '-w', file]] });
    steps.push({ title: 'Permissions (macOS asks the first time; only you can grant them)', print: ['System Settings > Privacy & Security: Accessibility, Automation, Microphone (and Screen Recording if you enable screenshot).'] });
  }
  return steps;
}

if (isMain(import.meta.url)) {
  const os = process.argv[process.argv.indexOf('--os') + 1] ?? process.platform;
  const apply = process.argv.includes('--apply');
  for (const s of plan(os)) {
    console.log(`\n# ${s.title}`);
    for (const p of s.print ?? []) console.log(p);
    if (s.mkdir) { console.log(`mkdir ${s.mkdir.join(', ')}`); if (apply) s.mkdir.forEach((d) => fs.mkdirSync(d, { recursive: true })); }
    if (s.write) { console.log(`write ${s.write.file}`); if (apply) { fs.mkdirSync(path.dirname(s.write.file), { recursive: true }); fs.writeFileSync(s.write.file, s.write.content); } }
    if (s.run) { console.log(`${s.run[0]} ${s.run[1].join(' ')}`); if (apply) { const r = await runProgram({ file: s.run[0], args: s.run[1] }); console.log(r.code === 0 ? 'ok' : `failed: ${r.stderr.trim()}`); } }
  }
  if (!apply) console.log('\nThis was a preview. Add --apply to create the folders and register the startup tasks.');
}
