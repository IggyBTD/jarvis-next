// Starts and stops the voice sidecar (`sidecars/voice/server.mjs`, Node + sherpa-onnx).
//
// The sidecar is a separate process on purpose (see CLAUDE.md, "Keep Tauri thin"): it loads two
// large models and native libraries, and a crash there must not take the HUD down. The webview
// talks to it directly over localhost (`src/core/voice-client.js`); this module only manages the
// process. Its stdin is a pipe that this process keeps open, so when the app exits for any reason
// the pipe closes and the sidecar exits with it (`--parent-stdin`).
use std::fs::File;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

pub struct VoiceState(pub Mutex<Option<Child>>);

#[derive(Serialize)]
pub struct VoiceInfo {
    pub port: u16,
    /// false when a sidecar was already answering on the port (ours from before, or started by hand).
    pub started: bool,
}

const DEFAULT_PORT: u16 = 8765;

/// The folder that holds `config/system-prompt.md`, found by walking up from the working directory
/// (same rule as the memory vault).
fn project_root() -> Option<PathBuf> {
    let start = std::env::current_dir().ok()?;
    let mut dir: Option<&Path> = Some(start.as_path());
    while let Some(d) = dir {
        if d.join("config").join("system-prompt.md").is_file() {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}

/// `port` from `config/voice.json` (the same file the sidecar reads), or the default.
fn configured_port(root: &Path) -> u16 {
    let parsed = std::fs::read_to_string(root.join("config").join("voice.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
    port_from_json(parsed.as_ref())
}

fn port_from_json(v: Option<&serde_json::Value>) -> u16 {
    v.and_then(|v| v.get("port"))
        .and_then(|p| p.as_u64())
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p != 0)
        .unwrap_or(DEFAULT_PORT)
}

fn answering(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

// `async` on purpose: a synchronous Tauri command runs on the app's main thread, and starting a
// process there (virus scanners can take a second or two over a fresh node.exe) froze the whole
// window. An async command runs on a worker thread; there is nothing to await inside.
#[tauri::command]
pub async fn voice_start(state: State<'_, VoiceState>) -> Result<VoiceInfo, String> {
    let root = project_root().ok_or("project folder not found (no config/system-prompt.md above the working directory)")?;
    let port = configured_port(&root);
    let mut guard = state.0.lock().map_err(|_| "voice state is unavailable".to_string())?;

    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return Ok(VoiceInfo { port, started: false }),
            _ => *guard = None, // it exited; start a fresh one below
        }
    }
    if answering(port) {
        return Ok(VoiceInfo { port, started: false });
    }

    let script = root.join("sidecars").join("voice").join("server.mjs");
    if !script.is_file() {
        return Err(format!("voice sidecar not found at {}", script.display()));
    }
    let log_path = root.join("sidecars").join("voice").join("voice.log");
    let log = File::create(&log_path).map_err(|e| format!("cannot write {}: {e}", log_path.display()))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let node = std::env::var("JARVIS_NODE").unwrap_or_else(|_| "node".to_string());
    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg("--parent-stdin")
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("cannot start `{node}` (is Node.js installed and on PATH? set JARVIS_NODE otherwise): {e}"))?;
    *guard = Some(child);
    Ok(VoiceInfo { port, started: true })
}

#[tauri::command]
pub async fn voice_stop(state: State<'_, VoiceState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "voice state is unavailable".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn port_comes_from_config_or_falls_back() {
        assert_eq!(port_from_json(Some(&json!({ "port": 9001 }))), 9001);
        assert_eq!(port_from_json(Some(&json!({}))), DEFAULT_PORT);
        assert_eq!(port_from_json(Some(&json!({ "port": 0 }))), DEFAULT_PORT);
        assert_eq!(port_from_json(Some(&json!({ "port": 70000 }))), DEFAULT_PORT);
        assert_eq!(port_from_json(Some(&json!({ "port": "x" }))), DEFAULT_PORT);
        assert_eq!(port_from_json(None), DEFAULT_PORT);
    }

    #[test]
    fn the_real_config_has_a_port() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        assert_ne!(configured_port(root), 0);
        assert!(root.join("sidecars").join("voice").join("server.mjs").is_file());
    }
}
