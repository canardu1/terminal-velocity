# Termilal

Client SSH nativo per macOS (Apple Silicon) in **Rust + Tauri** — alternativa a Termius.

## Stack

- **Backend Rust**: `portable-pty` per la pty, `/usr/bin/ssh` di sistema, `keyring` per le password (Keychain), store JSON in `~/Library/Application Support/Termilal/store.json`
- **Frontend**: webview nativa + **xterm.js** (lo stesso terminale di VSCode), tema dark
- Niente Xcode: basta `cargo` + clang delle Command Line Tools

## Funzionalità

- Terminale a schede, più sessioni in parallelo, indicatori di stato e riconnessione con un click
- Host con gruppi, tag, preferiti, ricerca, note, jump host (ProxyJump), argomenti ssh extra
- Auth: ssh-agent/chiavi di default, chiave privata dedicata, password (Keychain via SSH_ASKPASS)
- Snippet di comandi eseguibili sulla sessione attiva
- Import da `~/.ssh/config`, CSV e JSON — export JSON
- Keep-alive automatico (ServerAliveInterval)

## Build

```bash
# Toolchain rustup locale (il ~/.cargo di sistema e' owned da root):
export PATH=$PWD/.cargo/bin:$PATH
export RUSTUP_HOME=$PWD/.rustup
export CARGO_HOME=$PWD/.cargo

npm install
npx tauri build
# → src-tauri/target/release/bundle/macos/Termilal.app
```

## Sviluppo

```bash
export PATH=$PWD/.cargo/bin:$PATH RUSTUP_HOME=$PWD/.rustup CARGO_HOME=$PWD/.cargo
npx tauri dev
```

## Import da Termius

Termius cifra i dati in locale (E2E): non è possibile importare host e password dal suo database. Percorsi alternativi:

1. `~/.ssh/config` → un click dal menu Importa/Esporta
2. CSV: `name,hostname,port,username,authMethod,privateKeyPath,group,tags,notes`
3. JSON nel formato dello store (vedi `store.json`)
