// Stands in for the `opencode` executable so the manager can be tested with a real child process:
//   fake-opencode-bin.js --version          prints the version
//   fake-opencode-bin.js serve --hostname 127.0.0.1 --port N    serves the fake API (needs OPENCODE_SERVER_PASSWORD to ask for auth)
// FAKE_OPENCODE_LOG: a file that receives one JSON line describing the environment and arguments it was started with.
// FAKE_OPENCODE_CRASH_MS: exit with code 1 this long after starting (to test the restart backoff).
import fs from 'node:fs';
import { createFakeOpencode } from './fake-opencode.js';

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log(process.env.FAKE_OPENCODE_VERSION ?? '1.19.1'); process.exit(0); }
const arg = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
if (process.env.FAKE_OPENCODE_LOG) {
  fs.appendFileSync(process.env.FAKE_OPENCODE_LOG, `${JSON.stringify({ args, cwd: process.cwd(), env: process.env, password: process.env.OPENCODE_SERVER_PASSWORD ?? null, config: process.env.OPENCODE_CONFIG_CONTENT ?? null })}\n`);
}
await createFakeOpencode({ port: Number(arg('--port')), password: process.env.OPENCODE_SERVER_PASSWORD ?? null, variant: process.env.FAKE_OPENCODE_VARIANT ?? 'new' });
if (process.env.FAKE_OPENCODE_CRASH_MS) setTimeout(() => process.exit(1), Number(process.env.FAKE_OPENCODE_CRASH_MS));
