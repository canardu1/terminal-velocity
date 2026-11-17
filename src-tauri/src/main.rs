mod importer;
mod ops;
mod pty;
mod store;

use ops::{new_tunnels, Tunnels};
use pty::{new_sessions, Sessions};
use store::{Host, Settings, Snippet, StoreData};
use tauri::State;

// --- Store commands ---

#[tauri::command]
fn get_store() -> StoreData {
    store::load()
}

#[tauri::command]
fn save_host(host: Host, password: Option<String>) -> Result<(), String> {
    let mut data = store::load();
    if let Some(idx) = data.hosts.iter().position(|h| h.id == host.id) {
        data.hosts[idx] = host.clone();
    } else {
        data.hosts.push(host.clone());
    }
    store::save(&data)?;
    // La password in Keychain dopo il salvataggio: l'host resta salvato
    // anche se il Keychain fallisce (es. prompt annullato).
    if let Some(pwd) = &password {
        store::keychain_set(&host.id, pwd)?;
    }
    Ok(())
}

#[tauri::command]
fn delete_host(id: String) -> Result<(), String> {
    let mut data = store::load();
    data.hosts.retain(|h| h.id != id);
    data.host_order.retain(|x| x != &id);
    store::save(&data)?;
    store::keychain_delete(&id);
    Ok(())
}

#[tauri::command]
fn save_snippet(snippet: Snippet) -> Result<(), String> {
    let mut data = store::load();
    if let Some(idx) = data.snippets.iter().position(|s| s.id == snippet.id) {
        data.snippets[idx] = snippet;
    } else {
        data.snippets.push(snippet);
    }
    store::save(&data)
}

#[tauri::command]
fn delete_snippet(id: String) -> Result<(), String> {
    let mut data = store::load();
    data.snippets.retain(|s| s.id != id);
    store::save(&data)
}

#[tauri::command]
fn save_password(host_id: String, password: String) -> Result<(), String> {
    store::keychain_set(&host_id, &password)
}

#[tauri::command]
fn delete_password(host_id: String) {
    store::keychain_delete(&host_id)
}

#[tauri::command]
fn has_password(host_id: String) -> bool {
    store::keychain_get(&host_id).is_some()
}

#[tauri::command]
fn save_settings(settings: Settings) -> Result<(), String> {
    let mut data = store::load();
    data.settings = settings;
    store::save(&data)
}

#[tauri::command]
fn save_host_order(order: Vec<String>) -> Result<(), String> {
    let mut data = store::load();
    data.host_order = order;
    store::save(&data)
}

#[tauri::command]
fn restore_backup() -> Result<StoreData, String> {
    store::restore_backup()
}

// --- Import/Export ---

#[tauri::command]
fn import_ssh_config() -> Result<(u32, u32), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let path = format!("{home}/.ssh/config");
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let hosts = importer::parse_ssh_config(&text);
    let total = hosts.len() as u32;

    let mut data = store::load();
    let mut added = 0u32;
    for h in hosts {
        let dup = data
            .hosts
            .iter()
            .any(|e| e.hostname == h.hostname && e.username == h.username && e.port == h.port);
        if !dup {
            data.hosts.push(h);
            added += 1;
        }
    }
    store::save(&data)?;
    Ok((total, added))
}

#[tauri::command]
fn import_known_hosts() -> Result<u32, String> {
    let names = ops::known_hosts_hosts();
    let mut data = store::load();
    let mut added = 0u32;
    for name in names {
        let dup = data.hosts.iter().any(|e| e.hostname == name);
        if !dup {
            data.hosts.push(Host {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.clone(),
                hostname: name,
                port: 22,
                username: String::new(),
                auth_method: "agent".into(),
                private_key_path: String::new(),
                jump_host: String::new(),
                extra_args: String::new(),
                keep_alive: true,
                group: "known-hosts".into(),
                tags: vec![],
                notes: "Importato da ~/.ssh/known_hosts".into(),
                favorite: false,
                last_connected: None,
                login_script: String::new(),
                forwards: String::new(),
                theme: String::new(),
                auto_reconnect: false,
                mosh: false,
                knock_ports: String::new(),
            });
            added += 1;
        }
    }
    store::save(&data)?;
    Ok(added)
}

#[tauri::command]
fn import_csv(path: String) -> Result<u32, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let hosts = importer::parse_csv(&text);
    let mut data = store::load();
    let mut added = 0u32;
    for h in hosts {
        let dup = data
            .hosts
            .iter()
            .any(|e| e.hostname == h.hostname && e.username == h.username && e.port == h.port);
        if !dup {
            data.hosts.push(h);
            added += 1;
        }
    }
    store::save(&data)?;
    Ok(added)
}

#[tauri::command]
fn export_json(path: String) -> Result<(), String> {
    let data = store::load();
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_json(path: String) -> Result<(u32, u32), String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let incoming: StoreData = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut data = store::load();
    let mut added_hosts = 0u32;
    let mut added_snippets = 0u32;
    for h in incoming.hosts {
        let dup = data
            .hosts
            .iter()
            .any(|e| e.hostname == h.hostname && e.username == h.username && e.port == h.port);
        if !dup {
            data.hosts.push(h);
            added_hosts += 1;
        }
    }
    for s in incoming.snippets {
        let dup = data
            .snippets
            .iter()
            .any(|e| e.title == s.title && e.command == s.command);
        if !dup {
            data.snippets.push(s);
            added_snippets += 1;
        }
    }
    store::save(&data)?;
    Ok((added_hosts, added_snippets))
}

// --- SSH config editor ---

#[tauri::command]
fn read_ssh_config() -> Result<String, String> {
    ops::read_ssh_config()
}

#[tauri::command]
fn write_ssh_config(text: String) -> Result<(), String> {
    ops::write_ssh_config(&text)
}

// --- Stato host / notifiche / auth ---

#[tauri::command]
fn check_host(hostname: String, port: u16) -> bool {
    ops::check_host(&hostname, port)
}

#[tauri::command]
fn send_notification(title: String, body: String) {
    ops::notify(&title, &body)
}

#[tauri::command]
fn touch_id_auth() -> Result<bool, String> {
    ops::authenticate()
}

#[tauri::command]
fn frontend_log(msg: String) {
    let dir = pty::logs_dir_path();
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("frontend.log"))
    {
        use std::io::Write;
        let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
    }
}

#[tauri::command]
fn open_logs_dir() -> Result<(), String> {
    let dir = pty::logs_dir_path();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- SFTP ---

#[tauri::command]
fn sftp_ls(host: Host, path: String) -> Result<Vec<ops::RemoteEntry>, String> {
    ops::sftp_ls(&host, &path)
}

#[tauri::command]
fn sftp_pwd(host: Host) -> Result<String, String> {
    ops::sftp_pwd(&host)
}

#[tauri::command]
fn sftp_get(host: Host, remote: String, local: String) -> Result<(), String> {
    ops::sftp_get(&host, &remote, &local)
}

#[tauri::command]
fn sftp_put(host: Host, local: String, remote: String) -> Result<(), String> {
    ops::sftp_put(&host, &local, &remote)
}

#[tauri::command]
fn sftp_mkdir(host: Host, path: String) -> Result<(), String> {
    ops::sftp_mkdir(&host, &path)
}

#[tauri::command]
fn sftp_rm(host: Host, path: String, is_dir: bool) -> Result<(), String> {
    ops::sftp_rm(&host, &path, is_dir)
}

// --- Server/Plesk ops ---

#[tauri::command]
fn server_health(host: Host) -> Result<ops::Health, String> {
    ops::server_health(&host)
}

#[tauri::command]
fn service_list(host: Host) -> Result<Vec<ops::ServiceStatus>, String> {
    ops::service_list(&host)
}

#[tauri::command]
fn service_restart(host: Host, name: String) -> Result<String, String> {
    ops::service_restart(&host, &name)
}

#[tauri::command]
fn fail2ban_status(host: Host) -> Result<Vec<ops::BannedIp>, String> {
    ops::fail2ban_status(&host)
}

#[tauri::command]
fn fail2ban_unban(host: Host, ip: String) -> Result<String, String> {
    ops::fail2ban_unban(&host, &ip)
}

#[tauri::command]
fn plesk_domains(host: Host) -> Result<Vec<ops::PleskDomain>, String> {
    ops::plesk_domains(&host)
}

#[tauri::command]
fn read_log(host: Host, path: String, lines: u32) -> Result<String, String> {
    ops::read_log(&host, &path, lines)
}

#[tauri::command]
fn test_host(host: Host) -> ops::TestResult {
    ops::test_host(&host)
}

#[tauri::command]
fn ping_ms(hostname: String, port: u16) -> Option<u64> {
    ops::ping_ms(&hostname, port)
}

#[tauri::command]
fn server_power(host: Host, action: String) -> Result<String, String> {
    ops::server_power(&host, &action)
}

#[tauri::command]
fn plesk_service_plans(host: Host) -> Result<Vec<String>, String> {
    ops::plesk_service_plans(&host)
}

#[tauri::command]
fn plesk_create_domain(
    host: Host,
    domain: String,
    plan: String,
    login: String,
    passwd: String,
) -> Result<String, String> {
    ops::plesk_create_domain(&host, &domain, &plan, &login, &passwd)
}

#[tauri::command]
fn plesk_ssl(host: Host, domain: String, email: String) -> Result<String, String> {
    ops::plesk_ssl(&host, &domain, &email)
}

#[tauri::command]
fn wp_instances(host: Host) -> Result<Vec<ops::WpInstance>, String> {
    ops::wp_instances(&host)
}

#[tauri::command]
fn wp_update(host: Host, id: String) -> Result<String, String> {
    ops::wp_update(&host, &id)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    ops::open_url(&url)
}

#[tauri::command]
fn known_hosts_list() -> Vec<ops::KhEntry> {
    ops::known_hosts_list()
}

#[tauri::command]
fn known_hosts_delete(pattern: String) -> Result<String, String> {
    ops::known_hosts_delete(&pattern)
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    ops::write_text_file(&path, &contents)
}

// --- Tunnel ---

#[tauri::command]
fn tunnel_start(tunnels: State<'_, Tunnels>, host: Host) -> Result<String, String> {
    ops::tunnel_start(&tunnels.inner(), &host)
}

#[tauri::command]
fn tunnel_stop(tunnels: State<'_, Tunnels>, id: String) -> Result<(), String> {
    ops::tunnel_stop(&tunnels.inner(), &id)
}

#[tauri::command]
fn tunnel_alive(tunnels: State<'_, Tunnels>) -> Vec<String> {
    ops::tunnel_alive(&tunnels.inner())
}

// --- PTY ---

#[tauri::command]
fn pty_start(
    app: tauri::AppHandle,
    sessions: State<'_, Sessions>,
    session_id: Option<String>,
    host: Host,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    // Segna last_connected + leggi impostazione log
    let log = {
        let mut data = store::load();
        let log = data.settings.log_sessions;
        if let Some(h) = data.hosts.iter_mut().find(|h| h.id == host.id) {
            h.last_connected = Some(chrono::Utc::now().to_rfc3339());
            let _ = store::save(&data);
        }
        log
    };
    pty::start(app, sessions.inner().clone(), host, cols, rows, log, session_id)
}

#[tauri::command]
fn pty_write(sessions: State<'_, Sessions>, id: String, data: String) -> Result<(), String> {
    pty::write(&sessions.inner(), &id, data.as_bytes())
}

#[tauri::command]
fn pty_write_bytes(sessions: State<'_, Sessions>, id: String, data: Vec<u8>) -> Result<(), String> {
    pty::write(&sessions.inner(), &id, &data)
}

#[tauri::command]
fn pty_resize(sessions: State<'_, Sessions>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize(&sessions.inner(), &id, cols, rows)
}

#[tauri::command]
fn pty_close(sessions: State<'_, Sessions>, id: String) -> Result<(), String> {
    pty::close(&sessions.inner(), &id)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(new_sessions())
        .manage(new_tunnels())
        .invoke_handler(tauri::generate_handler![
            get_store,
            save_host,
            delete_host,
            save_snippet,
            delete_snippet,
            save_password,
            delete_password,
            has_password,
            save_settings,
            save_host_order,
            restore_backup,
            import_ssh_config,
            import_known_hosts,
            import_csv,
            import_json,
            export_json,
            read_ssh_config,
            write_ssh_config,
            check_host,
            send_notification,
            touch_id_auth,
            frontend_log,
            open_logs_dir,
            sftp_ls,
            sftp_pwd,
            sftp_get,
            sftp_put,
            sftp_mkdir,
            sftp_rm,
            server_health,
            service_list,
            service_restart,
            fail2ban_status,
            fail2ban_unban,
            plesk_domains,
            read_log,
            test_host,
            ping_ms,
            server_power,
            plesk_service_plans,
            plesk_create_domain,
            plesk_ssl,
            wp_instances,
            wp_update,
            open_url,
            known_hosts_list,
            known_hosts_delete,
            write_text_file,
            tunnel_start,
            tunnel_stop,
            tunnel_alive,
            pty_start,
            pty_write,
            pty_write_bytes,
            pty_resize,
            pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("errore avvio Termilal");
}
