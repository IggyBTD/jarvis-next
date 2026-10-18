// Checks the audit hash chain and the head anchor. Exit code 1 when anything is wrong.
import path from 'node:path';
import { ROOT } from '../server/core/config.js';
import { createAuditLog } from '../server/core/audit-log.js';
import { isMain } from '../shared/util.js';

if (isMain(import.meta.url)) {
  const dir = path.join(process.env.JARVIS_DATA_DIR ?? path.join(ROOT, 'data'), 'audit');
  const result = createAuditLog({ dir }).verify();
  if (result.ok) console.log(`audit log OK, ${result.entries} entries`);
  else { console.error(`audit log FAILED:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`); process.exit(1); }
}
