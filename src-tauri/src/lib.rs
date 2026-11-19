mod agent;
mod instincts;
mod memory;
mod sessions;
mod telemetry;
mod voice;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Draw the interface on the integrated GPU, not the discrete one, so the LLM keeps the VRAM.
  // WebView2 reads this variable when it creates its environment, which happens after this line.
  // The switch is Chromium's own: the browser engine inside WebView2 picks the low-power adapter.
  let switches = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
  if !switches.contains("--force_low_power_gpu") {
    let joined = if switches.trim().is_empty() { "--force_low_power_gpu".to_string() } else { format!("{switches} --force_low_power_gpu") };
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", joined);
  }
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(telemetry::TelemetryState(std::sync::Arc::new(std::sync::Mutex::new(None))))
    .manage(voice::VoiceState(std::sync::Mutex::new(None)))
    .manage(agent::AgentState(std::sync::Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            // Avoid writing to the OS log directory: a stale directory at the
            // default log-file path prevents the whole app from starting.
            .clear_targets()
            .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      telemetry::start_telemetry,
      memory::memory_save,
      memory::memory_search,
      memory::memory_read,
      memory::memory_set_status,
      memory::memory_doctor,
      instincts::instinct_add,
      instincts::instinct_list,
      instincts::instinct_top,
      instincts::instinct_adjust,
      instincts::instinct_retire,
      instincts::instinct_promote,
      voice::voice_start,
      voice::voice_stop,
      agent::agent_set_root,
      agent::agent_get_root,
      agent::agent_list_dir,
      agent::agent_read_file,
      agent::agent_search,
      agent::agent_write_file,
      agent::agent_edit_file,
      agent::agent_restore,
      agent::agent_run_command,
      agent::agent_audit_append,
      agent::agent_rules_read,
      agent::agent_rules_write,
      sessions::session_save,
      sessions::session_list,
      sessions::session_load,
      sessions::session_delete,
      sessions::session_search,
      sessions::session_export,
      sessions::skills_list,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
