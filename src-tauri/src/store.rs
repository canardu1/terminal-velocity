use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Host {
    pub id: String,
    pub name: String,
    pub hostname: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    /// "agent" | "key" | "password"
    #[serde(default = "default_auth")]
    pub auth_method: String,
    #[serde(default)]
    pub private_key_path: String,
    #[serde(default)]
    pub jump_host: String,
    #[serde(default)]
    pub extra_args: String,
    #[serde(default = "default_true")]
    pub keep_alive: bool,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub last_connected: Option<String>,
    /// Script eseguito automaticamente dopo il login (una riga = un comando).
    #[serde(default)]
    pub login_script: String,
    /// Port forwarding, una riga ciascuno: "L 8080:host:80" | "R 9090:host:90" | "D 1080"
    #[serde(default)]
    pub forwards: String,
    /// Tema terminale (vuoto = tema globale delle impostazioni)
    #[serde(default)]
    pub theme: String,
    /// Riconnessione automatica con backoff alla caduta della sessione
    #[serde(default)]
    pub auto_reconnect: bool,
    /// Usa mosh al posto di ssh (richiede mosh installato)
    #[serde(default)]
    pub mosh: bool,
    /// Port knocking prima della connessione: "7000,8000,9000"
    #[serde(default)]
    pub knock_ports: String,
}

fn default_port() -> u16 {
    22
}
fn default_auth() -> String {
    "agent".into()
}
fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub group: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub copy_on_select: bool,
    #[serde(default)]
    pub right_click_paste: bool,
    #[serde(default)]
    pub log_sessions: bool,
    #[serde(default)]
    pub notify_disconnect: bool,
    #[serde(default)]
    pub lock_on_start: bool,
    /// Minuti di inattività prima dell'auto-lock (0 = mai)
    #[serde(default)]
    pub lock_timeout_min: u32,
    /// Dimensione font del terminale
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    /// Luminosità fosforo: 1 standard, 2 luminosa, 3 massima
    #[serde(default = "default_brightness")]
    pub brightness: u8,
    /// Tema per gruppo: {"produzione": "red", ...}
    #[serde(default)]
    pub group_themes: std::collections::HashMap<String, String>,
}

fn default_font_size() -> u32 {
    13
}
fn default_brightness() -> u8 {
    2
}

fn default_theme() -> String {
    "termilal".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            copy_on_select: true,
            right_click_paste: false,
            log_sessions: false,
            notify_disconnect: true,
            lock_on_start: false,
            lock_timeout_min: 0,
            font_size: default_font_size(),
            brightness: default_brightness(),
            group_themes: Default::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct StoreData {
    #[serde(default)]
    pub hosts: Vec<Host>,
    #[serde(default)]
    pub snippets: Vec<Snippet>,
    #[serde(default)]
    pub settings: Settings,
    /// Ordinamento manuale degli host (lista di id)
    #[serde(default)]
    pub host_order: Vec<String>,
}

pub fn data_dir() -> PathBuf {
    directories::ProjectDirs::from("com", "termilal", "Termilal")
        .map(|d| d.data_dir().to_path_buf())
        .unwrap_or_else(|| dirs_home().join("Library/Application Support/Termilal"))
}

pub fn logs_dir() -> PathBuf {
    data_dir().join("logs")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn store_path() -> PathBuf {
    data_dir().join("store.json")
}

pub fn load() -> StoreData {
    let Ok(text) = fs::read_to_string(store_path()) else {
        return StoreData::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// Salva ruotando fino a 3 backup (store.json.bak1..3) per undo.
pub fn save(data: &StoreData) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = store_path();
    if path.exists() {
        let _ = fs::rename(dir.join("store.json.bak2"), dir.join("store.json.bak3"));
        let _ = fs::rename(dir.join("store.json.bak1"), dir.join("store.json.bak2"));
        let _ = fs::copy(&path, dir.join("store.json.bak1"));
    }
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

/// Ripristina l'ultimo backup. Restituisce lo store ripristinato.
pub fn restore_backup() -> Result<StoreData, String> {
    let dir = data_dir();
    let bak = dir.join("store.json.bak1");
    let text = fs::read_to_string(&bak)
        .map_err(|e| format!("nessun backup disponibile: {e}"))?;
    let data: StoreData = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    // Salva lo stato corrente come backup prima di sovrascrivere
    let _ = fs::copy(store_path(), dir.join("store.json.bak1"));
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(store_path(), json).map_err(|e| e.to_string())?;
    Ok(data)
}

// --- Keychain (via /usr/bin/security — niente prompt per-binario) ---

const KC_SERVICE: &str = "com.termilal.ssh";

fn security_cmd(args: &[&str]) -> std::io::Result<std::process::Output> {
    std::process::Command::new("/usr/bin/security").args(args).output()
}

pub fn keychain_set(account: &str, password: &str) -> Result<(), String> {
    // -U aggiorna se esiste già
    let out = security_cmd(&[
        "add-generic-password",
        "-U",
        "-s", KC_SERVICE,
        "-a", account,
        "-w", password,
    ])
    .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "security: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

pub fn keychain_get(account: &str) -> Option<String> {
    let out = security_cmd(&[
        "find-generic-password",
        "-s", KC_SERVICE,
        "-a", account,
        "-w",
    ])
    .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string())
}

pub fn keychain_delete(account: &str) {
    let _ = security_cmd(&[
        "delete-generic-password",
        "-s", KC_SERVICE,
        "-a", account,
    ]);
}
