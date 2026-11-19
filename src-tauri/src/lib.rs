mod agent;
mod instincts;
mod memory;
mod os_actions;
mod sessions;
mod telemetry;
mod voice;
mod web;
mod browser;
mod wol;
mod open;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Keep the big GPU free for the LLM: the interface is drawn by the integrated GPU, not the discrete one
  // (`--force_low_power_gpu`). The integrated GPU is idle anyway; the cost is a few tens of MB that Windows still
  // puts on the discrete GPU, because the window is shown through it. JARVIS_GPU picks another way:
  // `hybrid` draws the interface on the CPU and only WebGL (the OSINT globe) on the integrated GPU, with nothing at
  // all on the discrete one; `off` draws everything on the CPU; `any` leaves WebView2 alone.
  // WebView2 reads this variable when it creates its environment, which happens after this line.
  let flags: &[&str] = match std::env::var("JARVIS_GPU").as_deref() {
    Ok("any") => &[],
    Ok("off") => &["--disable-gpu"],
    Ok("hybrid") => &["--disable-gpu-compositing", "--disable-gpu-rasterization", "--force_low_power_gpu"],
    _ => &["--force_low_power_gpu"],
  };
  let mut switches = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
  for flag in flags {
    if !switches.contains(flag) {
      if !switches.trim().is_empty() { switches.push(' '); }
      switches.push_str(flag);
    }
  }
  if !switches.trim().is_empty() {
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", switches);
  }
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(telemetry::TelemetryState(std::sync::Arc::new(std::sync::Mutex::new(None))))
    .manage(voice::VoiceState(std::sync::Mutex::new(None)))
    .manage(browser::BrowserState(std::sync::Mutex::new(None)))
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
      browser::browser_start,
      browser::browser_stop,
      wol::wake_on_lan,
      open::open_signin,
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
      os_actions::os_run_step,
      web::web_set_allowed,
      web::web_search,
      web::web_fetch,
      sessions::session_export,
      sessions::skills_list,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
