// Files whose change can make later commands run someone else's code (git hooks, package scripts, shell profiles, build files).
// OpenCode asks for these in every mode; the permission bridge asks for them in every mode too.
export const ARMING = ['.git/**', '.gitconfig', '.gitattributes', '.gitmodules', 'package.json', 'package-lock.json', '.npmrc', '.yarnrc*', '.opencode/**', 'opencode.json', 'opencode.jsonc', 'AGENTS.md', '.husky/**', '.github/**', '.vscode/**', '.idea/**', '*.sh', '*.ps1', '*.bat', '*.cmd', 'Makefile', 'Dockerfile', 'docker-compose*.yml', 'setup.py', 'pyproject.toml', 'conftest.py', '.env', '.env.*', '.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile', '*.config.js', '*.config.mjs', '*.config.cjs', '*.config.ts'];
// OpenCode matches workspace-relative paths, so each pattern is listed both bare and under **/
export const ARMING_PATTERNS = [...new Set(ARMING.flatMap((p) => [p, `**/${p}`]))];
const re = (g) => new RegExp(`^${g.split('**').map((a) => a.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`, 'i');
const RES = ARMING_PATTERNS.map(re);
export const isArming = (p) => { const n = String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, ''); return RES.some((r) => r.test(n)); };
