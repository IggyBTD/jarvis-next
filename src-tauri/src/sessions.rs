//! Saved conversations (data/sessions) and the skills folder (skills/). Files only: what a
//! session or a skill means is decided in JavaScript (src/core/sessions.js, skills.js). A session
//! file is two lines: the metadata JSON, then the history JSON.
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_BYTES: usize = 40 * 1024 * 1024;
const MAX_SKILL_BYTES: u64 = 40 * 1024;

fn root_dir() -> PathBuf {
    crate::memory::vault_root().parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."))
}

fn sessions_dir() -> PathBuf {
    root_dir().join("data").join("sessions")
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn check_id(id: &str) -> Result<(), String> {
    if valid_id(id) { Ok(()) } else { Err("bad session id".into()) }
}

pub fn save_in(dir: &Path, id: &str, meta: &str, history: &str) -> Result<(), String> {
    check_id(id)?;
    if meta.len() + history.len() > MAX_BYTES {
        return Err("session too large to save".into());
    }
    if meta.contains('\n') || history.contains('\n') {
        return Err("session data must be single-line JSON".into());
    }
    serde_json::from_str::<serde_json::Value>(meta).map_err(|e| format!("meta is not JSON: {e}"))?;
    serde_json::from_str::<serde_json::Value>(history).map_err(|e| format!("history is not JSON: {e}"))?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{id}.jsonl.tmp"));
    fs::write(&tmp, format!("{meta}\n{history}\n")).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(format!("{id}.jsonl"))).map_err(|e| e.to_string())
}

/// Metadata of every saved session, newest first. Only the first line of each file is read.
pub fn list_in(dir: &Path) -> Vec<serde_json::Value> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<serde_json::Value> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| {
            let file = fs::File::open(e.path()).ok()?;
            let mut first = String::new();
            std::io::BufRead::read_line(&mut std::io::BufReader::new(file), &mut first).ok()?;
            serde_json::from_str(first.trim()).ok()
        })
        .collect();
    out.sort_by(|a, b| {
        let t = |v: &serde_json::Value| v.get("updated").and_then(|u| u.as_f64()).unwrap_or(0.0);
        t(b).partial_cmp(&t(a)).unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// The history JSON (second line) of one session.
pub fn load_in(dir: &Path, id: &str) -> Result<String, String> {
    check_id(id)?;
    let text = fs::read_to_string(dir.join(format!("{id}.jsonl"))).map_err(|_| format!("no saved session {id}"))?;
    text.lines().nth(1).map(str::to_string).ok_or_else(|| "session file is damaged".to_string())
}

pub fn delete_in(dir: &Path, id: &str) -> Result<(), String> {
    check_id(id)?;
    fs::remove_file(dir.join(format!("{id}.jsonl"))).map_err(|e| e.to_string())
}

pub fn export_in(dir: &Path, id: &str, text: &str) -> Result<String, String> {
    check_id(id)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.md"));
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SkillFile {
    pub dir: String,
    pub text: String,
}

/// skills/<name>/SKILL.md for every folder that has one (files over 40 KB are skipped).
pub fn skills_in(root: &Path) -> Vec<SkillFile> {
    let Ok(entries) = fs::read_dir(root.join("skills")) else { return Vec::new() };
    let mut out: Vec<SkillFile> = entries
        .flatten()
        .filter_map(|e| {
            let file = e.path().join("SKILL.md");
            let meta = fs::metadata(&file).ok()?;
            if !meta.is_file() || meta.len() > MAX_SKILL_BYTES {
                return None;
            }
            Some(SkillFile { dir: e.file_name().to_string_lossy().into_owned(), text: fs::read_to_string(file).ok()? })
        })
        .collect();
    out.sort_by(|a, b| a.dir.cmp(&b.dir));
    out
}

#[tauri::command]
pub fn session_save(id: String, meta: String, history: String) -> Result<(), String> {
    save_in(&sessions_dir(), &id, &meta, &history)
}

#[tauri::command]
pub fn session_list() -> Vec<serde_json::Value> {
    list_in(&sessions_dir())
}

#[tauri::command]
pub fn session_load(id: String) -> Result<String, String> {
    load_in(&sessions_dir(), &id)
}

#[tauri::command]
pub fn session_delete(id: String) -> Result<(), String> {
    delete_in(&sessions_dir(), &id)
}

#[tauri::command]
pub fn session_export(id: String, text: String) -> Result<String, String> {
    export_in(&sessions_dir(), &id, &text)
}

#[tauri::command]
pub fn skills_list() -> Vec<SkillFile> {
    skills_in(&root_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("jarvis-{name}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ids_are_plain_names_only() {
        assert!(valid_id("s1abc-2_x"));
        assert!(!valid_id(""));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(&"a".repeat(65)));
    }

    #[test]
    fn save_list_load_delete_round_trip_newest_first() {
        let dir = temp("sess");
        save_in(&dir, "a1", r#"{"id":"a1","name":"old","updated":1}"#, r#"[{"role":"user","content":"hi"}]"#).unwrap();
        save_in(&dir, "b2", r#"{"id":"b2","name":"new","updated":2}"#, "[]").unwrap();
        let list = list_in(&dir);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["id"], "b2");
        assert_eq!(load_in(&dir, "a1").unwrap(), r#"[{"role":"user","content":"hi"}]"#);
        delete_in(&dir, "a1").unwrap();
        assert!(load_in(&dir, "a1").is_err());
        assert!(!dir.join("a1.jsonl.tmp").exists());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn bad_input_is_refused() {
        let dir = temp("bad");
        assert!(save_in(&dir, "../x", "{}", "[]").is_err());
        assert!(save_in(&dir, "ok", "not json", "[]").is_err());
        assert!(save_in(&dir, "ok", "{}", "[1,\n2]").is_err());
        assert!(load_in(&dir, "a/b").is_err());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn export_writes_markdown_next_to_the_session() {
        let dir = temp("exp");
        let path = export_in(&dir, "s1", "# hi").unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "# hi");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn skills_are_found_by_folder_and_big_ones_skipped() {
        let root = temp("skills");
        fs::create_dir_all(root.join("skills/b")).unwrap();
        fs::create_dir_all(root.join("skills/a")).unwrap();
        fs::create_dir_all(root.join("skills/empty")).unwrap();
        fs::create_dir_all(root.join("skills/big")).unwrap();
        fs::write(root.join("skills/a/SKILL.md"), "A").unwrap();
        fs::write(root.join("skills/b/SKILL.md"), "B").unwrap();
        fs::write(root.join("skills/big/SKILL.md"), "x".repeat(41 * 1024)).unwrap();
        let found = skills_in(&root);
        assert_eq!(found, vec![SkillFile { dir: "a".into(), text: "A".into() }, SkillFile { dir: "b".into(), text: "B".into() }]);
        fs::remove_dir_all(root).ok();
    }
}
