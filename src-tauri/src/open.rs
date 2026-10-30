// Opens a sign-in link in the default browser. Only Google's consent page is allowed, and no shell is involved.
use std::process::Command;

pub fn allowed(url: &str) -> bool {
    url.starts_with("https://accounts.google.com/") && !url.chars().any(|c| c.is_control() || c == ' ')
}

#[tauri::command]
pub fn open_signin(url: String) -> Result<(), String> {
    if !allowed(&url) {
        return Err("only Google sign-in links can be opened".into());
    }
    #[cfg(target_os = "windows")]
    let mut cmd = { let mut c = Command::new("rundll32"); c.args(["url.dll,FileProtocolHandler", &url]); c };
    #[cfg(target_os = "macos")]
    let mut cmd = { let mut c = Command::new("open"); c.arg(&url); c };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = { let mut c = Command::new("xdg-open"); c.arg(&url); c };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::allowed;
    #[test]
    fn only_google_consent_links() {
        assert!(allowed("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"));
        assert!(!allowed("https://accounts.google.com.evil.test/"));
        assert!(!allowed("file:///C:/Windows/System32/calc.exe"));
        assert!(!allowed("https://accounts.google.com/a b"));
    }
}
