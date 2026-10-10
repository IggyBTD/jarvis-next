//! Memory vault: small markdown files with strict JSON-valued frontmatter.
//!
//! Rules (see `.md Files/JARVIS_ECC_Design_Notes.md`):
//! - the files are the source of truth; nothing here is an index that can't be rebuilt
//! - writes are create-only (`create_new`): an existing id is never overwritten
//! - credential-shaped text is rejected before anything is written
//! - symlinks are never followed; ids are validated so a path can't escape the vault
//! - a recalled memory is data. Callers must label it as untrusted when giving it to a model.
//! - nothing here promotes a memory into rules, skills or policy
//!
//! Layout: `<root>/<scope>/<kind>/<id>.md`, scope = project | user.
//! Isolated like telemetry.rs: no dependency on the rest of the app.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEMA: &str = "jarvis.memory.v1";
pub const KINDS: [&str; 8] = ["context", "decision", "fact", "handoff", "lesson", "note", "preference", "runbook"];
pub const SCOPES: [&str; 2] = ["project", "user"];
pub const STATUSES: [&str; 3] = ["active", "superseded", "rejected"];

const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 4096;
const MAX_TAGS: usize = 8;
const MAX_LINKS: usize = 8;
const MAX_FILES: usize = 5000;
const MAX_FILE_BYTES: u64 = 16 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Memory {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub scope: String,
    pub status: String,
    pub source: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub created_at: String,
    pub body: String,
}

#[derive(Deserialize, Default)]
pub struct SaveRequest {
    pub title: String,
    pub body: String,
    pub kind: Option<String>,
    pub scope: Option<String>,
    pub tags: Option<Vec<String>>,
    pub links: Option<Vec<String>>,
    pub source: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct Hit {
    pub memory: Memory,
    pub score: u32,
    pub snippet: String,
}

#[derive(Serialize, Debug)]
pub struct SearchResult {
    pub results: Vec<Hit>,
    pub scanned: usize,
    pub malformed: usize,
    /// The scan hit the file cap: absence of a result must not be read as absence of a memory.
    pub truncated: bool,
}

#[derive(Serialize, Debug, Default)]
pub struct Doctor {
    pub files: usize,
    pub active: usize,
    pub malformed: Vec<String>,
    pub duplicate_ids: Vec<String>,
    pub broken_links: Vec<String>,
    pub symlinks_skipped: usize,
    pub truncated: bool,
}

// --- shared helpers (also used by instincts.rs) ------------------------------

/// The vault root: `JARVIS_MEMORY_DIR`, else `<project>/memory` found by walking up from the
/// working directory to the folder that holds `config/system-prompt.md`.
pub fn vault_root() -> PathBuf {
    if let Ok(dir) = std::env::var("JARVIS_MEMORY_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let start = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut dir: Option<&Path> = Some(start.as_path());
    while let Some(d) = dir {
        if d.join("config").join("system-prompt.md").is_file() {
            return d.join("memory");
        }
        dir = d.parent();
    }
    start.join("memory")
}

fn secret_patterns() -> &'static Vec<(Regex, &'static str)> {
    static P: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    P.get_or_init(|| {
        [
            (r"sk-[A-Za-z0-9_-]{20,}", "an API key (sk-...)"),
            (r"AKIA[0-9A-Z]{16}", "an AWS access key"),
            (r"gh[pousr]_[A-Za-z0-9]{30,}", "a GitHub token"),
            (r"xox[abprs]-[A-Za-z0-9-]{10,}", "a Slack token"),
            (r"AIza[0-9A-Za-z_-]{35}", "a Google API key"),
            (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "a private key"),
            (r"(?i)\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{8,}", "a credential assignment"),
        ]
        .iter()
        .map(|(p, n)| (Regex::new(p).expect("valid secret pattern"), *n))
        .collect()
    })
}

/// Best-effort backstop, not a classifier: returns what looked like a credential.
pub fn scan_secrets(text: &str) -> Option<&'static str> {
    secret_patterns().iter().find(|(re, _)| re.is_match(text)).map(|(_, name)| *name)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// (`YYYYMMDD`, ISO 8601 UTC timestamp)
pub fn now_stamp() -> (String, String) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    (
        format!("{y:04}{m:02}{d:02}"),
        format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60),
    )
}

pub fn random_suffix(counter: u32) -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    format!("{:04x}", (nanos.wrapping_mul(2_654_435_761).wrapping_add(counter.wrapping_mul(40_503))) & 0xffff)
}

pub fn valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 32
        && s.chars().next().map_or(false, |c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// `<prefix>_YYYYMMDD_hex`, the only shape accepted as an id (it can never contain a path separator).
pub fn valid_id(id: &str, prefix: &str) -> bool {
    let mut parts = id.splitn(3, '_');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(p), Some(d), Some(h)) => {
            p == prefix
                && d.len() == 8
                && d.chars().all(|c| c.is_ascii_digit())
                && (4..=8).contains(&h.len())
                && h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        }
        _ => false,
    }
}

pub fn no_controls(s: &str, allow_newlines: bool) -> bool {
    s.chars().all(|c| !c.is_control() || (allow_newlines && (c == '\n' || c == '\t')))
}

/// Reads a regular file (never a symlink) within a size cap.
pub fn read_regular(path: &Path) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("symlink skipped".into());
    }
    if !meta.is_file() {
        return Err("not a regular file".into());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err("file too large".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Splits `---\nkey: json\n...\n---\nbody` into the frontmatter map and the body.
pub fn split_frontmatter(text: &str) -> Result<(serde_json::Map<String, serde_json::Value>, String), String> {
    let text = text.replace("\r\n", "\n");
    let rest = text.strip_prefix("---\n").ok_or("missing frontmatter")?;
    let end = rest.find("\n---\n").or_else(|| rest.strip_suffix("\n---").map(|r| r.len())).ok_or("unterminated frontmatter")?;
    let (head, tail) = rest.split_at(end);
    let body = tail.trim_start_matches("\n---").trim_start_matches('\n').trim().to_string();
    let mut map = serde_json::Map::new();
    for line in head.lines().filter(|l| !l.trim().is_empty()) {
        let (k, v) = line.split_once(": ").ok_or_else(|| format!("bad frontmatter line: {line}"))?;
        let value: serde_json::Value = serde_json::from_str(v.trim()).map_err(|_| format!("frontmatter value for '{k}' is not valid JSON"))?;
        if map.insert(k.trim().to_string(), value).is_some() {
            return Err(format!("duplicate frontmatter key '{k}'"));
        }
    }
    Ok((map, body))
}

pub fn get_str(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Result<String, String> {
    map.get(key).and_then(|v| v.as_str()).map(str::to_string).ok_or_else(|| format!("missing or non-string '{key}'"))
}

pub fn get_strs(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Result<Vec<String>, String> {
    map.get(key)
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("missing or non-array '{key}'"))?
        .iter()
        .map(|v| v.as_str().map(str::to_string).ok_or_else(|| format!("'{key}' must hold strings")))
        .collect()
}

/// Writes through a temp file and renames, so a crash never leaves half a file.
pub fn atomic_replace(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// --- the memory format -------------------------------------------------------

fn render(m: &Memory) -> String {
    let j = |v: &dyn erased::ToJson| v.to_json();
    format!(
        "---\nschema: {}\nid: {}\ntitle: {}\nkind: {}\nscope: {}\nstatus: {}\nsource: {}\ntags: {}\nlinks: {}\ncreated_at: {}\n---\n{}\n",
        j(&SCHEMA), j(&m.id), j(&m.title), j(&m.kind), j(&m.scope), j(&m.status), j(&m.source), j(&m.tags), j(&m.links), j(&m.created_at), m.body.trim()
    )
}

mod erased {
    pub trait ToJson {
        fn to_json(&self) -> String;
    }
    impl<T: serde::Serialize + ?Sized> ToJson for T {
        fn to_json(&self) -> String {
            serde_json::to_string(self).unwrap_or_else(|_| "null".into())
        }
    }
}

pub fn parse_memory(text: &str, scope_dir: &str, kind_dir: &str) -> Result<Memory, String> {
    let (map, body) = split_frontmatter(text)?;
    if get_str(&map, "schema")? != SCHEMA {
        return Err("unknown schema".into());
    }
    let m = Memory {
        id: get_str(&map, "id")?,
        title: get_str(&map, "title")?,
        kind: get_str(&map, "kind")?,
        scope: get_str(&map, "scope")?,
        status: get_str(&map, "status")?,
        source: get_str(&map, "source")?,
        tags: get_strs(&map, "tags")?,
        links: get_strs(&map, "links")?,
        created_at: get_str(&map, "created_at")?,
        body,
    };
    if !valid_id(&m.id, "mem") || !KINDS.contains(&m.kind.as_str()) || !SCOPES.contains(&m.scope.as_str()) || !STATUSES.contains(&m.status.as_str()) {
        return Err("invalid field value".into());
    }
    if m.scope != scope_dir || m.kind != kind_dir {
        return Err("file location does not match its scope and kind".into());
    }
    Ok(m)
}

fn file_for(root: &Path, scope: &str, kind: &str, id: &str) -> PathBuf {
    root.join(scope).join(kind).join(format!("{id}.md"))
}

fn ensure_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let ignore = root.join(".gitignore");
    if !ignore.exists() {
        fs::write(&ignore, "*\n!.gitignore\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- operations --------------------------------------------------------------

pub fn save(root: &Path, req: SaveRequest) -> Result<Memory, String> {
    let title = req.title.trim().to_string();
    let body = req.body.trim().to_string();
    let kind = req.kind.unwrap_or_else(|| "note".into());
    let scope = req.scope.unwrap_or_else(|| "project".into());
    let tags = req.tags.unwrap_or_default();
    let links = req.links.unwrap_or_default();
    let source = req.source.unwrap_or_else(|| "chat".into());

    if title.is_empty() || title.chars().count() > MAX_TITLE || !no_controls(&title, false) {
        return Err(format!("title must be 1 to {MAX_TITLE} characters on one line"));
    }
    if body.is_empty() || body.len() > MAX_BODY || !no_controls(&body, true) {
        return Err(format!("body must be 1 to {MAX_BODY} bytes of text"));
    }
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!("kind must be one of: {}", KINDS.join(", ")));
    }
    if !SCOPES.contains(&scope.as_str()) {
        return Err("scope must be project or user".into());
    }
    if tags.len() > MAX_TAGS || !tags.iter().all(|t| valid_slug(t)) {
        return Err(format!("tags: at most {MAX_TAGS}, each a lowercase slug of up to 32 characters"));
    }
    if links.len() > MAX_LINKS || !links.iter().all(|l| valid_id(l, "mem")) {
        return Err("links must be memory ids".into());
    }
    if !["chat", "skill", "manual", "import"].contains(&source.as_str()) {
        return Err("source must be chat, skill, manual or import".into());
    }
    if let Some(what) = scan_secrets(&format!("{title}\n{body}")) {
        return Err(format!("refused: the text looks like {what}. Nothing was saved."));
    }

    ensure_root(root)?;
    let (day, iso) = now_stamp();
    for attempt in 0..16 {
        let id = format!("mem_{day}_{}", random_suffix(attempt));
        let path = file_for(root, &scope, &kind, &id);
        fs::create_dir_all(path.parent().expect("has parent")).map_err(|e| e.to_string())?;
        let memory = Memory { id: id.clone(), title: title.clone(), kind: kind.clone(), scope: scope.clone(), status: "active".into(), source: source.clone(), tags: tags.clone(), links: links.clone(), created_at: iso.clone(), body: body.clone() };
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(render(&memory).as_bytes()).map_err(|e| e.to_string())?;
                return Ok(memory);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue, // create-only: try another id
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("could not allocate a unique id".into())
}

fn locate(root: &Path, id: &str) -> Result<(PathBuf, &'static str, &'static str), String> {
    if !valid_id(id, "mem") {
        return Err("invalid memory id".into());
    }
    for scope in SCOPES {
        for kind in KINDS {
            let p = file_for(root, scope, kind, id);
            if fs::symlink_metadata(&p).is_ok() {
                return Ok((p, scope, kind));
            }
        }
    }
    Err("memory not found".into())
}

pub fn read(root: &Path, id: &str) -> Result<Memory, String> {
    let (path, scope, kind) = locate(root, id)?;
    parse_memory(&read_regular(&path)?, scope, kind)
}

/// User-initiated only (the model has no command for this): change the status line, nothing else.
pub fn set_status(root: &Path, id: &str, status: &str) -> Result<Memory, String> {
    if !STATUSES.contains(&status) {
        return Err("status must be active, superseded or rejected".into());
    }
    let (path, scope, kind) = locate(root, id)?;
    let mut m = parse_memory(&read_regular(&path)?, scope, kind)?;
    m.status = status.to_string();
    atomic_replace(&path, &render(&m))?;
    Ok(m)
}

struct Scan {
    memories: Vec<Memory>,
    malformed: Vec<String>,
    symlinks: usize,
    scanned: usize,
    truncated: bool,
}

fn scan(root: &Path, scope_filter: Option<&str>) -> Scan {
    let mut out = Scan { memories: vec![], malformed: vec![], symlinks: 0, scanned: 0, truncated: false };
    'outer: for scope in SCOPES.iter().filter(|s| scope_filter.map_or(true, |f| f == **s)) {
        for kind in KINDS {
            let dir = root.join(scope).join(kind);
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if out.scanned >= MAX_FILES {
                    out.truncated = true;
                    break 'outer;
                }
                out.scanned += 1;
                match read_regular(&path).and_then(|t| parse_memory(&t, scope, kind)) {
                    Ok(m) => out.memories.push(m),
                    Err(e) if e == "symlink skipped" => out.symlinks += 1,
                    Err(e) => out.malformed.push(format!("{}: {e}", path.strip_prefix(root).unwrap_or(&path).display())),
                }
            }
        }
    }
    out
}

fn words(s: &str) -> Vec<String> {
    s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() >= 2).map(str::to_string).collect()
}

fn snippet(body: &str, terms: &[String]) -> String {
    let flat: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = flat.to_lowercase();
    let at = terms.iter().filter_map(|t| lower.find(t.as_str())).min().unwrap_or(0);
    let start = flat.char_indices().map(|(i, _)| i).filter(|i| *i + 60 >= at).next().unwrap_or(0);
    let piece: String = flat[start..].chars().take(160).collect();
    piece
}

/// Bounded lexical search over active memories. Empty query returns the most recent.
pub fn search(root: &Path, query: &str, scope: Option<&str>, limit: usize) -> SearchResult {
    let s = scan(root, scope);
    let terms = words(query);
    let mut hits: Vec<Hit> = s
        .memories
        .into_iter()
        .filter(|m| m.status == "active")
        .filter_map(|m| {
            if terms.is_empty() {
                return Some(Hit { snippet: snippet(&m.body, &terms), score: 0, memory: m });
            }
            let (title, body) = (words(&m.title), words(&m.body));
            let mut score = 0u32;
            for t in &terms {
                score += 3 * title.iter().filter(|w| *w == t).count() as u32;
                score += 2 * m.tags.iter().filter(|g| *g == t).count() as u32;
                score += body.iter().filter(|w| *w == t).count().min(5) as u32;
            }
            (score > 0).then(|| Hit { snippet: snippet(&m.body, &terms), score, memory: m })
        })
        .collect();
    hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.memory.created_at.cmp(&a.memory.created_at)));
    hits.truncate(limit.clamp(1, 50));
    SearchResult { results: hits, scanned: s.scanned, malformed: s.malformed.len(), truncated: s.truncated }
}

pub fn doctor(root: &Path) -> Doctor {
    let s = scan(root, None);
    let mut d = Doctor { files: s.scanned, malformed: s.malformed, symlinks_skipped: s.symlinks, truncated: s.truncated, ..Default::default() };
    let mut seen = std::collections::HashSet::new();
    for m in &s.memories {
        if m.status == "active" {
            d.active += 1;
        }
        if !seen.insert(m.id.clone()) {
            d.duplicate_ids.push(m.id.clone());
        }
    }
    for m in &s.memories {
        for l in &m.links {
            if !seen.contains(l) {
                d.broken_links.push(format!("{} -> {l}", m.id));
            }
        }
    }
    d
}

// --- Tauri commands ----------------------------------------------------------

#[tauri::command]
pub fn memory_save(request: SaveRequest) -> Result<Memory, String> {
    save(&vault_root(), request)
}

#[tauri::command]
pub fn memory_search(query: String, scope: Option<String>, limit: Option<usize>) -> SearchResult {
    search(&vault_root(), &query, scope.as_deref(), limit.unwrap_or(5))
}

#[tauri::command]
pub fn memory_read(id: String) -> Result<Memory, String> {
    read(&vault_root(), &id)
}

#[tauri::command]
pub fn memory_set_status(id: String, status: String) -> Result<Memory, String> {
    set_status(&vault_root(), &id, &status)
}

#[tauri::command]
pub fn memory_doctor() -> Doctor {
    doctor(&vault_root())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("jarvis-mem-{name}-{}-{}", std::process::id(), random_suffix(7)));
        let _ = fs::remove_dir_all(&p);
        p
    }

    fn req(title: &str, body: &str) -> SaveRequest {
        SaveRequest { title: title.into(), body: body.into(), ..Default::default() }
    }

    #[test]
    fn save_then_read_round_trips() {
        let root = temp_root("roundtrip");
        let m = save(&root, SaveRequest { kind: Some("preference".into()), tags: Some(vec!["style".into()]), ..req("Short answers", "Keep replies under five sentences.") }).unwrap();
        assert!(valid_id(&m.id, "mem"));
        let back = read(&root, &m.id).unwrap();
        assert_eq!(back, m);
        assert_eq!(back.status, "active");
        assert!(root.join(".gitignore").exists());
    }

    #[test]
    fn rejects_secrets_and_bad_input() {
        let root = temp_root("reject");
        assert!(save(&root, req("Key", "my key is sk-abcdefghijklmnopqrstuvwxyz123456")).unwrap_err().contains("API key"));
        assert!(save(&root, req("Pw", "password = hunter2hunter2")).is_err());
        assert!(save(&root, req("", "body")).is_err());
        assert!(save(&root, req("ok", &"x".repeat(MAX_BODY + 1))).is_err());
        assert!(save(&root, SaveRequest { kind: Some("../evil".into()), ..req("t", "b") }).is_err());
        assert!(save(&root, SaveRequest { tags: Some(vec!["Bad Tag".into()]), ..req("t", "b") }).is_err());
        assert!(!root.join("project").exists(), "nothing may be written on refusal");
    }

    #[test]
    fn ids_cannot_escape_the_vault() {
        let root = temp_root("escape");
        for bad in ["../../etc/passwd", "mem_20260101_../x", "mem_2026_abcd", "", "mem_20260101_ABCD"] {
            assert!(read(&root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn create_only_never_overwrites() {
        let root = temp_root("createonly");
        let a = save(&root, req("one", "first body")).unwrap();
        let path = file_for(&root, &a.scope, &a.kind, &a.id);
        let original = fs::read_to_string(&path).unwrap();
        for i in 0..20 {
            let _ = save(&root, req(&format!("t{i}"), "other body"));
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert!(fs::OpenOptions::new().write(true).create_new(true).open(&path).is_err());
    }

    #[test]
    fn search_ranks_filters_and_reports_status() {
        let root = temp_root("search");
        save(&root, SaveRequest { tags: Some(vec!["lmstudio".into()]), ..req("LM Studio port", "LM Studio listens on port 1234.") }).unwrap();
        save(&root, req("Unrelated", "Something about gardening.")).unwrap();
        let old = save(&root, req("Old port note", "The port used to be 1235.")).unwrap();
        let r = search(&root, "lm studio port", None, 5);
        assert_eq!(r.results[0].memory.title, "LM Studio port");
        assert!(!r.truncated && r.malformed == 0);
        set_status(&root, &old.id, "superseded").unwrap();
        let r = search(&root, "port", None, 5);
        assert!(r.results.iter().all(|h| h.memory.id != old.id), "superseded memories drop out of recall");
        assert_eq!(read(&root, &old.id).unwrap().status, "superseded", "direct read still works");
        assert_eq!(search(&root, "", None, 10).results.len(), 2, "empty query lists recent active");
    }

    #[test]
    fn scope_filter_and_malformed_files_are_reported_not_deleted() {
        let root = temp_root("malformed");
        save(&root, SaveRequest { scope: Some("user".into()), ..req("mine", "private note") }).unwrap();
        save(&root, req("shared", "project note")).unwrap();
        assert_eq!(search(&root, "note", Some("user"), 5).results.len(), 1);
        let bad = root.join("project").join("note").join("mem_20260101_dead.md");
        fs::write(&bad, "not frontmatter at all").unwrap();
        let r = search(&root, "note", None, 5);
        assert_eq!(r.malformed, 1);
        let d = doctor(&root);
        assert_eq!(d.malformed.len(), 1);
        assert!(bad.exists(), "a malformed file is never deleted or rewritten");
    }

    #[test]
    fn doctor_finds_broken_links() {
        let root = temp_root("links");
        let a = save(&root, req("a", "body a")).unwrap();
        save(&root, SaveRequest { links: Some(vec![a.id.clone(), "mem_20200101_ffff".into()]), ..req("b", "body b") }).unwrap();
        let d = doctor(&root);
        assert_eq!(d.files, 2);
        assert_eq!(d.broken_links.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_skipped() {
        let root = temp_root("symlink");
        let m = save(&root, req("real", "body")).unwrap();
        let real = file_for(&root, &m.scope, &m.kind, &m.id);
        std::os::unix::fs::symlink(&real, real.with_file_name("mem_20260101_beef.md")).unwrap();
        assert_eq!(doctor(&root).symlinks_skipped, 1);
    }

    #[test]
    fn frontmatter_parser_rejects_garbage() {
        assert!(split_frontmatter("hello").is_err());
        assert!(split_frontmatter("---\nid: not json\n---\nbody").is_err());
        assert!(split_frontmatter("---\nid: \"a\"\nid: \"b\"\n---\nbody").is_err());
        let (map, body) = split_frontmatter("---\r\nid: \"a\"\r\n---\r\nbody text\r\n").unwrap();
        assert_eq!(map["id"], "a");
        assert_eq!(body, "body text");
    }

    #[test]
    fn timestamps_are_well_formed() {
        let (day, iso) = now_stamp();
        assert_eq!(day.len(), 8);
        assert!(iso.starts_with(&format!("{}-{}-{}T", &day[0..4], &day[4..6], &day[6..8])) && iso.ends_with('Z'));
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_454), (2026, 1, 1));
    }
}
