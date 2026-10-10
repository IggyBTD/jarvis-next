use serde::Deserialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::Emitter;

#[derive(Deserialize)]
struct Node {
    #[serde(rename = "Text")]
    text: String,
    #[serde(rename = "Value")]
    value: Option<String>,
    #[serde(rename = "SensorId")]
    sensor_id: Option<String>,
    #[serde(rename = "RawValue")]
    raw_value: Option<String>,
    #[serde(rename = "Children", default)]
    children: Vec<Node>,
}

#[derive(Clone)]
pub struct TelemetryClient {
    client: reqwest::blocking::Client,
    url: String,
}

impl TelemetryClient {
    pub fn new() -> Self {
        let url = std::env::var("LHM_URL").unwrap_or_else(|_| "http://localhost:8085".into());
        Self {
            client: reqwest::blocking::Client::new(),
            url,
        }
    }

    fn fetch(&self) -> Result<Node, Box<dyn std::error::Error>> {
        let resp = self.client.get(format!("{}/data.json", self.url)).send()?.text()?;
        Ok(serde_json::from_str(&resp)?)
    }
}

/// Speed the DIMMs are running at (MT/s, what the BIOS configured: EXPO/XMP or
/// JEDEC). LibreHardwareMonitor has no sensor for it: its SPD tCKAVGmin timings
/// describe the module's slowest JEDEC profile (0.416 ns = DDR5-4800), not the
/// running speed. Windows reports the configured clock, so ask it once.
fn configured_memory_mts() -> Option<f64> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_PhysicalMemory | ForEach-Object { $_.ConfiguredClockSpeed }",
            ])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .ok()?;
        parse_configured_speed(&String::from_utf8_lossy(&out.stdout))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn parse_configured_speed(output: &str) -> Option<f64> {
    output
        .lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .filter(|speed| *speed > 0.0)
        .reduce(f64::max)
}

pub struct TelemetryState(pub std::sync::Arc<std::sync::Mutex<Option<TelemetryClient>>>);

#[tauri::command]
pub fn start_telemetry(state: tauri::State<'_, TelemetryState>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let client = TelemetryClient::new();
    let mut active_client = state.0.lock().map_err(|_| "telemetry state lock poisoned")?;
    if active_client.is_some() {
        return Ok(());
    }
    *active_client = Some(client.clone());
    drop(active_client);

    // 0 = not known (yet); the HUD shows N/A until the query returns.
    let memory_mts = Arc::new(AtomicU32::new(0));
    {
        let memory_mts = Arc::clone(&memory_mts);
        std::thread::spawn(move || {
            if let Some(mts) = configured_memory_mts() {
                memory_mts.store(mts as u32, Ordering::Relaxed);
            } else {
                log::warn!("could not read the configured memory speed");
            }
        });
    }

    std::thread::spawn(move || loop {
        let data = match client.fetch() {
            Ok(d) => d,
            Err(e) => {
                log::warn!("LHM fetch failed: {}", e);
                std::thread::sleep(std::time::Duration::from_secs(2));
                continue;
            }
        };

        let mut payload = build_payload(&data);
        let mts = memory_mts.load(Ordering::Relaxed);
        if mts > 0 {
            payload["Memory_Frequency"] = serde_json::Value::from(f64::from(mts));
        }
        if let Err(e) = app_handle.emit("telemetry-update", &payload) {
            log::warn!("emit failed: {}", e);
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    });

    Ok(())
}

fn parse_num(s: &str) -> Option<f64> {
    let s = s.trim();
    for unit in ["%", "°C", " GB", " MB", " MHz", " W", " V", " Hz", " ns"] {
        if let Some(stripped) = s.strip_suffix(unit) {
            return stripped.trim().parse::<f64>().ok();
        }
    }
    s.parse::<f64>().ok()
}

fn build_payload(root: &Node) -> serde_json::Value {
    let mut p = serde_json::Map::new();
    collect(root, &mut p);

    let upload = p.get("Network_Upload_Bps").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
    let download = p.get("Network_Download_Bps").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
    p.insert("Network_Speed_Bps".into(), serde_json::Value::from(upload + download));

    let memory_used = p.get("Memory_Usage").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
    let memory_available = p.get("Memory_Available").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
    if memory_used + memory_available > 0.0 {
        p.insert("Memory_Total".into(), serde_json::Value::from(memory_used + memory_available));
    }
    serde_json::Value::Object(p)
}

fn collect(node: &Node, p: &mut serde_json::Map<String, serde_json::Value>) {
    let t = node.text.to_lowercase();
    if let Some(v) = &node.value {
        let val = parse_num(v);
        let sensor_id = node.sensor_id.as_deref().unwrap_or_default();
        match t.as_str() {
            "cpu total" => { p.insert("CPU_Load".into(), serde_json::Value::from(val.unwrap_or(0.0))); }
            "core (tctl/tdie)" => { p.insert("CPU_Temperature".into(), serde_json::Value::from(val.unwrap_or(0.0))); }
            "memory used" if sensor_id.starts_with("/ram/") => {
                p.insert("Memory_Usage".into(), serde_json::Value::from(val.unwrap_or(0.0)));
            }
            "memory available" if sensor_id.starts_with("/ram/") => {
                p.insert("Memory_Available".into(), serde_json::Value::from(val.unwrap_or(0.0)));
            }
            _ => {}
        }
        // Cores: "CPU Core #1" .. "CPU Core #8"
        if let Some(n) = t.strip_prefix("cpu core #") {
            if let Ok(core_number) = n.parse::<usize>() {
                if let Some(index) = core_number.checked_sub(1) {
                    p.insert(format!("CPU_Core_{}_Load", index), serde_json::Value::from(val.unwrap_or(0.0)));
                }
            }
        }

        // LibreHardwareMonitor sensor IDs are stable across language/localisation
        // changes, unlike display labels. Prefer the primary NVMe drive when
        // available, but keep sensible fallbacks for other PCs.
        let insert_if_absent = |key: &str, p: &mut serde_json::Map<String, serde_json::Value>| {
            p.entry(key).or_insert_with(|| serde_json::Value::from(val.unwrap_or(0.0)));
        };

        if sensor_id.starts_with("/ram/") && t == "memory used" {
            p.insert("Memory_Usage".into(), serde_json::Value::from(val.unwrap_or(0.0)));
        }
        // A live DIMM clock sensor, if a LibreHardwareMonitor version ever
        // exposes one. The SPD tCKAVGmin timing is NOT used: it is the module's
        // JEDEC baseline (DDR5-4800), which reads wrong once EXPO/XMP is on.
        if sensor_id.contains("/memory/") && sensor_id.contains("/clock/") && t.contains("clock") {
            insert_if_absent("Memory_Frequency", p);
        }
        if sensor_id.starts_with("/nvme/") {
            match t.as_str() {
                "free space" => p.insert("Storage_Free_Space".into(), serde_json::Value::from(val.unwrap_or(0.0))),
                "total space" => p.insert("Storage_Total_Space".into(), serde_json::Value::from(val.unwrap_or(0.0))),
                "composite temperature" => p.insert("Storage_Temperature".into(), serde_json::Value::from(val.unwrap_or(0.0))),
                _ => None,
            };
        } else if sensor_id.starts_with("/ssd/") {
            match t.as_str() {
                "free space" => insert_if_absent("Storage_Free_Space", p),
                "total space" => insert_if_absent("Storage_Total_Space", p),
                "temperature" => insert_if_absent("Storage_Temperature", p),
                _ => {},
            }
        }
        if sensor_id.starts_with("/gpu-") {
            match t.as_str() {
                "gpu memory used" => {
                    let value_in_gb = value_in_gigabytes(v, val);
                    p.insert("GPU_VRAM_Usage".into(), serde_json::Value::from(value_in_gb));
                }
                "gpu memory total" => {
                    p.insert("GPU_VRAM_Total".into(), serde_json::Value::from(value_in_gigabytes(v, val)));
                }
                "gpu core" if sensor_id.contains("/load/") => {
                    p.insert("GPU_Compute_Load".into(), serde_json::Value::from(val.unwrap_or(0.0)));
                }
                "d3d compute 0" | "d3d compute 1" => {
                    insert_if_absent("GPU_Compute_Load", p);
                }
                "gpu core" if sensor_id.contains("/temperature/") => {
                    p.insert("GPU_Temperature".into(), serde_json::Value::from(val.unwrap_or(0.0)));
                }
                _ => {},
            }
        }
        if sensor_id.starts_with("/nic/") {
            let bytes_per_second = node.raw_value.as_deref().and_then(parse_bytes_per_second).unwrap_or(0.0);
            let key = match t.as_str() {
                "upload speed" => Some("Network_Upload_Bps"),
                "download speed" => Some("Network_Download_Bps"),
                _ => None,
            };
            if let Some(key) = key {
                let current = p.get(key).and_then(serde_json::Value::as_f64).unwrap_or(0.0);
                // Multiple adapters are normal. The active adapter has the
                // highest rate, so avoid adding duplicated zero/idle adapters.
                if bytes_per_second > current {
                    p.insert(key.into(), serde_json::Value::from(bytes_per_second));
                }
            }
        }
    }
    for c in &node.children {
        collect(c, p);
    }
}

fn parse_bytes_per_second(value: &str) -> Option<f64> {
    value.trim().strip_suffix(" B/s")?.trim().parse::<f64>().ok()
}

fn value_in_gigabytes(raw_value: &str, value: Option<f64>) -> f64 {
    let value = value.unwrap_or(0.0);
    if raw_value.to_lowercase().contains("mb") {
        value / 1024.0
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sensor(text: &str, value: &str, sensor_id: &str, raw_value: Option<&str>) -> Node {
        Node {
            text: text.into(),
            value: Some(value.into()),
            sensor_id: Some(sensor_id.into()),
            raw_value: raw_value.map(str::to_owned),
            children: vec![],
        }
    }

    #[test]
    fn maps_every_hud_metric_from_lhm_sensors() {
        let root = Node {
            text: "Sensor".into(), value: None, sensor_id: None, raw_value: None,
            children: vec![
                sensor("CPU Total", "25.0 %", "/amdcpu/0/load/0", None),
                sensor("Core (Tctl/Tdie)", "60.0 °C", "/amdcpu/0/temperature/2", None),
                sensor("CPU Core #1", "30.0 %", "/amdcpu/0/load/2", None),
                sensor("Memory Used", "12.0 GB", "/ram/data/0", None),
                sensor("Memory Available", "20.0 GB", "/ram/data/1", None),
                sensor("tCKAVGmin (Minimum Cycle Time)", "0.400 ns", "/memory/dimm/1/timing/20", None),
                sensor("Free Space", "200.0 GB", "/nvme/0/data/31", None),
                sensor("Total Space", "1000.0 GB", "/nvme/0/data/32", None),
                sensor("Composite Temperature", "40.0 °C", "/nvme/0/temperature/0", None),
                sensor("GPU Memory Used", "2048.0 MB", "/gpu-amd/5/smalldata/0", None),
                sensor("GPU Memory Total", "16384.0 MB", "/gpu-amd/5/smalldata/2", None),
                sensor("GPU Core", "55.0 %", "/gpu-amd/5/load/0", None),
                sensor("GPU Core", "65.0 °C", "/gpu-amd/5/temperature/0", None),
                sensor("Upload Speed", "1.0 KB/s", "/nic/example/throughput/7", Some("1024 B/s")),
                sensor("Download Speed", "2.0 KB/s", "/nic/example/throughput/8", Some("2048 B/s")),
            ],
        };

        let payload = build_payload(&root);
        assert_eq!(payload["CPU_Load"], 25.0);
        assert_eq!(payload["CPU_Temperature"], 60.0);
        assert_eq!(payload["CPU_Core_0_Load"], 30.0);
        assert_eq!(payload["Memory_Total"], 32.0);
        // SPD timings are the JEDEC baseline, not the running speed.
        assert!(payload.get("Memory_Frequency").is_none());
        assert_eq!(payload["Storage_Free_Space"], 200.0);
        assert_eq!(payload["GPU_VRAM_Usage"], 2.0);
        assert_eq!(payload["GPU_VRAM_Total"], 16.0);
        assert_eq!(payload["GPU_Compute_Load"], 55.0);
        assert_eq!(payload["GPU_Temperature"], 65.0);
        assert_eq!(payload["Network_Speed_Bps"], 3072.0);
    }

    #[test]
    fn configured_memory_speed_takes_the_fastest_dimm() {
        assert_eq!(parse_configured_speed("6000
6000
"), Some(6000.0));
        assert_eq!(parse_configured_speed("4800
6000
"), Some(6000.0));
        assert_eq!(parse_configured_speed(""), None);
        assert_eq!(parse_configured_speed("0
"), None);
    }
}
