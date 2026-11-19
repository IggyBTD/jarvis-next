# Setting up the PC

The PC runs the model, the JARVIS server (port 7410) and its own agent (port 7421, localhost only). Do the numbered sections of `HUMAN_TODO.md` in order; this page is the short version.

1. `npm install`, `npm run gen-tokens`, `npm test`.
2. LM Studio 0.4.14 or newer (or `llama-server`): load Qwen3.8-27B at Q4, API identifier `local`, context 65536, bound to localhost:1234. Run `npm run bench -- --write --label "rocm mtp-off"` and look at `docs/benchmarks.md`. Run `node scripts/bench-model.js --check-thinking`.
3. LibreHardwareMonitor with its web server on port 8085 (telemetry: GPU load and temperatures).
4. OpenCode, the exact version in `config/server/policy.json` (`opencode.version`). Then `node scripts/opencode-verify.js --write`.
5. `node scripts/install.js --os win32` to preview, `--apply` to register the startup tasks, then run the printed firewall commands yourself.
6. `node scripts/doctor.js`.
7. Optional: Google sign-in for the digest (`node scripts/google-auth.js`), voice engines on ports 8770 and 8771.
