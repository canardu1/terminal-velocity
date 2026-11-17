use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::store::{self, Host};

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    #[allow(dead_code)]
    pub host: Host,
}

pub type Sessions = Arc<Mutex<HashMap<String, PtySession>>>;

pub fn new_sessions() -> Sessions {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Argomenti comuni ssh/sftp per l'host (senza comando/host finale).
fn common_args(host: &Host) -> Vec<String> {
    let mut args = Vec::new();
    if !host.username.is_empty() {
        args.push("-l".into());
        args.push(host.username.clone());
    }
    if host.keep_alive {
        args.extend([
            "-o".into(), "ServerAliveInterval=30".into(),
            "-o".into(), "ServerAliveCountMax=6".into(),
            "-o".into(), "TCPKeepAlive=yes".into(),
        ]);
    }
    match host.auth_method.as_str() {
        "key" => {
            let mut p = host.private_key_path.clone();
            if p.starts_with('~') {
                p = format!("{}{}", std::env::var("HOME").unwrap_or_default(), &p[1..]);
            }
            args.push("-i".into());
            args.push(p);
            args.push("-o".into());
            args.push("IdentitiesOnly=yes".into());
        }
        _ => {}
    }
    if !host.jump_host.is_empty() {
        args.push("-J".into());
        args.push(host.jump_host.clone());
    }
    // Port forwarding: righe "L 8080:host:80" / "R 9090:host:90" / "D 1080"
    for line in host.forwards.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (kind, spec) = match line.split_once(' ') {
            Some((k, s)) => (k.trim(), s.trim()),
            None => ("L", line),
        };
        let flag = match kind.to_uppercase().as_str() {
            "L" | "LOCAL" => "-L",
            "R" | "REMOTE" => "-R",
            "D" | "DYNAMIC" => "-D",
            _ => continue,
        };
        args.push(flag.into());
        args.push(spec.into());
    }
    if !host.extra_args.is_empty() {
        args.extend(split_args(&host.extra_args));
    }
    args
}

/// Argomenti per `/usr/bin/ssh` (incluso hostname finale).
pub fn ssh_args_for(host: &Host) -> Vec<String> {
    let mut args = vec!["-p".into(), host.port.to_string()];
    args.extend(common_args(host));
    args.push(host.hostname.clone());
    args
}

/// Argomenti per `sftp` (porta con -P, host finale).
pub fn sftp_args(host: &Host) -> Vec<String> {
    let mut args = vec!["-P".into(), host.port.to_string()];
    args.extend(common_args(host));
    args.push(host.hostname.clone());
    args
}

fn split_args(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for ch in input.chars() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => quote = Some(ch),
            (None, ' ' | '\t') => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Avvia una sessione ssh su pty. Restituisce il session_id.
/// Emit eventi: "pty:{id}:data" (String), "pty:{id}:exit" (Option<i32>).
/// `log` = scrive l'output grezzo in logs/ per audit.
pub fn start(
    app: AppHandle,
    sessions: Sessions,
    host: Host,
    cols: u16,
    rows: u16,
    log: bool,
    session_id: Option<String>,
) -> Result<String, String> {
    let id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Port knocking prima della connessione
    if !host.knock_ports.trim().is_empty() {
        knock(&host);
    }

    let mut cmd = if host.mosh {
        let bin = mosh_bin()
            .ok_or("mosh non installato — installa con: brew install mosh")?;
        let mut c = CommandBuilder::new(bin);
        let mut ssh_args = ssh_args_for(&host);
        ssh_args.pop(); // hostname: è il target di mosh
        let ssh_str = ssh_args
            .iter()
            .map(|a| shell_quote(a))
            .collect::<Vec<_>>()
            .join(" ");
        c.arg(format!("--ssh=ssh {ssh_str}"));
        let target = if host.username.is_empty() {
            host.hostname.clone()
        } else {
            format!("{}@{}", host.username, host.hostname)
        };
        c.arg(target);
        c
    } else {
        let mut c = CommandBuilder::new("/usr/bin/ssh");
        c.args(ssh_args_for(&host));
        c
    };

    // Ambiente: partiamo da quello del processo e aggiungiamo TERM + askpass.
    cmd.env("TERM", "xterm-256color");
    // Askpass per password E per passphrase delle chiavi private.
    let has_secret = store::keychain_get(&host.id).is_some();
    if has_secret && host.auth_method != "agent" {
        let askpass = askpass_path();
        cmd.env("SSH_ASKPASS", askpass);
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        cmd.env("TERMINAL_SECRET_ACCOUNT", host.id.clone());
        cmd.env("DISPLAY", "termilal:0");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn ssh fallito: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // File di log di sessione
    let log_file = if log {
        let dir = store::logs_dir();
        let _ = std::fs::create_dir_all(&dir);
        let fname = format!(
            "{}-{}.log",
            sanitize_name(if host.name.is_empty() { &host.hostname } else { &host.name }),
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        );
        File::create(dir.join(fname)).ok()
    } else {
        None
    };

    // Thread: output pty → evento frontend (+ log file). All'EOF emette exit.
    {
        let app = app.clone();
        let id = id.clone();
        let sessions = sessions.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 32 * 1024];
            let mut logf = log_file;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Some(f) = logf.as_mut() {
                            let _ = f.write_all(&buf[..n]);
                        }
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&format!("pty:{id}:data"), text);
                    }
                    Err(_) => break,
                }
            }
            let code = sessions
                .lock()
                .ok()
                .and_then(|mut m| m.get_mut(&id).and_then(|s| s.child.try_wait().ok()).flatten())
                .map(|status| status.exit_code());
            let _ = app.emit(&format!("pty:{id}:exit"), code);
        });
    }

    sessions.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        PtySession {
            writer,
            master: pair.master,
            child,
            host,
        },
    );
    Ok(id)
}

/// Port knocking: TCP connect breve su ogni porta della sequenza, poi prosegue.
fn knock(host: &Host) {
    for p in host.knock_ports.split(',') {
        let Ok(port) = p.trim().parse::<u16>() else {
            continue;
        };
        let addr = format!("{}:{}", host.hostname, port);
        if let Ok(mut it) = addr.to_socket_addrs() {
            if let Some(sa) = it.next() {
                let _ = std::net::TcpStream::connect_timeout(&sa, Duration::from_millis(400));
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

fn mosh_bin() -> Option<String> {
    for p in ["/opt/homebrew/bin/mosh", "/usr/local/bin/mosh", "/usr/bin/mosh"] {
        if std::path::Path::new(p).exists() {
            return Some(p.into());
        }
    }
    let out = std::process::Command::new("/usr/bin/which")
        .arg("mosh")
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !s.is_empty()).then_some(s)
}

fn sanitize_name(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn askpass_path() -> String {
    askpass_path_pub()
}

pub fn askpass_path_pub() -> String {
    // In bundle: Contents/Resources/askpass.sh (o sotto resources/)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for rel in ["../Resources/askpass.sh", "../Resources/resources/askpass.sh"] {
                let candidate = dir.join(rel);
                if candidate.exists() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
    }
    // Fallback dev: accanto al progetto
    format!("{}/src-tauri/resources/askpass.sh", env!("CARGO_MANIFEST_DIR"))
}

pub fn write(sessions: &Sessions, id: &str, data: &[u8]) -> Result<(), String> {
    let mut guard = sessions.lock().map_err(|e| e.to_string())?;
    let session = guard.get_mut(id).ok_or("sessione non trovata")?;
    session.writer.write_all(data).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

pub fn resize(sessions: &Sessions, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let guard = sessions.lock().map_err(|e| e.to_string())?;
    let session = guard.get(id).ok_or("sessione non trovata")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

pub fn close(sessions: &Sessions, id: &str) -> Result<(), String> {
    let mut guard = sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = guard.remove(id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

/// Directory dei log di sessione (per "apri cartella log").
pub fn logs_dir_path() -> PathBuf {
    store::logs_dir()
}
