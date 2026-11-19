// Client for the Rust agent tools (src-tauri/src/agent.rs): files and shell inside one project
// folder. Same pattern as memory-client.js. Needs the desktop app; a plain browser has no backend.
const KEY = 'jarvis.project';
let current = null; // the project folder, or null: the file tools are only offered to the model with one
export const currentProject = () => current;

async function call(command, args) {
  if (!window.__TAURI_INTERNALS__) throw new Error('The coding tools need the JARVIS desktop app (no Tauri backend here).');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}

export async function setProject(path) {
  const shown = await call('agent_set_root', { path });
  current = shown;
  try { localStorage.setItem(KEY, shown); } catch { /* storage blocked */ }
  document.dispatchEvent(new CustomEvent('jarvis:project')); // project-instructions.js re-reads its notes file
  return shown;
}

export const getProject = () => call('agent_get_root');

// Called once at start: the folder chosen last time becomes the project again.
export async function restoreProject() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (!saved || !window.__TAURI_INTERNALS__) return null;
  try {
    const shown = await call('agent_set_root', { path: saved });
    current = shown;
    document.dispatchEvent(new CustomEvent('jarvis:project'));
    return shown;
  } catch { return null; } // the folder may be gone
}

// Native folder picker (desktop app only). Resolves the chosen path, or null if cancelled.
export async function pickFolder() {
  if (!window.__TAURI_INTERNALS__) throw new Error('The folder picker needs the JARVIS desktop app. Type the path instead: /project <path>.');
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ directory: true, multiple: false, title: 'Choose the project folder' });
  return typeof chosen === 'string' ? chosen : null;
}

export const listDir = (path, depth) => call('agent_list_dir', { path, depth });
export const readFile = (path, offset, limit) => call('agent_read_file', { path, offset, limit });
export const searchFiles = (pattern, path, glob) => call('agent_search', { pattern, path, glob });
export const writeFile = (path, content) => call('agent_write_file', { path, content });
export const editFile = (path, oldText, newText, replaceAll) => call('agent_edit_file', { path, oldText, newText, replaceAll });
export const restoreFile = (path, expected, previous) => call('agent_restore', { path, expected, previous });
export const runCommand = (command, timeoutSecs) => call('agent_run_command', { command, timeoutSecs });

// Audit lines and the user's own permission rules live in files next to the memory vault.
export const appendAuditLine = (line) => call('agent_audit_append', { line });
export const readLocalRules = () => call('agent_rules_read');
export const writeLocalRules = (text) => call('agent_rules_write', { text });
