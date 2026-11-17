# Terminal Velocity — PRODUCT.md

> Contesto raccolto dalla sessione di sviluppo; le note non confermate sono marcate [assunto].

## Prodotto
Client SSH desktop nativo per macOS Apple Silicon, sostituto personale di Termius (l'utente vuole smettere di pagare l'abbonamento). Rust + Tauri 2, frontend web con xterm.js, backend con portable-pty + `/usr/bin/ssh` di sistema.

## Nome
**Terminal Velocity** — scelto dall'utente il 2026-11-17. Prima si chiamava "Termilal" (il crate/binario e i path dati restano `termilal` per compatibilità; il bundle .app e il titolo finestra usano il nuovo nome).

## Utente
Singolo utente, sysadmin/freelance che gestisce server propri e dei clienti, molti con Plesk [assunto: anche web agency]. Più host sullo stesso IP con chiavi SSH diverse per dominio.

## Funzioni (già implementate)
Host con gruppi annidati, preferiti, drag&drop, badge online/offline, ultimo accesso; sessioni SSH a schede con split view, broadcast input, ricerca ⌘F, temi; snippet con variabili; SFTP browser; port forwarding + tunnel standalone; login script; import ssh config/CSV/JSON/known_hosts, editor ~/.ssh/config; export JSON; Keychain via /usr/bin/security + SSH_ASKPASS; Touch ID helper; auto-lock; log sessione; backup store; notifiche macOS; quick connect ⌘K.

## Vincoli
- Nessun Xcode: solo Command Line Tools + toolchain rustup locale al progetto
- App non firmata → niente prompt Keychain per-binario (usare /usr/bin/security)
- Tema scelto: **ambar retrò fosforo, intensità massima** — effetti CRT ammessi purché resti usabile per lavoro quotidiano
