use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::pty;
use crate::store::{self, Host};

// --- Notifiche macOS ---

pub fn notify(title: &str, body: &str) {
    let t = title.replace('\\', "\\\\").replace('"', "\\\"");
    let b = body.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("display notification \"{b}\" with title \"{t}\" sound name \"Glass\"");
    let _ = Command::new("osascript").arg("-e").arg(script).output();
}

// --- Check raggiungibilità ---

/// TCP connect con timeout → host online/offline.
pub fn check_host(hostname: &str, port: u16) -> bool {
    let addr = format!("{hostname}:{port}");
    let Ok(mut it) = addr.to_socket_addrs() else {
        return false;
    };
    for sa in it.by_ref().take(2) {
        if TcpStream::connect_timeout(&sa, Duration::from_millis(1500)).is_ok() {
            return true;
        }
    }
    false
}

// --- SSH config read/write ---

fn ssh_config_path() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".ssh/config")
}

pub fn read_ssh_config() -> Result<String, String> {
    std::fs::read_to_string(ssh_config_path()).map_err(|e| e.to_string())
}

pub fn write_ssh_config(text: &str) -> Result<(), String> {
    let path = ssh_config_path();
    if let Ok(old) = std::fs::read_to_string(&path) {
        let _ = std::fs::write(path.with_extension("config.bak"), old);
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

// --- known_hosts ---

pub fn known_hosts_hosts() -> Vec<String> {
    let path = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".ssh/known_hosts");
    let Ok(text) = std::fs::read_to_string(path) else {
        return vec![];
    };
    let mut out = Vec::new();
    for line in text.lines() {
        let first = match line.split_whitespace().next() {
            Some(f) => f,
            None => continue,
        };
        if first.starts_with('|') || first.starts_with('#') {
            continue; // hashed o commento
        }
        for name in first.split(',') {
            let name = name.trim_matches(|c| c == '[' || c == ']');
            let name = name.split(':').next().unwrap_or(name);
            if !name.is_empty() && !out.iter().any(|x: &String| x == name) {
                out.push(name.to_string());
            }
        }
    }
    out
}

// --- Touch ID / autenticazione sistema ---

/// Esegue l'helper compilato (LAContext deviceOwnerAuthentication).
/// Restituisce Ok(true) se autenticato, Ok(false) se negato, Err se helper assente.
pub fn authenticate() -> Result<bool, String> {
    let bin = auth_helper_path().ok_or("helper termilal-auth non trovato")?;
    let out = Command::new(&bin)
        .output()
        .map_err(|e| format!("auth helper: {e}"))?;
    match out.status.code() {
        Some(0) => Ok(true),
        Some(2) => Err("Touch ID/password non disponibile su questo Mac".into()),
        _ => Ok(false),
    }
}

fn auth_helper_path() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for rel in ["../Resources/termilal-auth", "../Resources/resources/termilal-auth"] {
                let candidate = dir.join(rel);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/termilal-auth");
    if dev.exists() {
        Some(dev)
    } else {
        None
    }
}

// --- SFTP via `sftp -b` batch (stesso stack di ssh) ---

#[derive(serde::Serialize)]
pub struct RemoteEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_link: bool,
    pub size: u64,
    pub mtime: String,
}

/// Esegue `sftp -b -` coi comandi dati; restituisce stdout.
/// Errore se exit != 0 o stderr non vuoto (sftp batch è verbose su stderr solo in caso di problemi reali? No: sftp stampa "sftp>" prompt su stdout, errori su stderr).
fn sftp_run(host: &Host, batch: &str) -> Result<String, String> {
    let mut cmd = Command::new("sftp");
    cmd.arg("-b").arg("-");
    for a in pty::sftp_args(host) {
        cmd.arg(a);
    }
    let mut env_has_askpass = false;
    if store::keychain_get(&host.id).is_some() && host.auth_method != "agent" {
        cmd.env("SSH_ASKPASS", pty::askpass_path_pub());
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        cmd.env("TERMINAL_SECRET_ACCOUNT", &host.id);
        cmd.env("DISPLAY", "termilal:0");
        env_has_askpass = true;
    }
    let _ = env_has_askpass;
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn sftp: {e}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("stdin sftp mancante")?
        .write_all(batch.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() && !stderr.is_empty() {
        let last = stderr.lines().last().unwrap_or("errore sftp");
        return Err(last.trim().to_string());
    }
    Ok(stdout)
}

/// `ls -l <path>` → lista file remoti.
pub fn sftp_ls(host: &Host, path: &str) -> Result<Vec<RemoteEntry>, String> {
    let out = sftp_run(host, &format!("ls -l \"{}\"\n", path.replace('"', "\\\"")))?;
    let mut entries = Vec::new();
    for line in out.lines() {
        let line = line.trim_end();
        // Formato: drwxr-xr-x   2 user  group  4096 Nov 16 10:22 nome
        if line.starts_with("sftp>") || line.len() < 10 {
            continue;
        }
        let perm = &line[..10];
        let is_dir = perm.starts_with('d');
        let is_link = perm.starts_with('l');
        if !perm.starts_with(|c: char| c == 'd' || c == 'l' || c == '-') {
            continue;
        }
        // campi: perm links user group size month day time year|time name...
        let mut parts = line.split_whitespace();
        let _perm = parts.next();
        let _links = parts.next();
        let _user = parts.next();
        let _group = parts.next();
        let size: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let m1 = parts.next().unwrap_or("");
        let m2 = parts.next().unwrap_or("");
        let m3 = parts.next().unwrap_or("");
        let rest: Vec<&str> = parts.collect();
        let name = rest.join(" ");
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        entries.push(RemoteEntry {
            name: name.clone(),
            is_dir,
            is_link,
            size,
            mtime: format!("{m1} {m2} {m3}"),
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

/// Home remota → pwd via sftp.
pub fn sftp_pwd(host: &Host) -> Result<String, String> {
    let out = sftp_run(host, "pwd\n")?;
    Ok(out
        .lines()
        .map(|l| l.trim().trim_start_matches("sftp>").trim())
        .find(|l| l.starts_with('/'))
        .unwrap_or("/")
        .to_string())
}

pub fn sftp_get(host: &Host, remote: &str, local: &str) -> Result<(), String> {
    sftp_run(
        host,
        &format!(
            "get \"{}\" \"{}\"\n",
            remote.replace('"', "\\\""),
            local.replace('"', "\\\"")
        ),
    )
    .map(|_| ())
}

pub fn sftp_put(host: &Host, local: &str, remote: &str) -> Result<(), String> {
    sftp_run(
        host,
        &format!(
            "put \"{}\" \"{}\"\n",
            local.replace('"', "\\\""),
            remote.replace('"', "\\\"")
        ),
    )
    .map(|_| ())
}

pub fn sftp_mkdir(host: &Host, path: &str) -> Result<(), String> {
    sftp_run(host, &format!("mkdir \"{}\"\n", path.replace('"', "\\\""))).map(|_| ())
}

pub fn sftp_rm(host: &Host, path: &str, is_dir: bool) -> Result<(), String> {
    let cmd = if is_dir { "rmdir" } else { "rm" };
    sftp_run(host, &format!("{cmd} \"{}\"\n", path.replace('"', "\\\""))).map(|_| ())
}

// --- Server ops via SSH one-shot ---

/// Esegue uno script bash sul server via ssh non-interattivo.
/// Restituisce stdout; errore se exit != 0 o timeout.
pub fn ssh_exec(host: &Host, script: &str, timeout_secs: u64) -> Result<String, String> {
    let mut args = pty::ssh_args_for(host);
    let host_arg = args.pop(); // l'hostname è l'ultimo argomento
    let mut cmd = Command::new("/usr/bin/ssh");
    cmd.args(&args)
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg("ConnectTimeout=10");
    if let Some(h) = host_arg {
        cmd.arg(h);
    }
    cmd.arg("sh -s"); // script via stdin → indipendente dalla login shell remota
    if store::keychain_get(&host.id).is_some() && host.auth_method != "agent" {
        cmd.env("SSH_ASKPASS", pty::askpass_path_pub());
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        cmd.env("TERMINAL_SECRET_ACCOUNT", &host.id);
        cmd.env("DISPLAY", "termilal:0");
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn ssh: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(script.as_bytes());
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let mut out = String::new();
                let mut err = String::new();
                if let Some(mut o) = child.stdout.take() {
                    use std::io::Read;
                    let _ = o.read_to_string(&mut out);
                }
                if let Some(mut e) = child.stderr.take() {
                    use std::io::Read;
                    let _ = e.read_to_string(&mut err);
                }
                if out.is_empty() && !err.is_empty() {
                    return Err(err.trim().lines().last().unwrap_or("errore ssh").to_string());
                }
                return Ok(out);
            }
            Ok(None) => {
                if std::time::Instant::now() > deadline {
                    let _ = child.kill();
                    return Err("timeout comando remoto".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Quoting shell: racchiude in '…' con escaping delle virgolette singole.
fn shq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

fn sudo_or_direct(host: &Host, cmd: &str) -> String {
    // Se l'utente è root va diretto, altrimenti prova sudo non-interattivo.
    // Lo script (anche multi-comando) è racchiuso in sh -c per evitare rotture di sintassi.
    if host.username == "root" {
        cmd.to_string()
    } else {
        format!("sh -c {} 2>/dev/null || sudo -n sh -c {} 2>&1", shq(cmd), shq(cmd))
    }
}

#[derive(serde::Serialize)]
pub struct Health {
    pub hostname: String,
    pub uptime: String,
    pub load: [f64; 3],
    pub nproc: u32,
    pub mem_total_mb: u64,
    pub mem_used_mb: u64,
    pub mem_avail_mb: u64,
    pub disks: Vec<Disk>,
}

#[derive(serde::Serialize)]
pub struct Disk {
    pub mount: String,
    pub size: String,
    pub used_pct: u8,
    pub avail: String,
}

pub fn server_health(host: &Host) -> Result<Health, String> {
    let script = r#"echo "HOST=$(hostname)"; echo "NPROC=$(nproc 2>/dev/null || echo 1)"; echo "UP=$(uptime -p 2>/dev/null || uptime)"; echo "LOAD=$(cat /proc/loadavg 2>/dev/null)"; free -m 2>/dev/null | awk '/^Mem:/{print "MEM",$2,$3,$7}'; df -h -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | awk 'NR>1{print "DISK",$NF,$2,$5,$4}'"#;
    let out = ssh_exec(host, script, 15)?;
    let mut h = Health {
        hostname: "?".into(),
        uptime: String::new(),
        load: [0.0; 3],
        nproc: 1,
        mem_total_mb: 0,
        mem_used_mb: 0,
        mem_avail_mb: 0,
        disks: vec![],
    };
    for line in out.lines() {
        let l = line.trim();
        if let Some(v) = l.strip_prefix("HOST=") {
            h.hostname = v.trim().to_string();
        } else if let Some(v) = l.strip_prefix("NPROC=") {
            h.nproc = v.trim().parse().unwrap_or(1);
        } else if let Some(v) = l.strip_prefix("UP=") {
            h.uptime = v.trim().trim_start_matches("up ").to_string();
        } else if let Some(v) = l.strip_prefix("LOAD=") {
            let mut it = v.split_whitespace();
            for i in 0..3 {
                h.load[i] = it.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
            }
        } else if let Some(v) = l.strip_prefix("MEM ") {
            let mut it = v.split_whitespace();
            h.mem_total_mb = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            h.mem_used_mb = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            h.mem_avail_mb = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        } else if let Some(v) = l.strip_prefix("DISK ") {
            let mut it = v.rsplitn(4, ' ');
            let avail = it.next().unwrap_or("").to_string();
            let pct: u8 = it.next().unwrap_or("0").trim_end_matches('%').parse().unwrap_or(0);
            let size = it.next().unwrap_or("").to_string();
            let mount = it.next().unwrap_or("").to_string();
            h.disks.push(Disk { mount, size, used_pct: pct, avail });
        }
    }
    Ok(h)
}

#[derive(serde::Serialize)]
pub struct ServiceStatus {
    pub name: String,
    pub status: String, // active|inactive|failed|activating|...
}

pub fn service_list(host: &Host) -> Result<Vec<ServiceStatus>, String> {
    let script = r#"for s in $(systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null | awk '{print $1}' | sed 's/\.service//'); do case "$s" in nginx|apache*|httpd|maria*|mysql*|postgres*|php*fpm|php*-fpm|postfix|dovecot|named|bind*|fail2ban|sw-cp*|plesk*|vsftpd|proftpd|pure-ftpd|tomcat*|redis*|memcached|sshd|cron|crond|rsyslog) st=$(systemctl is-active "$s" 2>/dev/null); echo "$s|$st";; esac; done"#;
    let out = ssh_exec(host, script, 20)?;
    let mut services: Vec<ServiceStatus> = out
        .lines()
        .filter_map(|l| {
            let (name, status) = l.split_once('|')?;
            Some(ServiceStatus {
                name: name.trim().to_string(),
                status: status.trim().to_string(),
            })
        })
        .collect();
    services.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(services)
}

fn safe_name(s: &str) -> Result<&str, String> {
    if s.chars().all(|c| c.is_alphanumeric() || matches!(c, '@' | '.' | '_' | '-' | '*')) && !s.is_empty() {
        Ok(s)
    } else {
        Err("nome non valido".into())
    }
}

pub fn service_restart(host: &Host, name: &str) -> Result<String, String> {
    let name = safe_name(name)?;
    let cmd = format!("systemctl restart {name}");
    let script = sudo_or_direct(host, &cmd);
    let out = ssh_exec(host, &script, 20)?;
    Ok(if out.trim().is_empty() { "riavviato".into() } else { out.trim().to_string() })
}

#[derive(serde::Serialize)]
pub struct BannedIp {
    pub jail: String,
    pub ip: String,
}

pub fn fail2ban_status(host: &Host) -> Result<Vec<BannedIp>, String> {
    let inner = r#"for j in $(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list://p' | tr -d ' \t' | tr ',' '\n'); do fail2ban-client status "$j" 2>/dev/null | sed -n 's/.*Banned IP list://p' | tr -d ' \t' | tr ',' '\n' | sed "s/^/$j|/"; done | grep -v '^$|'"#;
    let script = sudo_or_direct(host, inner);
    let out = ssh_exec(host, &script, 20)?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let (jail, ip) = l.trim().split_once('|')?;
            if ip.is_empty() {
                None
            } else {
                Some(BannedIp { jail: jail.into(), ip: ip.into() })
            }
        })
        .collect())
}

pub fn fail2ban_unban(host: &Host, ip: &str) -> Result<String, String> {
    let ip = safe_name(ip)?;
    let inner = format!("fail2ban-client unban {ip}");
    let script = sudo_or_direct(host, &inner);
    let out = ssh_exec(host, &script, 15)?;
    Ok(if out.trim().is_empty() { format!("{ip} unbanned") } else { out.trim().to_string() })
}

#[derive(serde::Serialize)]
pub struct PleskDomain {
    pub name: String,
    pub status: String,
}

pub fn plesk_domains(host: &Host) -> Result<Vec<PleskDomain>, String> {
    let inner = r#"for d in $(plesk bin domain --list 2>/dev/null); do st=$(plesk bin domain --info "$d" 2>/dev/null | grep -iE "hosting status|domain status" | head -1 | sed 's/.*: *//'); echo "$d|${st:-attivo}"; done"#;
    let script = sudo_or_direct(host, inner);
    let out = ssh_exec(host, &script, 40)?;
    let mut domains: Vec<PleskDomain> = out
        .lines()
        .filter_map(|l| {
            let (name, status) = l.split_once('|')?;
            Some(PleskDomain {
                name: name.trim().to_string(),
                status: status.trim().to_string(),
            })
        })
        .collect();
    domains.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(domains)
}

fn safe_path(s: &str) -> Result<&str, String> {
    if s.chars().all(|c| c.is_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '*')) && s.starts_with('/') {
        Ok(s)
    } else {
        Err("path non valido".into())
    }
}

pub fn read_log(host: &Host, path: &str, lines: u32) -> Result<String, String> {
    let path = safe_path(path)?;
    let lines = lines.clamp(10, 2000);
    let inner = format!("tail -n {lines} '{path}'");
    let script = sudo_or_direct(host, &inner);
    ssh_exec(host, &script, 20)
}

#[derive(serde::Serialize)]
pub struct TestResult {
    pub tcp_ms: Option<u64>,
    pub ssh_ok: bool,
    pub message: String,
}

/// Test connessione dall'editor host: TCP + vero login ssh ("echo ok").
pub fn test_host(host: &Host) -> TestResult {
    let addr = format!("{}:{}", host.hostname, host.port);
    let t0 = std::time::Instant::now();
    let tcp_ms = addr
        .to_socket_addrs()
        .ok()
        .and_then(|mut it| it.next())
        .and_then(|sa| TcpStream::connect_timeout(&sa, Duration::from_millis(3000)).ok())
        .map(|_| t0.elapsed().as_millis() as u64);

    if tcp_ms.is_none() {
        return TestResult {
            tcp_ms: None,
            ssh_ok: false,
            message: "porta chiusa o irraggiungibile".into(),
        };
    }
    match ssh_exec(host, "echo __tv_ok__", 12) {
        Ok(out) if out.contains("__tv_ok__") => TestResult {
            tcp_ms,
            ssh_ok: true,
            message: "login OK".into(),
        },
        Ok(_) | Err(_) => TestResult {
            tcp_ms,
            ssh_ok: false,
            message: "TCP ok ma login ssh fallito (credenziali?)".into(),
        },
    }
}

/// Latenza TCP verso host:porta in ms.
pub fn ping_ms(hostname: &str, port: u16) -> Option<u64> {
    let addr = format!("{hostname}:{port}");
    let t0 = std::time::Instant::now();
    addr.to_socket_addrs()
        .ok()
        .and_then(|mut it| it.next())
        .and_then(|sa| TcpStream::connect_timeout(&sa, Duration::from_millis(2000)).ok())
        .map(|_| t0.elapsed().as_millis() as u64)
}

/// Riavvio/spegnimento remoto.
pub fn server_power(host: &Host, action: &str) -> Result<String, String> {
    let cmd = match action {
        "reboot" => "reboot".to_string(),
        "poweroff" => "poweroff".to_string(),
        _ => return Err("azione non valida".into()),
    };
    ssh_exec(host, &sudo_or_direct(host, &cmd), 15)
        .map(|o| if o.trim().is_empty() { "comando inviato".into() } else { o.trim().to_string() })
}

/// Piani di servizio Plesk (per il dropdown crea-dominio).
pub fn plesk_service_plans(host: &Host) -> Result<Vec<String>, String> {
    let script = sudo_or_direct(host, "plesk bin service_plan -l 2>/dev/null");
    let out = ssh_exec(host, &script, 20)?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.to_lowercase().starts_with("available") && !l.contains("---"))
        .collect())
}

/// Crea subscription/dominio Plesk con hosting + utente di sistema.
pub fn plesk_create_domain(
    host: &Host,
    domain: &str,
    plan: &str,
    login: &str,
    passwd: &str,
) -> Result<String, String> {
    for bad in [domain, plan, login] {
        if bad.chars().any(|c| !c.is_alphanumeric() && !matches!(c, '.' | '-' | '_' | ' ')) {
            return Err("caratteri non validi".into());
        }
    }
    if domain.is_empty() || login.is_empty() {
        return Err("dominio e login obbligatori".into());
    }
    if passwd.is_empty() || passwd.contains('\'') {
        return Err("password mancante o con apostrofo".into());
    }
    let plan_part = if plan.trim().is_empty() {
        String::new()
    } else {
        format!(" -service-plan {}", shq(plan.trim()))
    };
    let inner = format!(
        "plesk bin subscription --create {}{} -login {} -passwd {}",
        shq(domain),
        plan_part,
        shq(login),
        shq(passwd)
    );
    let script = sudo_or_direct(host, &inner);
    let out = ssh_exec(host, &script, 60)?;
    Ok(if out.trim().is_empty() { "dominio creato".into() } else { out.trim().to_string() })
}

/// Let's Encrypt: emetti/rinnova certificato per dominio.
pub fn plesk_ssl(host: &Host, domain: &str, email: &str) -> Result<String, String> {
    let domain = safe_name(domain)?;
    let mail_part = if email.trim().is_empty() {
        String::new()
    } else {
        format!(" -m {}", email.trim())
    };
    let inner = format!("plesk bin extension --exec letsencrypt cli.php -- -d {domain}{mail_part} 2>&1");
    let script = sudo_or_direct(host, &inner);
    let out = ssh_exec(host, &script, 90)?;
    Ok(if out.trim().is_empty() { "certificato emesso".into() } else { out.trim().to_string() })
}

#[derive(serde::Serialize)]
pub struct WpInstance {
    pub id: String,
    pub path: String,
    pub url: String,
    pub info: String,
}

/// Istanze WordPress (WP Toolkit).
pub fn wp_instances(host: &Host) -> Result<Vec<WpInstance>, String> {
    let inner = "plesk ext wp-toolkit --list 2>/dev/null";
    let script = sudo_or_direct(host, inner);
    let out = ssh_exec(host, &script, 30)?;
    let mut list = Vec::new();
    for line in out.lines() {
        let l = line.trim();
        if l.is_empty() || !l.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            continue;
        }
        // Formati tollerati: "id|path|url|..." o "id  /path  https://..."
        if l.contains('|') {
            let f: Vec<&str> = l.split('|').map(|x| x.trim()).collect();
            if f.len() >= 3 {
                list.push(WpInstance {
                    id: f[0].into(),
                    path: f[1].into(),
                    url: f[2].into(),
                    info: f.get(3).map(|s| s.to_string()).unwrap_or_default(),
                });
                continue;
            }
        }
        let toks: Vec<&str> = l.split_whitespace().collect();
        if toks.len() >= 3 && toks[1].starts_with('/') && toks[2].starts_with("http") {
            list.push(WpInstance {
                id: toks[0].into(),
                path: toks[1].into(),
                url: toks[2].into(),
                info: toks[3..].join(" "),
            });
        }
    }
    Ok(list)
}

/// Aggiorna core+plugin+temi di un'istanza WP.
pub fn wp_update(host: &Host, id: &str) -> Result<String, String> {
    let id = safe_name(id)?;
    let inner = format!(
        "plesk ext wp-toolkit --wp-cli -instance-id {id} core update 2>&1; plesk ext wp-toolkit --wp-cli -instance-id {id} plugin update --all 2>&1; plesk ext wp-toolkit --wp-cli -instance-id {id} theme update --all 2>&1"
    );
    let script = sudo_or_direct(host, &inner);
    ssh_exec(host, &script, 120).map(|o| o.trim().to_string())
}

/// Apre un URL nel browser di sistema.
pub fn open_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("URL non valido".into());
    }
    Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct KhEntry {
    pub host: String,
    pub algo: String,
    pub hashed: bool,
}

/// Voci di ~/.ssh/known_hosts.
pub fn known_hosts_list() -> Vec<KhEntry> {
    let path = dirs_home_path().join(".ssh/known_hosts");
    let Ok(text) = std::fs::read_to_string(path) else {
        return vec![];
    };
    text.lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let hosts = it.next()?;
            let algo = it.next().unwrap_or("");
            let hashed = hosts.starts_with('|');
            Some(KhEntry {
                host: if hashed { "(hashed)".into() } else { hosts.into() },
                algo: algo.into(),
                hashed,
            })
        })
        .collect()
}

pub fn known_hosts_delete(pattern: &str) -> Result<String, String> {
    let pattern = safe_name(pattern)?;
    let out = Command::new("/usr/bin/ssh-keygen")
        .arg("-R")
        .arg(pattern)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn dirs_home_path() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

/// Scrive testo su file scelto dall'utente (export sessione).
pub fn write_text_file(path: &str, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

// --- Tunnel standalone (ssh -N con -L/-R) ---

use std::collections::HashMap;
use std::process::Child;
use std::sync::{Arc, Mutex};

pub type Tunnels = Arc<Mutex<HashMap<String, Child>>>;

pub fn new_tunnels() -> Tunnels {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Avvia `ssh -N <forwards>` per l'host. Restituisce tunnel id (uuid).
pub fn tunnel_start(tunnels: &Tunnels, host: &Host) -> Result<String, String> {
    let args = pty::ssh_args_for(host);
    let mut cmd = Command::new("/usr/bin/ssh");
    cmd.arg("-N").args(&args);
    if store::keychain_get(&host.id).is_some() && host.auth_method != "agent" {
        cmd.env("SSH_ASKPASS", pty::askpass_path_pub());
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        cmd.env("TERMINAL_SECRET_ACCOUNT", &host.id);
        cmd.env("DISPLAY", "termilal:0");
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let child = cmd.spawn().map_err(|e| format!("spawn tunnel: {e}"))?;
    let id = uuid::Uuid::new_v4().to_string();
    tunnels
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), child);
    Ok(id)
}

pub fn tunnel_stop(tunnels: &Tunnels, id: &str) -> Result<(), String> {
    if let Some(mut child) = tunnels.lock().map_err(|e| e.to_string())?.remove(id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Restituisce i tunnel vivi (e pulisce i morti).
pub fn tunnel_alive(tunnels: &Tunnels) -> Vec<String> {
    if let Ok(mut map) = tunnels.lock() {
        map.retain(|_, c| !matches!(c.try_wait(), Ok(Some(_))));
        map.keys().cloned().collect()
    } else {
        vec![]
    }
}
