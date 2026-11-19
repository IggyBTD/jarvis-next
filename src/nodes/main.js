// JARVIS, nodes design: the entry point. The page structure and every behaviour module are the ones the classic design
// uses (src/main.js): chat, tools, telemetry, voice, the panel, projects, accounts, the JARVIS server link. What differs:
// no web fonts (Segoe UI Variable and Cascadia Code come from the system, src/nodes/tokens.css), the node mesh is drawn as a
// ball-and-stick model (<html data-mesh="kit">, node-mesh.js), the Intel page is left out, and ui.js adds the nodes extras.
import { initTelemetry } from '../core/telemetry-view.js';
import { mountLogos } from '../core/node-mesh.js';

initTelemetry();
mountLogos();
import '../core/chat-ui.js';
import '../core/model-panel.js';
import '../core/dock-ui.js';
import '../core/window-controls.js';
import '../core/cli-page.js';
import '../core/native-chrome.js';
import '../core/shortcuts.js';
import '../core/sysview.js';
import '../core/shell.js';
import '../core/usage.js';
import '../core/code-home.js';
import '../core/server-link.js';
import '../core/server-ui.js';
import '../core/server-voice.js';
import './ui.js';

// Dev only: Ctrl+Shift+I opens the icon switcher, Ctrl+Shift+G draws the 4 px grid. Vite drops these from production builds.
if (import.meta.env.DEV) import('../dev/icon-switcher.js');
if (import.meta.env.DEV) import('../dev/grid-overlay.js');
