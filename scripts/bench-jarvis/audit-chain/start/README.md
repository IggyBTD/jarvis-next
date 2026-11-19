# audit

Hash-chained audit log, the same idea as server/core/audit in JARVIS.

- `append(log, entry)` returns a new array with one record added: `{ entry, prev, hash }`. It never changes `log`.
- The stored `entry` is the redacted entry. Redaction runs on every object at any depth, including objects inside arrays. A key whose name contains `token`, `secret`, `password`, `apikey`, `api_key` or `authorization` (any letter case) gets the value `'[redacted]'`, whatever the value was, even an object.
- `hash` is the SHA-256 hex digest of `prev` followed by the canonical form of the stored entry. Canonical form: JSON with object keys sorted at every depth (arrays keep their order), no spaces, and keys whose value is `undefined` left out.
- The first record's `prev` is `GENESIS`, 64 zeros.
- `verify(log)` returns `{ ok: true }` when every record links to the one before it and its hash matches its stored entry. Otherwise it returns `{ ok: false, index }`, where `index` is the first bad record. An empty log is ok.
- `tail(log, n)` returns the last `n` records, and `[]` for `n <= 0`.
