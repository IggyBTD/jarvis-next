// JARVIS, nodes interface: the entry point. Every behaviour module is the one the classic interface
// uses (chat, tools, telemetry, voice, workspace, code page, shell); only the markup (index.html),
// the stylesheet (nodes.css) and the core and its moments (core.js, ui.js) are new. The classic
// interface is classic.html with src/main.js and src/ui/app.css, unchanged.
import { initTelemetry } from '../core/telemetry-view.js';

initTelemetry();
import '../core/chat-ui.js';
import '../core/model-panel.js';
import '../core/dock-ui.js';
import '../core/window-controls.js';
import '../core/cli-page.js';
import '../core/native-chrome.js';
import '../core/shortcuts.js';
import '../core/sysview.js';
import '../core/shell.js';
import './ui.js';
