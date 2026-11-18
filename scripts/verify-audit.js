// Checks the audit hash chain and the head anchor. Exit code 1 when anything is wrong.
import path from 'node:path';
import { ROOT } from '../server/core/config.js';
import { createAuditLog, auditKeyFor } from '../server/core/audit-log.js';
import { isMain } from '../shared/util.js';

if (isMain(import.meta.url)) {
  const dataDir = process.env.JARVIS_DATA_DIR ?? path.join(ROOT, 'data');
  const result = createAuditLog({ dir: path.join(dataDir, 'audit'), ...auditKeyFor(dataDir) }).verify();
  if (result.ok) console.log(`audit log OK, ${result.entries} entries`);
  else { console.error(`audit log FAILED:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`); process.exit(1); }
}
