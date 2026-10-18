// Read-only git for git_status and git_diff, plus two system actions for agent tasks (snapshot and changes). Git can run
// programs named in a repository's own config (fsmonitor, hooks, pager, textconv, filters, aliases ...), so: only a repo root
// with a real .git directory is accepted, the repository-scope config is listed first and the repo is refused if it defines
// anything that can start a program, and every call carries flags that switch those features off. Fails closed.
import fs from 'node:fs';
import path from 'node:path';
import { dirPath, clipText } from './common.js';

const DANGEROUS = /^(core\.(fsmonitor|hookspath|pager|sshcommand|editor|askpass|gitproxy|attributesfile|excludesfile|alternaterefscommand)|filter\.|diff\.(external|.+\.(textconv|command))|merge\..+\.(driver|name)|credential\.|alias\.|include\.|includeif\.|url\..+\.insteadof|pager\.|protocol\.|gpg\.|receive\.|uploadpack\.|submodule\.|difftool\.|mergetool\.|http\.|remote\..+\.(proxy|uploadpack|receivepack|vcs)|extensions\.|worktree)/i;
const SNAP_NAME = /^[\w.-]{1,64}$/;

export const dangerousKeys = (keys) => keys.filter((k) => DANGEROUS.test(k.trim()));

// Validates the repository and returns a runner with every safety flag applied.
async function gitContext(rawPath, ctx) {
  const repo = dirPath(rawPath ?? ctx.workspaceDir, ctx);
  const dotgit = path.join(repo, '.git');
  if (!fs.existsSync(dotgit) || !fs.statSync(dotgit).isDirectory()) throw new Error('not the root of a git repository (a .git folder is required)');
  const nul = ctx.os === 'win32' ? 'NUL' : '/dev/null';
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nul, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_EXTERNAL_DIFF: '', GIT_ASKPASS: '', GIT_SSH_COMMAND: '' };
  const safe = ['-C', repo, '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${nul}`, '-c', 'core.pager=cat', '-c', 'core.untrackedCache=false', '--no-pager'];
  const git = (args, timeoutMs = 20_000) => ctx.runProgram({ file: 'git', args: [...safe, ...args], env, timeoutMs, cwd: repo });

  const cfg = await git(['config', '--local', '--list', '--name-only']);
  if (cfg.code !== 0) throw new Error(`cannot read the repository config: ${cfg.stderr.trim().slice(0, 200)}`);
  const bad = dangerousKeys(cfg.stdout.split('\n').filter(Boolean));
  if (bad.length) throw new Error(`refusing: this repository's config can start programs (${bad.slice(0, 4).join(', ')})`);
  return { repo, git };
}

export async function gitRun(kind, rawPath, ctx) {
  const { repo, git } = await gitContext(rawPath, ctx);
  const r = kind === 'status'
    ? await git(['status', '--porcelain=v1', '-b'])
    : await git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--stat', '--patch']);
  if (r.code !== 0) throw new Error(r.stderr.trim().slice(0, 300) || `git exited with ${r.code}`);
  return { repo, output: clipText(r.stdout, 6000) };
}

// Records the working tree as a commit object under refs/jarvis/snapshots/<name> WITHOUT touching any file, the index or
// the stash list ("git stash create" only writes the object). With nothing to record, the ref points at HEAD.
export async function gitSnapshot(rawPath, name, ctx) {
  if (!SNAP_NAME.test(name)) throw new Error('bad snapshot name');
  const { repo, git } = await gitContext(rawPath, ctx);
  const head = await git(['rev-parse', '--verify', 'HEAD']);
  if (head.code !== 0) return { repo, snapshot: null, note: 'the repository has no commits yet' };
  const made = await git(['stash', 'create']);
  const sha = made.stdout.trim() || head.stdout.trim();
  const ref = await git(['update-ref', `refs/jarvis/snapshots/${name}`, sha]);
  if (ref.code !== 0) throw new Error(ref.stderr.trim().slice(0, 300) || 'could not record the snapshot');
  return { repo, snapshot: `refs/jarvis/snapshots/${name}`, commit: sha };
}

export async function gitChanges(rawPath, name, ctx) {
  if (!SNAP_NAME.test(name)) throw new Error('bad snapshot name');
  const { repo, git } = await gitContext(rawPath, ctx);
  const diff = await git(['diff', '--no-ext-diff', '--no-textconv', '--name-status', `refs/jarvis/snapshots/${name}`]);
  const fresh = await git(['ls-files', '--others', '--exclude-standard']);
  const files = [
    ...diff.stdout.split('\n').filter(Boolean).map((l) => { const [status, ...p] = l.split('\t'); return { status, path: p.join('\t') }; }),
    ...fresh.stdout.split('\n').filter(Boolean).map((p) => ({ status: 'A', path: p })),
  ];
  return { repo, files: files.slice(0, 200), total: files.length };
}
