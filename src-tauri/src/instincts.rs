//! Instincts: tiny learned habits (one trigger, one action, a confidence, a scope).
//!
//! Unlike memories, an instinct is a preference the user approved, so it may shape replies.
//! Rules (see `.md Files/JARVIS_ECC_Design_Notes.md`):
//! - created only by an explicit user step, never by a background observer
//! - confidence moves only through user-initiated commands (the model has none)
//! - only instincts at or above the injection threshold are ever shown to the model
//! - scope `project` stays put; moving to `global` is a deliberate user action
//!
//! Layout: `<root>/instincts/<scope>/<id>.md`, scope = project | global.

use crate::memory::{
    atomic_replace, get_str, get_strs, no_controls, now_stamp, random_suffix, read_regular, scan_secrets, split_frontmatter, valid_id, valid_slug, vault_root,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const SCHEMA: &str = "jarvis.instinct.v1";
const SCOPES: [&str; 2] = ["project", "global"];
const MAX_TRIGGER: usize = 160;
const MAX_ACTION: usize = 240;
const MAX_EVIDENCE: usize = 5;
const MAX_FILES: usize = 1000;
const START_CONFIDENCE: f64 = 0.7;
const MIN_CONFIDENCE: f64 = 0.1;
const MAX_CONFIDENCE: f64 = 0.95;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Instinct {
    pub id: String,
    pub trigger: String,
    pub action: String,
    pub domain: String,
    pub scope: String,
    pub confidence: f64,
    pub status: String, // active | retired
    pub evidence: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, Default)]
pub struct AddRequest {
    pub trigger: String,
    pub action: String,
    pub domain: Option<String>,
    pub scope: Option<String>,
    pub confidence: Option<f64>,
    pub evidence: Option<Vec<String>>,
}

fn j<T: Serialize + ?Sized>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

fn render(i: &Instinct) -> String {
    format!(
        "---\nschema: {}\nid: {}\ntrigger: {}\naction: {}\ndomain: {}\nscope: {}\nconfidence: {}\nstatus: {}\nevidence: {}\ncreated_at: {}\nupdated_at: {}\n---\n",
        j(SCHEMA), j(&i.id), j(&i.trigger), j(&i.action), j(&i.domain), j(&i.scope), j(&i.confidence), j(&i.status), j(&i.evidence), j(&i.created_at), j(&i.updated_at)
    )
}

fn parse(text: &str, scope_dir: &str) -> Result<Instinct, String> {
    let (map, _) = split_frontmatter(text)?;
    if get_str(&map, "schema")? != SCHEMA {
        return Err("unknown schema".into());
    }
    let confidence = map.get("confidence").and_then(|v| v.as_f64()).ok_or("missing confidence")?;
    let i = Instinct {
        id: get_str(&map, "id")?,
        trigger: get_str(&map, "trigger")?,
        action: get_str(&map, "action")?,
        domain: get_str(&map, "domain")?,
        scope: get_str(&map, "scope")?,
        confidence,
        status: get_str(&map, "status")?,
        evidence: get_strs(&map, "evidence")?,
        created_at: get_str(&map, "created_at")?,
        updated_at: get_str(&map, "updated_at")?,
    };
    if !valid_id(&i.id, "ins") || !SCOPES.contains(&i.scope.as_str()) || i.scope != scope_dir || !["active", "retired"].contains(&i.status.as_str()) || !(0.0..=1.0).contains(&i.confidence) {
        return Err("invalid field value".into());
    }
    Ok(i)
}

fn dir_for(root: &Path, scope: &str) -> PathBuf {
    root.join("instincts").join(scope)
}

fn locate(root: &Path, id: &str) -> Result<(PathBuf, &'static str), String> {
    if !valid_id(id, "ins") {
        return Err("invalid instinct id".into());
    }
    for scope in SCOPES {
        let p = dir_for(root, scope).join(format!("{id}.md"));
        if fs::symlink_metadata(&p).is_ok() {
            return Ok((p, scope));
        }
    }
    Err("instinct not found".into())
}

fn clean_line(s: &str, max: usize, what: &str) -> Result<String, String> {
    let s = s.trim().to_string();
    if s.is_empty() || s.chars().count() > max || !no_controls(&s, false) {
        return Err(format!("{what} must be 1 to {max} characters on one line"));
    }
    Ok(s)
}

pub fn add(root: &Path, req: AddRequest) -> Result<Instinct, String> {
    let trigger = clean_line(&req.trigger, MAX_TRIGGER, "trigger")?;
    let action = clean_line(&req.action, MAX_ACTION, "action")?;
    let domain = req.domain.unwrap_or_else(|| "general".into());
    let scope = req.scope.unwrap_or_else(|| "project".into());
    let confidence = req.confidence.unwrap_or(START_CONFIDENCE);
    let mut evidence = req.evidence.unwrap_or_default();
    if !valid_slug(&domain) {
        return Err("domain must be a lowercase slug".into());
    }
    if !SCOPES.contains(&scope.as_str()) {
        return Err("scope must be project or global".into());
    }
    if !(0.3..=0.9).contains(&confidence) {
        return Err("confidence must be between 0.3 and 0.9".into());
    }
    evidence.truncate(MAX_EVIDENCE);
    for e in &mut evidence {
        *e = clean_line(e, 200, "evidence")?;
    }
    if let Some(what) = scan_secrets(&format!("{trigger}\n{action}")) {
        return Err(format!("refused: the text looks like {what}. Nothing was saved."));
    }

    let (day, iso) = now_stamp();
    let dir = dir_for(root, &scope);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for attempt in 0..16 {
        let id = format!("ins_{day}_{}", random_suffix(attempt));
        let path = dir.join(format!("{id}.md"));
        let instinct = Instinct { id, trigger: trigger.clone(), action: action.clone(), domain: domain.clone(), scope: scope.clone(), confidence, status: "active".into(), evidence: evidence.clone(), created_at: iso.clone(), updated_at: iso.clone() };
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(render(&instinct).as_bytes()).map_err(|e| e.to_string())?;
                return Ok(instinct);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("could not allocate a unique id".into())
}

fn load(root: &Path, scope: &str) -> (Vec<Instinct>, usize) {
    let mut out = vec![];
    let mut bad = 0;
    let Ok(entries) = fs::read_dir(dir_for(root, scope)) else { return (out, 0) };
    for entry in entries.flatten().take(MAX_FILES) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        match read_regular(&path).and_then(|t| parse(&t, scope)) {
            Ok(i) => out.push(i),
            Err(_) => bad += 1,
        }
    }
    (out, bad)
}

pub fn list(root: &Path, include_retired: bool) -> Vec<Instinct> {
    let mut all: Vec<Instinct> = SCOPES.iter().flat_map(|s| load(root, s).0).filter(|i| include_retired || i.status == "active").collect();
    all.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal).then_with(|| b.created_at.cmp(&a.created_at)));
    all
}

/// What may be shown to the model: active, at or above the threshold, highest confidence first.
pub fn top(root: &Path, limit: usize, min_confidence: f64) -> Vec<Instinct> {
    list(root, false).into_iter().filter(|i| i.confidence >= min_confidence).take(limit.clamp(1, 12)).collect()
}

fn update(root: &Path, id: &str, change: impl FnOnce(&mut Instinct)) -> Result<Instinct, String> {
    let (path, scope) = locate(root, id)?;
    let mut i = parse(&read_regular(&path)?, scope)?;
    change(&mut i);
    i.updated_at = now_stamp().1;
    atomic_replace(&path, &render(&i))?;
    Ok(i)
}

/// User-initiated only. Moves confidence by `delta` (clamped) and records why.
pub fn adjust(root: &Path, id: &str, delta: f64, note: Option<String>) -> Result<Instinct, String> {
    if !(-0.5..=0.5).contains(&delta) {
        return Err("delta must be between -0.5 and 0.5".into());
    }
    let note = note.map(|n| clean_line(&n, 200, "note")).transpose()?;
    update(root, id, |i| {
        i.confidence = ((i.confidence + delta).clamp(MIN_CONFIDENCE, MAX_CONFIDENCE) * 100.0).round() / 100.0;
        if let Some(n) = note {
            i.evidence.push(n);
            while i.evidence.len() > MAX_EVIDENCE {
                i.evidence.remove(0);
            }
        }
    })
}

pub fn retire(root: &Path, id: &str) -> Result<Instinct, String> {
    update(root, id, |i| i.status = "retired".into())
}

/// User-initiated: move a project instinct into the global scope (a deliberate act, never automatic).
pub fn promote(root: &Path, id: &str) -> Result<Instinct, String> {
    let (old, scope) = locate(root, id)?;
    if scope == "global" {
        return Err("already global".into());
    }
    let mut i = parse(&read_regular(&old)?, scope)?;
    i.scope = "global".into();
    i.updated_at = now_stamp().1;
    let dir = dir_for(root, "global");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let new = dir.join(format!("{id}.md"));
    fs::OpenOptions::new().write(true).create_new(true).open(&new).and_then(|mut f| f.write_all(render(&i).as_bytes())).map_err(|e| e.to_string())?;
    fs::remove_file(&old).map_err(|e| e.to_string())?;
    Ok(i)
}

#[tauri::command]
pub fn instinct_add(request: AddRequest) -> Result<Instinct, String> {
    add(&vault_root(), request)
}

#[tauri::command]
pub fn instinct_list(include_retired: Option<bool>) -> Vec<Instinct> {
    list(&vault_root(), include_retired.unwrap_or(false))
}

#[tauri::command]
pub fn instinct_top(limit: Option<usize>, min_confidence: Option<f64>) -> Vec<Instinct> {
    top(&vault_root(), limit.unwrap_or(6), min_confidence.unwrap_or(0.7))
}

#[tauri::command]
pub fn instinct_adjust(id: String, delta: f64, note: Option<String>) -> Result<Instinct, String> {
    adjust(&vault_root(), &id, delta, note)
}

#[tauri::command]
pub fn instinct_retire(id: String) -> Result<Instinct, String> {
    retire(&vault_root(), &id)
}

#[tauri::command]
pub fn instinct_promote(id: String) -> Result<Instinct, String> {
    promote(&vault_root(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("jarvis-ins-{name}-{}-{}", std::process::id(), random_suffix(3)));
        let _ = fs::remove_dir_all(&p);
        p
    }

    fn req(t: &str, a: &str) -> AddRequest {
        AddRequest { trigger: t.into(), action: a.into(), ..Default::default() }
    }

    #[test]
    fn add_list_and_threshold() {
        let root = temp_root("add");
        let strong = add(&root, req("when answering casually", "keep it under five sentences")).unwrap();
        let weak = add(&root, AddRequest { confidence: Some(0.4), ..req("when writing code", "prefer small functions") }).unwrap();
        assert_eq!(strong.confidence, 0.7);
        assert_eq!(list(&root, false).len(), 2);
        let shown = top(&root, 6, 0.7);
        assert_eq!(shown.len(), 1, "only instincts at or above the threshold reach the model");
        assert_eq!(shown[0].id, strong.id);
        assert!(top(&root, 6, 0.3).iter().any(|i| i.id == weak.id));
    }

    #[test]
    fn adjust_clamps_records_evidence_and_can_cross_the_threshold() {
        let root = temp_root("adjust");
        let i = add(&root, AddRequest { confidence: Some(0.6), ..req("trigger", "action") }).unwrap();
        assert!(top(&root, 6, 0.7).is_empty());
        let up = adjust(&root, &i.id, 0.2, Some("user confirmed twice".into())).unwrap();
        assert_eq!(up.confidence, 0.8);
        assert_eq!(top(&root, 6, 0.7).len(), 1);
        assert_eq!(up.evidence, vec!["user confirmed twice".to_string()]);
        assert_eq!(adjust(&root, &i.id, 0.5, None).unwrap().confidence, 0.95);
        assert_eq!(adjust(&root, &i.id, -0.5, None).unwrap().confidence, 0.45);
        assert!(adjust(&root, &i.id, 0.9, None).is_err());
    }

    #[test]
    fn retire_and_promote_are_explicit_user_actions() {
        let root = temp_root("lifecycle");
        let i = add(&root, req("trigger", "action")).unwrap();
        let g = promote(&root, &i.id).unwrap();
        assert_eq!(g.scope, "global");
        assert!(!dir_for(&root, "project").join(format!("{}.md", i.id)).exists());
        assert!(promote(&root, &i.id).is_err());
        retire(&root, &i.id).unwrap();
        assert!(list(&root, false).is_empty());
        assert_eq!(list(&root, true).len(), 1);
    }

    #[test]
    fn rejects_secrets_multiline_and_bad_ids() {
        let root = temp_root("reject");
        assert!(add(&root, req("t", "use token = abcdefghijkl1234")).is_err());
        assert!(add(&root, req("two\nlines", "a")).is_err());
        assert!(add(&root, req("", "a")).is_err());
        assert!(add(&root, AddRequest { confidence: Some(0.99), ..req("t", "a") }).is_err());
        assert!(adjust(&root, "../x", 0.1, None).is_err());
        assert!(!root.join("instincts").exists());
    }
}
