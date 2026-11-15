// Preview the iPhone app in a browser against the test rig (fake model, fake agents, throwaway token), not your real server or chats.
//   node scripts/phone-preview.js     prints the link; Ctrl+C stops it
import path from 'node:path';
import { createServer } from 'vite';
import { makeRig, startApi } from '../tests/rig.js';
import { ROOT } from '../server/core/config.js';

const PORT = 5198;
const rig = await makeRig({ enableAll: true, edit: (f) => { f['machines.json'].server.origins.push(`http://localhost:${PORT}`); } });
const api = await startApi(rig);
const vite = await createServer({
  configFile: path.join(ROOT, 'vite.config.js'),
  server: { port: PORT, strictPort: true, proxy: { '/ws': { target: api.url, ws: true }, '/api': { target: api.url } } },
  logLevel: 'error',
});
await vite.listen();
console.log(`PHONE PREVIEW http://localhost:${PORT}/mobile.html#token=${api.uiToken}`);

const stop = async () => { await vite.close(); await api.close(); await rig.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
