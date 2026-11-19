// What a coding-agent request touches, decided by parsing it rather than by matching its text: a tokenizer that knows quotes and
// shell operators, lexical path resolution per operating system, and the read-only allowlist with the flags each command may take.
// Anything that cannot be resolved (variables, substitutions, home or drive-relative paths, 8.3 short names, alternate streams,
// provider, device and network paths, unbalanced quotes) is outside. The agent resolves real paths (junctions, links) on top of this.
import path from 'node:path';

const OPS = ['&&', '||', '>>', ';', '|', '&', '>', '<', '(', ')', '{', '}', '\n', '\r'];
const DYNAMIC = /[`$@]|%[A-Za-z_][\w()]*%/; // PowerShell and shell variables, substitutions and splats, cmd %VAR%

// Words and operators; quotes are removed from words. null when a quote is not closed.
export function tokenize(s) {
  const out = [];
  let cur = null;
  const push = () => { if (cur !== null) { out.push({ word: cur }); cur = null; } };
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === "'" || ch === '"') { const j = s.indexOf(ch, i + 1); if (j === -1) return null; cur = (cur ?? '') + s.slice(i + 1, j); i = j + 1; continue; }
    if (ch === ' ' || ch === '\t') { push(); i++; continue; }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) { push(); out.push({ op }); i += op.length; continue; }
    cur = (cur ?? '') + ch;
    i++;
  }
  push();
  return out;
}

const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)(\..*)?$/i;

// An absolute path, or null when the text cannot be resolved to one without guessing. os is 'win32' or anything else (POSIX).
export function resolveLexical(raw, { os, cwd }) {
  const s = String(raw ?? '');
  if (!s || s.includes('\0') || DYNAMIC.test(s) || s.startsWith('~')) return null;
  if (os !== 'win32') {
    if (!cwd || !cwd.startsWith('/')) return null;
    return path.posix.resolve(cwd, s);
  }
  const p = s.replace(/\//g, '\\');
  if (p.startsWith('\\\\')) return null;                          // UNC, \\?\ and \\.\ device paths
  if (/^[^\\:]{2,}:/.test(p)) return null;                        // providers (HKCU:, env:, Registry::) and anything else before a colon
  if (/^[a-z]:(?!\\)/i.test(p)) return null;                      // drive-relative (C:foo)
  if (p.slice(2).includes(':')) return null;                      // alternate data streams
  if (!cwd || !/^[a-z]:\\/i.test(cwd)) return null;
  const segs = p.split('\\');
  for (const seg of segs) {
    if (seg === '.' || seg === '..' || seg === '' || /^[a-z]:$/i.test(seg)) continue;
    if (/~\d/.test(seg) || DEVICE.test(seg.replace(/[. ]+$/, '')) || /^[. ]+$/.test(seg)) return null; // short names, devices, all-dot names
  }
  // Windows drops trailing dots and spaces from every name: "package.json." is package.json
  return path.win32.resolve(cwd, segs.map((seg) => (seg === '.' || seg === '..' ? seg : seg.replace(/[. ]+$/, ''))).join('\\'));
}

// Folders of the system and of the user's own setup that the coding agent never touches by itself, in any mode: the OS and its
// programs, the profile's AppData or Library (startup items, browser profiles, credentials), keys, and the files and folders a shell
// loads when it starts. They are added to the protected roots, so everything that guards JARVIS's own folder guards these too.
// home is that machine's home folder; without it only the folders outside the home are listed.
export function systemFolders(os, home = null) {
  if (os === 'win32') {
    const h = home ? home.replace(/[\\/]+$/, '').replace(/\//g, '\\') : null;
    return ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData', 'C:\\$Recycle.Bin', 'C:\\System Volume Information', 'C:\\Recovery', 'C:\\Boot',
      ...(h ? ['AppData', '.ssh', '.aws', '.azure', '.gnupg', '.docker', '.kube', '.config\\gh', '.gitconfig', '.bashrc', '.bash_profile', '.profile', 'NTUSER.DAT', 'Documents\\WindowsPowerShell', 'Documents\\PowerShell', 'OneDrive\\Documents\\WindowsPowerShell', 'OneDrive\\Documents\\PowerShell'].map((x) => `${h}\\${x}`) : [])];
  }
  const h = home ? home.replace(/\/+$/, '') : null;
  return ['/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/private', '/var', '/Applications', '/Volumes',
    ...(h ? ['Library', '.ssh', '.aws', '.azure', '.gnupg', '.docker', '.kube', '.config/gh', '.gitconfig', '.zshrc', '.zprofile', '.zshenv', '.bashrc', '.bash_profile', '.profile'].map((x) => `${h}/${x}`) : [])];
}
// Environment variables that name the system's or the home's folders: a command that uses one could reach any of the folders above.
export const SYSTEM_VARS = /(\$env:|%|\$\{?)(windir|systemroot|systemdrive|programfiles(\(x86\))?|programw6432|programdata|allusersprofile|appdata|localappdata|userprofile|homedrive|homepath|home|temp|tmp|public|commonprogramfiles|onedrive)\b/i;

// p inside root (or root itself). Case is ignored on Windows, and wherever loose is set (for protected roots: matching more is safer).
export function within(p, root, os, { loose = false } = {}) {
  if (!p || !root) return false;
  const sep = os === 'win32' ? '\\' : '/';
  const fold = (x) => (os === 'win32' || loose ? x.toLowerCase() : x);
  const a = fold(p);
  const r = fold(root.length > 1 && root.endsWith(sep) && !/^[a-z]:\\$/i.test(root) ? root.slice(0, -1) : root);
  return a === r || a.startsWith(r.endsWith(sep) ? r : r + sep);
}

// ---- the read-only allowlist ------------------------------------------------------------------------------------------------------
// Each entry: flags (lowercase, exact; for --name=value the part before =), short (POSIX flags of one or two letters or digits),
// args: 'paths' (every other word is a path inside the workspace), 'refs' (git revisions and pathspecs: relative, no ..),
// 'words' (plain names only), 'any' (cannot touch files or the network whatever it is given), 'none'.
const set = (s) => new Set(s.split(' '));
const POSIX = { short: true, args: 'paths', flags: new Set() };
const GIT_DIFF = '--stat --numstat --shortstat --name-only --name-status --cached --staged --summary -p --patch -u --unified --no-color --color -w --ignore-all-space -b --ignore-space-change --word-diff --check -m --find-renames -r --no-renames --minimal --diff-filter --relative --raw --compact-summary --dirstat -z --exit-code --quiet --no-ext-diff --no-textconv --oneline --format --pretty --abbrev-commit --no-patch -s --abbrev';
const GIT_LOG = `${GIT_DIFF} -n --max-count --skip --since --after --until --before --author --committer --grep --all --branches --graph --decorate --no-decorate --no-merges --merges --first-parent --reverse --date --follow --left-right --cherry-pick --topo-order --date-order -i --regexp-ignore-case`;
const PS_PATHS = (extra) => ({ ps: true, args: 'paths', flags: set(`-path -literalpath ${extra}`) });
const PS_WORDS = (extra) => ({ ps: true, args: 'words', flags: set(extra) });
const SPEC = {
  git: { subs: {
    status: { args: 'refs', flags: set('-s --short -b --branch --porcelain --long -u --untracked-files --ignored -z --show-stash --ahead-behind --no-ahead-behind -v --verbose --no-renames') },
    diff: { args: 'refs', flags: set(GIT_DIFF), gitShort: true },
    log: { args: 'refs', flags: set(GIT_LOG), gitShort: true },
    show: { args: 'refs', flags: set(GIT_DIFF), gitShort: true },
    branch: { args: 'none', flags: set('-a --all -r --remotes -v -vv --verbose --list --show-current --no-color --sort --format') },
    'rev-parse': { args: 'refs', flags: set('--abbrev-ref --short --show-toplevel --show-prefix --git-dir --is-inside-work-tree --verify --symbolic-full-name -q --quiet') },
  } },
  ls: POSIX, dir: POSIX, cat: POSIX, head: POSIX, tail: POSIX, wc: POSIX,
  pwd: { args: 'none', flags: new Set() },
  'get-childitem': PS_PATHS('-filter -include -exclude -recurse -depth -force -name -file -directory -hidden -readonly -system -attributes'),
  'get-content': PS_PATHS('-totalcount -head -first -tail -last -raw -encoding -readcount -delimiter'),
  'get-item': PS_PATHS('-force -filter -include -exclude'),
  'get-itemproperty': PS_PATHS('-name -filter -include -exclude'),
  'test-path': PS_PATHS('-pathtype -isvalid -filter -include -exclude -newerthan -olderthan'),
  'resolve-path': PS_PATHS('-relative'),
  'select-string': PS_PATHS('-pattern -simplematch -casesensitive -context -allmatches -notmatch -list -quiet -raw -encoding -include -exclude'),
  'get-location': { args: 'none', flags: new Set() },
  'get-date': { args: 'any', flags: new Set(), anyFlags: true },
  'get-command': PS_WORDS('-name -module -commandtype -all -syntax'),
  'get-process': PS_WORDS('-name -id -module -fileversioninfo'),
  'get-service': PS_WORDS('-name -displayname -dependentservices -requiredservices'),
  'get-volume': PS_WORDS('-driveletter -filesystemlabel'),
  'get-psdrive': PS_WORDS('-name -psprovider -scope'),
  'get-computerinfo': PS_WORDS('-property'),
  'get-netipaddress': PS_WORDS('-addressfamily -interfacealias -interfaceindex'),
  'node --version': { exact: true }, 'npm --version': { exact: true }, $psversiontable: { exact: true },
};
const ALIAS = { gci: 'get-childitem', gc: 'get-content', gi: 'get-item', gp: 'get-itemproperty', sls: 'select-string', rvpa: 'resolve-path', gl: 'get-location', gcm: 'get-command', gps: 'get-process', gsv: 'get-service', gdr: 'get-psdrive' };

// Commands that are harmless whatever their arguments: the only ones a prefix rule (the Claude Code backend's Bash(x:*)) may allow.
export const CLAUDE_SAFE = ['git status*', 'git rev-parse*', 'git branch', 'pwd', 'Get-Location', 'Get-Date*', 'node --version', 'npm --version'];

const isFlag = (w) => /^-/.test(w);
const refOk = (w) => !/^([a-z]:|[\\/]|~)/i.test(w) && !w.split(/[\\/]/).includes('..');

// { ok, reason }: a single read-only command whose flags are on its list and whose paths resolve inside the workspace.
// enabled: the commands policy.json lists (allowCommands, written as "git status" or the older glob "git status*").
export function readOnly(command, { os, workspace, enabled }) {
  const no = (reason) => ({ ok: false, reason });
  const c = String(command ?? '').trim();
  const on = new Set([...(enabled ?? [])].map((g) => String(g).replace(/\*+$/, '').trim().toLowerCase()));
  const exact = c.toLowerCase().replace(/\s+/g, ' ');
  if (/^\$psversiontable(\.\w+)?$/.test(exact)) return on.has('$psversiontable') ? { ok: true, reason: 'read-only allowlist' } : no('not on the allowlist');
  if (/[;&|<>(){}\n\r]/.test(c)) return no('chained, redirected or substituted command');
  if (DYNAMIC.test(c)) return no('uses a variable or substitution');
  if (SPEC[exact]?.exact) return on.has(exact) ? { ok: true, reason: 'read-only allowlist' } : no('not on the allowlist');
  const t = tokenize(c);
  if (!t?.length) return no('cannot be parsed');
  const words = t.map((x) => x.word);
  const first = words[0].toLowerCase();
  if (/[\\/]/.test(first)) return no('runs a program by its path');
  const name = ALIAS[first.replace(/\.exe$/, '')] ?? first.replace(/\.exe$/, '');
  let spec = SPEC[name];
  let key = name;
  let rest = words.slice(1);
  if (spec?.subs) { const sub = (rest[0] ?? '').toLowerCase(); spec = Object.hasOwn(spec.subs, sub) ? spec.subs[sub] : null; key = `${name} ${sub}`; rest = rest.slice(1); }
  if (!spec || spec.exact || !on.has(key)) return no('not on the allowlist');
  let afterDashes = false;
  for (const w of rest) {
    if (!afterDashes && w === '--' && spec.args === 'refs') { afterDashes = true; continue; }
    if (!afterDashes && isFlag(w)) {
      if (spec.anyFlags) continue;
      if (spec.ps) {
        const [flag, value] = w.split(/:(.*)/s);
        if (!spec.flags.has(flag.toLowerCase())) return no(`flag ${flag} is not on the list for ${key}`);
        if (value !== undefined && spec.args === 'paths' && !inside(value)) return no(`${value} is outside the workspace`);
        continue;
      }
      const flag = w.split('=')[0].toLowerCase();
      if (spec.flags.has(flag)) continue;
      if (spec.short && /^-[a-z0-9]{1,2}$/.test(w)) continue;
      if (spec.gitShort && (/^-\d+$/.test(w) || /^-[un]\d+$/i.test(w) || /^-[SG].+/.test(w))) continue;
      return no(`flag ${w.split('=')[0]} is not on the list for ${key}`);
    }
    if (spec.args === 'none') return no(`${key} takes no arguments here`);
    if (spec.args === 'any') continue;
    if (spec.args === 'words' && !/^[\w.*-]+$/.test(w)) return no(`${w} is not a plain name`);
    if (spec.args === 'refs' && !refOk(w)) return no(`${w} points outside the repository`);
    if (spec.args === 'paths' && !inside(w)) return no(`${w} is outside the workspace`);
  }
  return { ok: true, reason: 'read-only allowlist' };

  // PowerShell reads a,b as two paths, so each part is resolved on its own
  function inside(w) { return w.split(',').every((part) => { const r = resolveLexical(part, { os, cwd: workspace }); return !!r && within(r, workspace, os); }); }
}

const CD = /^(cd|chdir|set-location|sl|pushd|push-location)$/i;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

// What a command that is not read-only touches: { dynamic } when it uses variables, substitutions or a quote that does not close
// (nothing about it can be known), otherwise the paths its words name, resolved from the working folder each part runs in (cd is
// followed); a word that cannot be resolved is null. Words that are not paths resolve inside the folder and do no harm here.
export function pathsOf(command, { os, workspace }) {
  const c = String(command ?? '');
  if (DYNAMIC.test(c)) return { dynamic: true, paths: [] };
  const t = tokenize(c);
  if (!t) return { dynamic: true, paths: [] };
  const paths = [];
  let cwd = workspace;
  let seg = [];
  const resolve = (w) => (cwd ? resolveLexical(w, { os, cwd }) : null);
  const flush = () => {
    if (!seg.length) return;
    const [cmd, ...args] = seg;
    seg = [];
    if (CD.test(cmd)) { const to = args.find((a) => !isFlag(a)); cwd = to ? resolve(to) : null; paths.push(cwd); return; }
    for (const w of [cmd, ...args]) {
      if (URL_RE.test(w)) continue;
      if (isFlag(w)) { const v = w.match(/^-{1,2}[^=:]+[=:](.+)$/)?.[1]; if (v && !URL_RE.test(v)) for (const part of v.split(',')) paths.push(resolve(part)); continue; }
      const v = w.match(/^[A-Za-z_][\w.-]*=(.+)$/)?.[1]; // NAME=value arguments (make OUT=..\x)
      for (const part of (v ?? w).split(',')) paths.push(resolve(part)); // PowerShell reads a,b as two paths
    }
  };
  for (const x of t) { if (x.op) flush(); else seg.push(x.word); }
  flush();
  return { dynamic: false, paths };
}
