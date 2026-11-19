//! Named OS steps for routines (config/routines.json). The model never reaches these with free text:
//! it names a routine, JavaScript looks its steps up in the user's own config, and every step is one
//! of the fixed kinds below, checked again here. No shell: each step runs one program with fixed
//! arguments. Windows only for now; elsewhere every step is refused.
use serde::Deserialize;

#[derive(Deserialize, Debug, PartialEq)]
#[serde(tag = "do", rename_all = "snake_case", deny_unknown_fields)]
pub enum Step {
    LockScreen,
    /// An app, file or URI (steam://open/main), opened the way a double-click would.
    Open { target: String },
    /// Asks a program to close (no force, so it can offer to save first).
    Close { process: String },
    PowerPlan { plan: String },
}

// Processes Windows needs; closing one would log the user out or crash the system.
const PROTECTED: &[&str] = &["csrss.exe", "winlogon.exe", "lsass.exe", "services.exe", "smss.exe", "svchost.exe", "wininit.exe", "dwm.exe", "explorer.exe"];

pub fn check(step: &Step) -> Result<(), String> {
    match step {
        Step::LockScreen => Ok(()),
        Step::Open { target } => {
            let t = target.trim();
            if t.is_empty() || t.starts_with('-') || t.starts_with('/') || t.chars().any(char::is_control) {
                return Err(format!("not something to open: {target:?}"));
            }
            Ok(())
        }
        Step::Close { process } => {
            let ok = regex::Regex::new(r"^[A-Za-z0-9 ._-]{1,64}\.exe$").unwrap().is_match(process);
            if !ok {
                return Err(format!("not a program name like app.exe: {process:?}"));
            }
            if PROTECTED.contains(&process.to_lowercase().as_str()) {
                return Err(format!("{process} is part of Windows and is never closed"));
            }
            Ok(())
        }
        Step::PowerPlan { plan } => match plan.as_str() {
            "high" | "balanced" | "saver" => Ok(()),
            _ => Err(format!("power plan must be high, balanced or saver, not {plan:?}")),
        },
    }
}

#[cfg(windows)]
fn run(step: &Step) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let quiet = |mut c: Command| {
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    };
    match step {
        Step::LockScreen => {
            let mut c = Command::new("rundll32.exe");
            c.args(["user32.dll,LockWorkStation"]);
            quiet(c).spawn().map_err(|e| e.to_string())?;
            Ok("Screen locked.".into())
        }
        Step::Open { target } => {
            // explorer.exe reports exit code 1 even when it worked, so only a failed start counts.
            let mut c = Command::new("explorer.exe");
            c.arg(target.trim());
            quiet(c).spawn().map_err(|e| e.to_string())?;
            Ok(format!("Opened {}.", target.trim()))
        }
        Step::Close { process } => {
            let mut c = Command::new("taskkill.exe");
            c.args(["/IM", process]);
            let out = quiet(c).output().map_err(|e| e.to_string())?;
            match out.status.code() {
                Some(0) => Ok(format!("Asked {process} to close.")),
                Some(128) => Ok(format!("{process} was not running.")),
                _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
            }
        }
        Step::PowerPlan { plan } => {
            let scheme = match plan.as_str() { "high" => "SCHEME_MIN", "saver" => "SCHEME_MAX", _ => "SCHEME_BALANCED" };
            let mut c = Command::new("powercfg.exe");
            c.args(["/setactive", scheme]);
            let out = quiet(c).output().map_err(|e| e.to_string())?;
            if out.status.success() { Ok(format!("Power plan: {plan}.")) } else { Err(String::from_utf8_lossy(&out.stdout).trim().to_string()) }
        }
    }
}

#[cfg(not(windows))]
fn run(_step: &Step) -> Result<String, String> {
    Err("routines only run on Windows for now".into())
}

#[tauri::command]
pub fn os_run_step(step: Step) -> Result<String, String> {
    check(&step)?;
    run(&step)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<Step, serde_json::Error> {
        serde_json::from_str(json)
    }

    #[test]
    fn steps_parse_from_the_config_shape() {
        assert_eq!(parse(r#"{"do":"lock_screen"}"#).unwrap(), Step::LockScreen);
        assert_eq!(parse(r#"{"do":"power_plan","plan":"high"}"#).unwrap(), Step::PowerPlan { plan: "high".into() });
        assert!(parse(r#"{"do":"run_shell","command":"x"}"#).is_err());
        assert!(parse(r#"{"do":"open","target":"x","extra":1}"#).is_err());
    }

    #[test]
    fn checks_refuse_odd_values() {
        assert!(check(&Step::Open { target: "steam://open/main".into() }).is_ok());
        assert!(check(&Step::Open { target: "-flag".into() }).is_err());
        assert!(check(&Step::Open { target: "a\nb".into() }).is_err());
        assert!(check(&Step::Close { process: "Discord.exe".into() }).is_ok());
        assert!(check(&Step::Close { process: "discord".into() }).is_err());
        assert!(check(&Step::Close { process: "a.exe & calc.exe".into() }).is_err());
        assert!(check(&Step::Close { process: "LSASS.exe".into() }).is_err());
        assert!(check(&Step::PowerPlan { plan: "turbo".into() }).is_err());
    }
}
