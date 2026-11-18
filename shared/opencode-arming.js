// Files whose change can make later commands run someone else's code (git hooks, package scripts, shell profiles, build files).
// Git loads config (fsmonitor, hooks, diff.external) from whatever repository it finds, and a folder is a repository only with a HEAD
// file, found through a .git file or folder: so .git and HEAD are armed by name at any depth, and allowlisted git only ever runs
// config that git itself or an approved edit made (R1-1).
// OpenCode asks for these in every mode; the permission bridge asks for them in every mode too.
export const ARMING = ['.git', '.git/**', 'HEAD', '.githooks/**', '.gitconfig', '.gitattributes', '.gitmodules', 'package.json', 'package-lock.json', '.npmrc', '.yarnrc*', '.opencode/**', 'opencode.json', 'opencode.jsonc', 'AGENTS.md', '.husky/**', '.github/**', '.vscode/**', '.idea/**', '*.sh', '*.ps1', '*.bat', '*.cmd', 'Makefile', 'Dockerfile', 'docker-compose*.yml', 'setup.py', 'pyproject.toml', 'conftest.py', '.env', '.env.*', '.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile', '*.config.js', '*.config.mjs', '*.config.cjs', '*.config.ts',
  // what Claude Code loads from a folder (settings, hooks, MCP servers, instructions), what the phone and Mac are served, installed packages
  '.claude/**', '.mcp.json', 'CLAUDE.md', 'dist/**', 'node_modules/**',
  // JARVIS's own safety code and keys: the coding agent asks before touching these even inside a trusted folder
  'server/core/policy.js', 'server/core/gate.js', 'server/core/audit-log.js', 'server/core/tool-router.js', 'server/core/auth.js', 'server/core/opencode-bridge.js', 'config/server/policy.json', 'data/tokens/**'];
// OpenCode matches workspace-relative paths, so each pattern is listed both bare and under **/
export const ARMING_PATTERNS = [...new Set(ARMING.flatMap((p) => [p, `**/${p}`]))];
const re = (g) => new RegExp(`^${g.split('**').map((a) => a.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`, 'i');
const RES = ARMING_PATTERNS.map(re);
export const isArming = (p) => { const n = String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, ''); return RES.some((r) => r.test(n)); };
