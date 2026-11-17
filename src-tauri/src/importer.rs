use crate::store::Host;

/// Parser minimale per ~/.ssh/config.
pub fn parse_ssh_config(text: &str) -> Vec<Host> {
    let mut out = Vec::new();
    let mut patterns: Vec<String> = Vec::new();
    let mut host_name = String::new();
    let mut user = String::new();
    let mut port = 22u16;
    let mut identity = String::new();
    let mut proxy_jump = String::new();

    fn flush(
        out: &mut Vec<Host>,
        patterns: &[String],
        host_name: &str,
        user: &str,
        port: u16,
        identity: &str,
        proxy_jump: &str,
    ) {
        for p in patterns {
            if p.contains('*') || p.contains('?') || p.starts_with('!') {
                continue;
            }
            let mut h = Host {
                id: uuid::Uuid::new_v4().to_string(),
                name: p.clone(),
                hostname: if host_name.is_empty() { p.clone() } else { host_name.into() },
                port,
                username: user.into(),
                auth_method: "agent".into(),
                private_key_path: String::new(),
                jump_host: proxy_jump.into(),
                extra_args: String::new(),
                keep_alive: true,
                group: "ssh-config".into(),
                tags: vec![],
                notes: "Importato da ~/.ssh/config".into(),
                favorite: false,
                last_connected: None,
                login_script: String::new(),
                forwards: String::new(),
                theme: String::new(),
                auto_reconnect: false,
                mosh: false,
                knock_ports: String::new(),
            };
            if !identity.is_empty() {
                h.auth_method = "key".into();
                h.private_key_path = identity.into();
            }
            out.push(h);
        }
    }

    for raw in text.lines() {
        let line = match raw.find('#') {
            Some(i) => &raw[..i],
            None => raw,
        }
        .trim();
        if line.is_empty() {
            continue;
        }
        let (key, value) = match line.split_once([' ', '\t', '=']) {
            Some((k, v)) => (k.trim().to_lowercase(), v.trim().to_string()),
            None => continue,
        };
        match key.as_str() {
            "host" => {
                flush(&mut out, &patterns, &host_name, &user, port, &identity, &proxy_jump);
                patterns = value
                    .split(|c: char| c == ' ' || c == ',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.trim_matches('"').to_string())
                    .collect();
                host_name.clear();
                user.clear();
                port = 22;
                identity.clear();
                proxy_jump.clear();
            }
            "hostname" => host_name = value,
            "user" => user = value,
            "port" => port = value.parse().unwrap_or(22),
            "identityfile" => identity = value,
            "proxyjump" => proxy_jump = value,
            _ => {}
        }
    }
    flush(&mut out, &patterns, &host_name, &user, port, &identity, &proxy_jump);
    out
}

/// Parser CSV con virgolette. Header atteso:
/// name,hostname,port,username,authMethod,privateKeyPath,jumpHost,group,tags,notes
pub fn parse_csv(text: &str) -> Vec<Host> {
    let rows = parse_rows(text);
    if rows.is_empty() {
        return vec![];
    }
    let (header, start) = if rows[0].iter().any(|c| {
        let l = c.to_lowercase();
        l == "hostname" || l == "host"
    }) {
        (Some(rows[0].iter().map(|c| c.to_lowercase()).collect::<Vec<_>>()), 1)
    } else {
        (None, 0)
    };

    let order = ["name", "hostname", "port", "username", "authmethod", "privatekeypath", "jumphost", "group", "tags", "notes"];

    let mut out = Vec::new();
    for row in &rows[start..] {
        let col = |names: &[&str]| -> String {
            for name in names {
                let idx = match &header {
                    Some(h) => h.iter().position(|c| c == name),
                    None => order.iter().position(|c| c == name),
                };
                if let Some(i) = idx {
                    if let Some(v) = row.get(i) {
                        if !v.is_empty() {
                            return v.clone();
                        }
                    }
                }
            }
            String::new()
        };

        let hostname = col(&["hostname", "host", "address"]);
        if hostname.is_empty() {
            continue;
        }
        let key_path = col(&["privatekeypath", "key", "identityfile"]);
        let auth = col(&["authmethod", "auth"]).to_lowercase();
        let mut h = Host {
            id: uuid::Uuid::new_v4().to_string(),
            name: col(&["name", "label", "title"]),
            hostname,
            port: col(&["port"]).parse().unwrap_or(22),
            username: col(&["username", "user", "login"]),
            auth_method: if auth.contains("password") {
                "password".into()
            } else if !key_path.is_empty() || auth.contains("key") {
                "key".into()
            } else {
                "agent".into()
            },
            private_key_path: key_path,
            jump_host: col(&["jumphost", "jump", "proxyjump"]),
            extra_args: String::new(),
            keep_alive: true,
            group: col(&["group"]),
            tags: col(&["tags", "tag"])
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            notes: col(&["notes", "note", "description"]),
            favorite: false,
            last_connected: None,
            login_script: String::new(),
            forwards: String::new(),
            theme: String::new(),
            auto_reconnect: false,
            mosh: false,
            knock_ports: String::new(),
        };
        if h.name.is_empty() {
            h.name = h.hostname.clone();
        }
        out.push(h);
    }
    out
}

fn parse_rows(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes => {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            }
            '"' => in_quotes = true,
            ',' if !in_quotes => {
                row.push(field.clone());
                field.clear();
            }
            '\n' | '\r' if !in_quotes => {
                if ch == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(field.clone());
                field.clear();
                if !row.iter().all(|f| f.is_empty()) {
                    rows.push(row.clone());
                }
                row.clear();
            }
            _ => field.push(ch),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if !row.iter().all(|f| f.is_empty()) {
            rows.push(row);
        }
    }
    rows
}
