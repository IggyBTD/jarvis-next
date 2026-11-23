// Makes the text-only twin of each LM Studio model that has a vision file, so the app's eye button can load it without vision.
// LM Studio switches vision on by the mmproj file beside the model and has no setting for it, so the twin is the same GGUF
// hard-linked (no extra disk) into a sibling folder without the mmproj: "Qwen3.8-27B-GGUF" gets "Qwen3.8-27B-text-GGUF", which LM
// Studio lists as "qwen3.8-27b-text" (the key in config/server/models.json, profiles.*.vision.textOnly). Safe to run again.
// Run: npm run vision-twin [path to the LM Studio models folder]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.argv[2] ?? path.join(os.homedir(), '.lmstudio', 'models');
let made = 0;
for (const publisher of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const repo of fs.readdirSync(path.join(root, publisher.name), { withFileTypes: true }).filter((d) => d.isDirectory() && /-GGUF$/i.test(d.name) && !/-text-GGUF$/i.test(d.name))) {
    const dir = path.join(root, publisher.name, repo.name);
    const files = fs.readdirSync(dir);
    if (!files.some((f) => /^mmproj.*\.gguf$/i.test(f))) continue; // no vision file: nothing to switch off
    const twin = path.join(root, publisher.name, repo.name.replace(/-GGUF$/i, '-text-GGUF'));
    fs.mkdirSync(twin, { recursive: true });
    for (const f of files.filter((n) => /\.gguf$/i.test(n) && !/^mmproj/i.test(n))) {
      const to = path.join(twin, f);
      if (fs.existsSync(to)) { console.log(`already there: ${to}`); continue; }
      fs.linkSync(path.join(dir, f), to);
      console.log(`linked: ${to}`);
      made += 1;
    }
  }
}
console.log(made ? 'Done. LM Studio lists the twins within a few seconds.' : 'Nothing to do.');
