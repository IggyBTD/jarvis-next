//! Web search and page fetch for the model (web_search, web_fetch in config/actions.json). The
//! internet switch is enforced here as well as in the webview: JavaScript tells Rust its state, and
//! until it does, every request is refused. Pages on this machine or the local network are never
//! fetched, including through a redirect, so a page cannot steer the model at LM Studio or a router.
use regex::Regex;
use serde::Serialize;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

static ALLOWED: AtomicBool = AtomicBool::new(false);
const MAX_BODY: usize = 3 * 1024 * 1024;
const MAX_TEXT: usize = 6000; // about 1.7K tokens: a 32K window holds a few pages and the chat

#[tauri::command]
pub fn web_set_allowed(allowed: bool) {
    ALLOWED.store(allowed, Ordering::SeqCst);
}

fn check_allowed() -> Result<(), String> {
    if ALLOWED.load(Ordering::SeqCst) { Ok(()) } else { Err("internet access is switched off".into()) }
}

/// Hosts that must never be fetched: this machine, the local network, link-local and the like.
/// shortcut: checks the name and IP literals only, not what a public name resolves to (DNS
/// rebinding); upgrade by resolving first if the agent ever runs unattended.
pub fn is_private_host(host: &str) -> bool {
    let h = host.trim_matches(|c| c == '[' || c == ']').to_lowercase();
    if h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") || h.ends_with(".lan") || h.ends_with(".internal") || !h.contains('.') && !h.contains(':') {
        return true;
    }
    match h.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() || ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]),
        Ok(IpAddr::V6(ip)) => ip.is_loopback() || ip.is_unspecified() || (ip.segments()[0] & 0xfe00) == 0xfc00 || (ip.segments()[0] & 0xffc0) == 0xfe80,
        Err(_) => false,
    }
}

fn public_url(url: &reqwest::Url) -> Result<(), String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(format!("only http and https pages can be fetched, not {}", url.scheme()));
    }
    match url.host_str() {
        Some(h) if !is_private_host(h) => Ok(()),
        _ => Err("pages on this machine or the local network are not fetched".into()),
    }
}

fn client() -> &'static reqwest::blocking::Client {
    static C: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS")
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || public_url(attempt.url()).is_err() { attempt.stop() } else { attempt.follow() }
            }))
            .build()
            .expect("http client")
    })
}

fn get_text(url: &reqwest::Url) -> Result<(String, String, String), String> {
    let res = client().get(url.clone()).send().map_err(|e| e.to_string())?;
    public_url(res.url())?; // a stopped redirect leaves us on the private address: refuse it
    if !res.status().is_success() {
        return Err(format!("the site answered {}", res.status()));
    }
    let final_url = res.url().to_string();
    let kind = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let mut body = Vec::new();
    use std::io::Read;
    res.take(MAX_BODY as u64).read_to_end(&mut body).map_err(|e| e.to_string())?;
    Ok((final_url, kind, String::from_utf8_lossy(&body).into_owned()))
}

// --- HTML to text ---------------------------------------------------------------------------

fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).unwrap())
}

pub fn decode_entities(s: &str) -> String {
    static NUM: OnceLock<Regex> = OnceLock::new();
    let s = re(r"&#(x[0-9a-fA-F]+|[0-9]+);", &NUM).replace_all(s, |c: &regex::Captures| {
        let v = &c[1];
        let n = if let Some(hex) = v.strip_prefix('x') { u32::from_str_radix(hex, 16).ok() } else { v.parse().ok() };
        n.and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&amp;", "&")
}

pub fn html_title(html: &str) -> String {
    static T: OnceLock<Regex> = OnceLock::new();
    re(r"(?is)<title[^>]*>(.*?)</title>", &T).captures(html).map(|c| decode_entities(c[1].trim())).unwrap_or_default()
}

/// The readable text of a page: scripts, styles, navigation and forms dropped, blocks on their own lines.
pub fn html_to_text(html: &str) -> String {
    static DROP: OnceLock<Regex> = OnceLock::new();
    static BLOCK: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static SPACES: OnceLock<Regex> = OnceLock::new();
    static LINES: OnceLock<Regex> = OnceLock::new();
    let body = re(r"(?is)<!--.*?-->|<(script|style|noscript|svg|nav|header|footer|template|iframe|title)\b[^>]*>.*?</(script|style|noscript|svg|nav|header|footer|template|iframe|title)>", &DROP).replace_all(html, " ");
    let body = re(r"(?i)<(br|/p|/div|/li|/h[1-6]|/tr|/section|/article|/pre|/blockquote)\b[^>]*>|<(li|h[1-6]|tr|p)\b[^>]*>", &BLOCK).replace_all(&body, "\n");
    let body = re(r"(?s)<[^>]*>", &TAG).replace_all(&body, "");
    let body = decode_entities(&body);
    let body = re(r"[ \t\r\x{a0}]+", &SPACES).replace_all(&body, " ");
    let body = re(r"\s*\n\s*(\n\s*)*", &LINES).replace_all(&body, "\n");
    body.trim().to_string()
}

// --- search -----------------------------------------------------------------------------------

#[derive(Serialize, Debug, PartialEq)]
pub struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Results from DuckDuckGo's plain HTML page. Its links go through a redirect (/l/?uddg=<url>),
/// which is unwrapped; ads (y.js links) are skipped.
pub fn parse_duckduckgo(html: &str, limit: usize) -> Vec<Hit> {
    static LINK: OnceLock<Regex> = OnceLock::new();
    static SNIP: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    let strip = |s: &str| decode_entities(&re(r"(?s)<[^>]*>", &TAG).replace_all(s, "")).trim().to_string();
    let links: Vec<regex::Captures> = re(r#"(?is)<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#, &LINK).captures_iter(html).collect();
    let mut out = Vec::new();
    for (i, c) in links.iter().enumerate() {
        // The snippet is the first one after this link and before the next, so a result without one gets none.
        let end = links.get(i + 1).map_or(html.len(), |n| n.get(0).unwrap().start());
        let snippet = re(r#"(?is)<a[^>]*class="result__snippet"[^>]*>(.*?)</a>"#, &SNIP).captures(&html[c.get(0).unwrap().end()..end]).map(|m| strip(&m[1])).unwrap_or_default();
        let href = decode_entities(&c[1]);
        let url = match href.split_once("uddg=") {
            Some((_, rest)) => percent_decode(rest.split('&').next().unwrap_or("")),
            None => href.clone(),
        };
        if !url.starts_with("http") || url.contains("duckduckgo.com/y.js") {
            continue;
        }
        out.push(Hit { title: strip(&c[2]), url, snippet });
        if out.len() >= limit {
            break;
        }
    }
    out
}

pub fn parse_searxng(json: &str, limit: usize) -> Result<Vec<Hit>, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("SearXNG answer is not JSON: {e}"))?;
    Ok(v["results"].as_array().map(|a| a.as_slice()).unwrap_or(&[]).iter().take(limit).map(|r| Hit {
        title: r["title"].as_str().unwrap_or("").to_string(),
        url: r["url"].as_str().unwrap_or("").to_string(),
        snippet: r["content"].as_str().unwrap_or("").to_string(),
    }).filter(|h| h.url.starts_with("http")).collect())
}

/// searxng: base URL of your own SearXNG (it may be on this machine); otherwise DuckDuckGo.
#[tauri::command]
pub fn web_search(query: String, searxng: Option<String>) -> Result<Vec<Hit>, String> {
    check_allowed()?;
    let q = query.trim();
    if q.is_empty() || q.len() > 400 {
        return Err("the query must be 1 to 400 characters".into());
    }
    if let Some(base) = searxng.filter(|s| !s.trim().is_empty()) {
        let mut url = reqwest::Url::parse(&format!("{}/search", base.trim_end_matches('/'))).map_err(|e| e.to_string())?;
        url.query_pairs_mut().append_pair("q", q).append_pair("format", "json");
        let res = reqwest::blocking::Client::new().get(url).timeout(Duration::from_secs(15)).send().map_err(|e| e.to_string())?;
        return parse_searxng(&res.text().map_err(|e| e.to_string())?, 8);
    }
    let mut url = reqwest::Url::parse("https://html.duckduckgo.com/html/").unwrap();
    url.query_pairs_mut().append_pair("q", q);
    let (_, _, html) = get_text(&url)?;
    let hits = parse_duckduckgo(&html, 8);
    if hits.is_empty() && !html.contains("No results") {
        return Err("the search page came back without results (DuckDuckGo may be refusing automated searches; a SearXNG address in config/web.json avoids that)".into());
    }
    Ok(hits)
}

#[derive(Serialize, Debug)]
pub struct Page {
    pub url: String,
    pub title: String,
    pub text: String,
    pub total: usize,
    pub start: usize,
}

/// A page's readable text, MAX_TEXT characters from `start` (characters, not bytes).
#[tauri::command]
pub fn web_fetch(url: String, start: Option<usize>) -> Result<Page, String> {
    check_allowed()?;
    let parsed = reqwest::Url::parse(url.trim()).map_err(|e| format!("not a web address: {e}"))?;
    public_url(&parsed)?;
    let (final_url, kind, body) = get_text(&parsed)?;
    let html = kind.contains("html") || kind.is_empty() && body.trim_start().starts_with('<');
    if !html && !kind.starts_with("text/") && !kind.contains("json") && !kind.contains("xml") {
        return Err(format!("not a text page ({kind}); PDFs and files are not read here"));
    }
    let (title, text) = if html { (html_title(&body), html_to_text(&body)) } else { (String::new(), body) };
    let chars: Vec<char> = text.chars().collect();
    let from = start.unwrap_or(0).min(chars.len());
    let to = (from + MAX_TEXT).min(chars.len());
    Ok(Page { url: final_url, title, text: chars[from..to].iter().collect(), total: chars.len(), start: from })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_hosts_are_refused() {
        for h in ["localhost", "127.0.0.1", "192.168.1.1", "10.0.0.5", "172.16.3.4", "169.254.1.1", "[::1]", "router", "nas.local", "100.64.0.1", "fd00::1"] {
            assert!(is_private_host(h), "{h}");
        }
        for h in ["example.com", "8.8.8.8", "en.wikipedia.org", "2606:4700::1111"] {
            assert!(!is_private_host(h), "{h}");
        }
        assert!(public_url(&reqwest::Url::parse("file:///c:/x").unwrap()).is_err());
        assert!(public_url(&reqwest::Url::parse("http://localhost:1234/v1").unwrap()).is_err());
    }

    #[test]
    fn requests_are_refused_until_the_switch_says_yes() {
        web_set_allowed(false);
        assert!(web_fetch("https://example.com".into(), None).unwrap_err().contains("switched off"));
        assert!(web_search("x".into(), None).unwrap_err().contains("switched off"));
    }

    #[test]
    fn html_becomes_readable_text() {
        let html = "<html><head><title>T &amp; U</title><style>p{}</style><script>alert(1)</script></head><body><nav>menu</nav><h1>Head</h1><p>One&nbsp;two &lt;b&gt;</p><!-- c --><ul><li>a</li><li>b</li></ul><footer>f</footer></body></html>";
        assert_eq!(html_title(html), "T & U");
        assert_eq!(html_to_text(html), "Head\nOne two <b>\na\nb");
    }

    #[test]
    fn duckduckgo_results_are_unwrapped_and_ads_skipped() {
        let html = r#"
<div class="result results_links"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Ad</a></div>
<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.rs%2Freqwest%2Flatest%2Freqwest%2Fredirect%2F&amp;rut=abc">reqwest::<b>redirect</b> - Rust</a></h2>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Redirect <b>policy</b> &amp; more.</a></div>"#;
        let hits = parse_duckduckgo(html, 8);
        assert_eq!(hits, vec![Hit { title: "reqwest::redirect - Rust".into(), url: "https://docs.rs/reqwest/latest/reqwest/redirect/".into(), snippet: "Redirect policy & more.".into() }]);
    }

    #[test]
    fn searxng_json_is_read() {
        let hits = parse_searxng(r#"{"results":[{"title":"A","url":"https://a.org","content":"x"},{"title":"bad","url":"javascript:1"}]}"#, 8).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://a.org");
    }
}
