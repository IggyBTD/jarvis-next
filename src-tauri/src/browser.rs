// Starts and stops the browser sidecar (`sidecars/browser/server.mjs`, Node + Playwright).
//
// Same arrangement as the voice sidecar (voice.rs): a separate process, found by walking up to the
// folder that holds `config/system-prompt.md`, with a stdin pipe this process keeps open so the sidecar
// exits when the app does. The webview talks to it directly over localhost (`src/core/browser-client.js`).
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

pub struct BrowserState(pub Mutex<Option<Child>>);

#[derive(Serialize)]
pub struct BrowserInfo {
    pub port: u16,
    pub started: bool,
}

const PORT: u16 = 8766;

fn project_root() -> Option<PathBuf> {
    let start = std::env::current_dir().ok()?;
    start.ancestors().find(|d| d.join("config").join("system-prompt.md").is_file()).map(|d| d.to_path_buf())
}

fn answering(port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(250)).is_ok()
}

// `async` so the process start runs on a worker thread, not the window's main thread (see voice.rs).
#[tauri::command]
pub async fn browser_start(state: State<'_, BrowserState>) -> Result<BrowserInfo, String> {
    let root = project_root().ok_or("project folder not found (no config/system-prompt.md above the working directory)")?;
    let mut guard = state.0.lock().map_err(|_| "browser state is unavailable".to_string())?;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return Ok(BrowserInfo { port: PORT, started: false }),
            _ => *guard = None,
        }
    }
    if answering(PORT) {
        return Ok(BrowserInfo { port: PORT, started: false });
    }
    let script = root.join("sidecars").join("browser").join("server.mjs");
    if !script.is_file() {
        return Err(format!("browser sidecar not found at {}", script.display()));
    }
    let node = std::env::var("JARVIS_NODE").unwrap_or_else(|_| "node".to_string());
    let mut cmd = Command::new(&node);
    cmd.arg(&script).arg("--parent-stdin").arg("--port").arg(PORT.to_string()).current_dir(&root).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = cmd.spawn().map_err(|e| format!("cannot start `{node}` (is Node.js installed and on PATH? set JARVIS_NODE otherwise): {e}"))?;
    *guard = Some(child);
    Ok(BrowserInfo { port: PORT, started: true })
}

#[tauri::command]
pub async fn browser_stop(state: State<'_, BrowserState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "browser state is unavailable".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
