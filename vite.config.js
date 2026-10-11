import { defineConfig } from 'vite';
import { writeFileSync } from 'node:fs';

// Dev only: the icon switcher's "Pick this one" button posts here and the choice lands in icons/chosen.json.
const iconChoice = () => ({
  name: 'icon-choice',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__icons/choose', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { set, variant } = JSON.parse(body);
          if (!/^[\w-]+$/.test(String(set)) || !/^[\w-]+$/.test(String(variant))) throw new Error('bad name');
          writeFileSync('icons/chosen.json', `${JSON.stringify({ set, variant }, null, 2)}\n`);
          res.end('ok');
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e.message));
        }
      });
    });
  },
});

export default defineConfig({
  plugins: [iconChoice()],
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      // data/ holds the browser's profile (Chrome keeps its cookie files locked, and watching one crashed the dev server), saved sessions and logs
      ignored: ['**/src-tauri/**', '**/data/**', '**/sidecars/**/node_modules/**', '**/graphify-out/**', '**/docs/ui-shots/**', '**/.playwright-mcp/**'],
    },
  },
});
