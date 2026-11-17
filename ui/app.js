/* Termilal frontend — Tauri 2 + xterm.js */
"use strict";

// Diagnostica: mostra errori JS a schermo invece di fallire in silenzio
function showFatal(msg) {
  let el = document.getElementById("fatal");
  if (!el) {
    el = document.createElement("div");
    el.id = "fatal";
    el.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:#f85149;color:#fff;padding:8px 14px;font:12px ui-monospace,monospace;z-index:9999;white-space:pre-wrap";
    document.body.appendChild(el);
  }
  el.textContent = String(msg);
}
window.onerror = (m, s, l, c) => showFatal(`Errore JS: ${m} — ${String(s).split("/").pop()}:${l}:${c}`);
window.onunhandledrejection = (e) => {
  let r = e.reason;
  let txt = r?.message ?? r;
  try { txt = JSON.stringify(txt) === "{}" ? String(r) : JSON.stringify(txt); } catch { txt = String(r); }
  showFatal(`Promise rifiutata: ${txt}`);
};

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const dialog = window.__TAURI__.dialog;

const { Terminal, FitAddon, WebglAddon, SearchAddon } = window.Termilal;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------- Temi ----------
const THEMES = {
  termilal: {
    name: "Ambra fosforo (default)",
    theme: {
      background: "#0b0805", foreground: "#ffe6bd", cursor: "#ffb000",
      selectionBackground: "#4d3a1a",
      black: "#0b0805", red: "#ff5f45", green: "#a8e089", yellow: "#ffc233",
      blue: "#f0d080", magenta: "#ffab70", cyan: "#e0c280", white: "#ffe6bd",
      brightBlack: "#8a6a30", brightRed: "#ff8a70", brightGreen: "#bdf0a0",
      brightYellow: "#ffd24d", brightBlue: "#ffe0a0", brightMagenta: "#ffc090",
      brightCyan: "#f0d090", brightWhite: "#fff5dd",
    },
  },
  dracula: {
    name: "Dracula",
    theme: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
      blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94",
      brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df",
      brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  solarized: {
    name: "Solarized Dark",
    theme: {
      background: "#002b36", foreground: "#839496", cursor: "#93a1a1",
      selectionBackground: "#073642",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75",
      brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  nord: {
    name: "Nord",
    theme: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9",
      selectionBackground: "#434c5e",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
      blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb", brightWhite: "#eceff4",
    },
  },
  red: {
    name: "Rosso allarme",
    theme: {
      background: "#140806", foreground: "#ffc9b8", cursor: "#ff5f45",
      selectionBackground: "#4d2016",
      black: "#140806", red: "#ff5f45", green: "#a8e089", yellow: "#ffc233",
      blue: "#f0d080", magenta: "#ffab70", cyan: "#e0c280", white: "#ffc9b8",
      brightBlack: "#6b3226", brightRed: "#ff8a70", brightGreen: "#bdf0a0",
      brightYellow: "#ffd24d", brightBlue: "#ffe0a0", brightMagenta: "#ffc090",
      brightCyan: "#f0d090", brightWhite: "#ffe8dc",
    },
  },
  green: {
    name: "Verde fosforo",
    theme: {
      background: "#081006", foreground: "#c9f0b8", cursor: "#8fd66e",
      selectionBackground: "#1f3d16",
      black: "#081006", red: "#ff5f45", green: "#a8e089", yellow: "#ffc233",
      blue: "#d0e080", magenta: "#c0d080", cyan: "#b8e0a0", white: "#c9f0b8",
      brightBlack: "#2f4d26", brightRed: "#ff8a70", brightGreen: "#bdf0a0",
      brightYellow: "#ffd24d", brightBlue: "#e0f0a0", brightMagenta: "#d0e090",
      brightCyan: "#d0f0b0", brightWhite: "#e8f8dc",
    },
  },
  light: {
    name: "Chiaro",
    theme: {
      background: "#ffffff", foreground: "#24292f", cursor: "#24292f",
      selectionBackground: "#add6ff",
      black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00",
      blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
      brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37",
      brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9",
      brightCyan: "#3192aa", brightWhite: "#8c959f",
    },
  },
};
// Risoluzione tema: host > gruppo > globale
const themeFor = (host) =>
  THEMES[host?.theme || settings.group_themes?.[host?.group] || settings.theme]?.theme
  ?? THEMES.termilal.theme;

// Match fuzzy: caratteri della query in ordine (non necessariamente contigui)
function fuzzyMatch(q, text) {
  q = (q || "").toLowerCase();
  text = (text || "").toLowerCase();
  if (!q) return true;
  if (text.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (text[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ---------- Stato ----------
let hosts = [];
let snippets = [];
let settings = {};
let hostOrder = [];
/** sessionId → { host, term, fit, search, pane, status, title, closedByUser } */
const sessions = new Map();
let activeSession = null;
let editingHostId = null;
let ctxHostId = null;
let splitPair = null; // {left, right} quando vista divisa
let focusedSide = "left";
let broadcastOn = false;
const hostStatus = new Map(); // hostId → "online"|"offline"|"unknown"
const tunnels = new Map(); // hostId → tunnelId
let locked = false;
let lastActivity = Date.now();

// ---------- Store ----------
async function loadStore() {
  const data = await invoke("get_store");
  hosts = data.hosts;
  snippets = data.snippets;
  settings = { ...data.settings };
  hostOrder = data.host_order || [];
  applySettings();
  renderHostList();
}

function applySettings() {
  document.documentElement.dataset.bright = String(settings.brightness ?? 2);
  for (const [, s] of sessions) {
    s.term.options.theme = themeFor(s.host);
    s.term.options.fontSize = settings.font_size || 13;
    try { s.fit.fit(); } catch {}
  }
}

// ---------- Icone SVG (stroke coerente) ----------
const ICONS = {
  key: '<svg viewBox="0 0 16 16" width="12" height="12"><circle cx="5.5" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8.5 8H15m-2.5 0v2.5M12 8v2"/></svg>',
  lock: '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="3.5" y="7" width="9" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  bolt: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M9 1L3 9h3.5L6 15l6-8H8.5z"/></svg>',
  folder: '<svg viewBox="0 0 16 16" width="13" height="13"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M1.5 3.5h4l1.5 2h7.5v7h-13z"/></svg>',
  file: '<svg viewBox="0 0 16 16" width="13" height="13"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M4 1.5h5.5L12.5 4v10.5h-9z"/><path fill="none" stroke="currentColor" stroke-width="1.3" d="M9 1.5V4h3.5"/></svg>',
  link: '<svg viewBox="0 0 16 16" width="13" height="13"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 9.5l3-3M5 8l-2 2a2.8 2.8 0 0 0 4 4l2-2M11 8l2-2a2.8 2.8 0 0 0-4-4L7 4"/></svg>',
};

// ---------- Sidebar ----------
function authIcon(h) {
  if (h.auth_method === "password") return ICONS.lock;
  if (h.auth_method === "key") return ICONS.key;
  return ICONS.bolt;
}

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "ora";
  if (m < 60) return `${m}m fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h fa`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}g fa`;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

function sortedHosts(list) {
  const idx = new Map(hostOrder.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const ia = idx.get(a.id), ib = idx.get(b.id);
    if (ia !== undefined || ib !== undefined) {
      return (ia ?? 99999) - (ib ?? 99999);
    }
    return byName(a, b);
  });
}

const collapsedGroups = new Set(JSON.parse(localStorage.getItem("tv_collapsed") || "[]"));
const saveCollapsed = () => localStorage.setItem("tv_collapsed", JSON.stringify([...collapsedGroups]));

function renderHostList() {
  const list = $("#hostList");
  const q = $("#search").value.trim().toLowerCase();
  list.innerHTML = "";

  const addHostRow = (container, h) => {
    const row = document.createElement("div");
    row.className = "host-row";
    row.dataset.id = h.id;
    row.draggable = true;
    const badge = hostStatus.get(h.id) || "unknown";
    const last = relTime(h.last_connected);
    row.innerHTML = `
      <span class="icon">${authIcon(h)}</span>
      <span style="min-width:0;flex:1">
        <div class="name">${escapeHtml(h.name || h.hostname)}</div>
        <div class="sub">${escapeHtml(h.username ? h.username + "@" : "")}${escapeHtml(h.hostname)}${h.port !== 22 ? ":" + h.port : ""}${last ? " · " + last : ""}</div>
      </span>
      ${h.favorite ? '<span class="star">★</span>' : ""}
      <span class="badge ${badge}"></span>
    `;
    row.addEventListener("click", () => openSession(h));
    row.addEventListener("contextmenu", (e) => showCtxMenu(e, h));
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/host-id", h.id);
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const dragId = e.dataTransfer.getData("text/host-id");
      if (!dragId || dragId === h.id) return;
      const order = hosts.map(x => x.id);
      const from = order.indexOf(dragId), to = order.indexOf(h.id);
      if (from < 0 || to < 0) return;
      order.splice(to, 0, order.splice(from, 1)[0]);
      hostOrder = order;
      await invoke("save_host_order", { order });
      renderHostList();
    });
    container.appendChild(row);
  };

  if (q) {
    const hits = hosts.filter(h =>
      [h.name, h.hostname, h.username, h.group, ...(h.tags || [])].some(v => fuzzyMatch(q, v)));
    if (hits.length === 0) {
      list.innerHTML = '<div class="section-title">Nessun risultato</div>';
      return;
    }
    hits.forEach(h => addHostRow(list, h));
    return;
  }

  const groups = new Map();
  for (const h of hosts) {
    const g = h.group || "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(h);
  }
  const favs = hosts.filter(h => h.favorite);
  if (favs.length) {
    list.appendChild(section("Preferiti"));
    sortedHosts(favs).forEach(h => addHostRow(list, h));
  }
  const sortedGroups = [...groups.keys()].filter(g => g).sort((a, b) => a.localeCompare(b));
  for (const g of sortedGroups) {
    // Gruppi annidati: "a/b" → sezione indentata
    const depth = g.split("/").length - 1;
    const sec = section(g.replaceAll("/", " ▸ "));
    sec.classList.add("group-head");
    if (depth > 0) sec.classList.add("sub");
    sec.innerHTML = `<span class="caret">▾</span>${escapeHtml(g.replaceAll("/", " ▸ "))}`;
    const collapsed = collapsedGroups.has(g);
    if (collapsed) sec.classList.add("collapsed");
    const items = document.createElement("div");
    items.className = "group-items" + (collapsed ? " hidden" : "");
    sec.addEventListener("click", () => {
      collapsedGroups.has(g) ? collapsedGroups.delete(g) : collapsedGroups.add(g);
      saveCollapsed();
      sec.classList.toggle("collapsed");
      items.classList.toggle("hidden");
    });
    list.appendChild(sec);
    list.appendChild(items);
    sortedHosts(groups.get(g)).forEach(h => addHostRow(items, h));
  }
  const ungrouped = groups.get("") || [];
  if (ungrouped.length) {
    list.appendChild(section("Host"));
    sortedHosts(ungrouped).forEach(h => addHostRow(list, h));
  }
  if (!hosts.length) {
    list.innerHTML = '<div class="section-title">Nessun host — aggiungine uno o importa da ssh config</div>';
  }
}

const byName = (a, b) => (a.name || a.hostname).localeCompare(b.name || b.hostname);

function section(title) {
  const el = document.createElement("div");
  el.className = "section-title";
  el.textContent = title;
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------- Check stato host ----------
$("#btnPing").addEventListener("click", async () => {
  for (const h of hosts) hostStatus.set(h.id, "unknown");
  renderHostList();
  await Promise.all(hosts.map(async (h) => {
    try {
      const ok = await invoke("check_host", { hostname: h.hostname, port: h.port });
      hostStatus.set(h.id, ok ? "online" : "offline");
    } catch {
      hostStatus.set(h.id, "offline");
    }
  }));
  renderHostList();
});

// ---------- Menu contestuale ----------
function showCtxMenu(e, host) {
  e.preventDefault();
  ctxHostId = host.id;
  $("#ctxFavorite").textContent = host.favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti";
  const hasForwards = (host.forwards || "").trim().length > 0;
  const tunnelId = tunnels.get(host.id);
  const tBtn = $("#ctxTunnel");
  tBtn.textContent = tunnelId ? "Ferma tunnel" : "Avvia tunnel";
  tBtn.style.display = hasForwards || tunnelId ? "" : "none";
  const menu = $("#ctxMenu");
  menu.classList.remove("hidden");
  menu.style.left = `${Math.min(e.clientX, innerWidth - 190)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - 240)}px`;
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#ctxMenu")) $("#ctxMenu").classList.add("hidden");
  if (!e.target.closest("#ioDropdown")) $("#ioMenu").classList.remove("open");
});

$("#ctxMenu").addEventListener("click", async (e) => {
  const action = e.target.dataset.action;
  const host = hosts.find(h => h.id === ctxHostId);
  if (!host || !action) return;
  $("#ctxMenu").classList.add("hidden");
  switch (action) {
    case "connect": openSession(host); break;
    case "sftp": openSftp(host); break;
    case "server": openServerPanel(host); break;
    case "tunnel": {
      const existing = tunnels.get(host.id);
      if (existing) {
        await invoke("tunnel_stop", { id: existing }).catch(() => {});
        tunnels.delete(host.id);
      } else {
        try {
          const tid = await invoke("tunnel_start", { host });
          tunnels.set(host.id, tid);
          await invoke("send_notification", {
            title: "Terminal Velocity",
            body: `Tunnel attivo per ${host.name || host.hostname}`,
          });
        } catch (err) {
          alert("Tunnel: " + err);
        }
      }
      break;
    }
    case "edit": openHostModal(host); break;
    case "duplicate": {
      const copy = { ...host, id: crypto.randomUUID(), name: (host.name || host.hostname) + " copia", favorite: false, last_connected: null };
      await invoke("save_host", { host: copy, password: null });
      await loadStore();
      break;
    }
    case "favorite":
      host.favorite = !host.favorite;
      await invoke("save_host", { host, password: null });
      renderHostList();
      break;
    case "delete":
      if (confirm(`Eliminare "${host.name || host.hostname}"?`)) {
        await invoke("delete_host", { id: host.id });
        renderHostList();
      }
      break;
  }
});

// ---------- Sessioni SSH ----------
async function openSession(host, opts = {}) {
  for (const [id, s] of sessions) {
    if (s.host.id === host.id && s.status !== "disconnected" && !opts.force) {
      selectSession(id);
      return;
    }
  }

  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const pane = document.createElement("div");
  pane.className = "term-pane hidden";
  $("#terminals").appendChild(pane);

  const term = new Terminal({
    fontFamily: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: settings.font_size || 13,
    cursorBlink: true,
    scrollback: 10000,
    theme: themeFor(host),
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.open(pane);
  try { term.loadAddon(new WebglAddon()); } catch { /* fallback canvas */ }

  const session = { host, term, fit, search, pane, status: "connecting", title: "", closedByUser: false };
  sessions.set(sessionId, session);

  // Titolo OSC → titolo tab
  term.onTitleChange((t) => {
    if (t) { session.title = t; renderTabs(); }
  });

  // Copia automatica alla selezione
  term.onSelectionChange(() => {
    const sel = term.getSelection();
    if (sel && settings.copy_on_select) {
      navigator.clipboard.writeText(sel).catch(() => {});
    }
  });

  // Incolla col tasto destro
  pane.addEventListener("contextmenu", async (e) => {
    if (!settings.right_click_paste) return;
    e.preventDefault();
    try { term.paste(await navigator.clipboard.readText()); } catch {}
  });

  // Click su un lato della split view → quel lato prende il focus
  pane.addEventListener("mousedown", () => {
    if (!splitPair) return;
    const side = pane.classList.contains("split-right") ? "right" : "left";
    if (focusedSide !== side || activeSession !== sessionId) {
      focusedSide = side;
      activeSession = sessionId;
      renderTabs();
    }
  });

  // Output pty → terminale
  listen(`pty:${sessionId}:data`, (ev) => term.write(ev.payload));
  // Input terminale → pty (o broadcast)
  term.onData((data) => {
    if (broadcastOn) {
      for (const [id, s] of sessions) {
        if (s.status === "connected") invoke("pty_write", { id, data }).catch(() => {});
      }
    } else {
      invoke("pty_write", { id: sessionId, data }).catch(() => {});
    }
  });
  // Uscita processo
  listen(`pty:${sessionId}:exit`, () => {
    session.status = "disconnected";
    term.writeln(`\r\n\x1b[90m— Connessione chiusa —\x1b[0m`);
    if (!session.closedByUser && settings.notify_disconnect) {
      invoke("send_notification", {
        title: "Terminal Velocity",
        body: `Sessione chiusa: ${host.name || host.hostname}`,
      }).catch(() => {});
    }
    renderTabs();
    updateOverlay();
    if (host.auto_reconnect && !session.closedByUser) scheduleReconnect(sessionId);
  });
  // Resize
  new ResizeObserver(() => {
    try {
      fit.fit();
      if (!pane.classList.contains("hidden") && session.status === "connected") {
        invoke("pty_resize", { id: sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
      }
    } catch {}
  }).observe(pane);

  const startWhenSized = () => {
    if (pane.clientWidth > 0) {
      fit.fit();
      invoke("pty_start", { sessionId, host, cols: term.cols, rows: term.rows })
        .then(() => {
          session.status = "connected";
          session.connectedAt = Date.now();
          session.retries = 0;
          renderTabs();
          updateOverlay();
          // Script di login
          if (host.login_script?.trim()) {
            setTimeout(() => {
              invoke("pty_write", { id: sessionId, data: host.login_script.trim() + "\r" }).catch(() => {});
            }, 1500);
          }
        })
        .catch((err) => { session.status = "failed"; term.writeln(`\x1b[31mErrore: ${err}\x1b[0m`); renderTabs(); updateOverlay(); });
    } else {
      requestAnimationFrame(startWhenSized);
    }
  };

  const tab = document.createElement("div");
  tab.id = `tab-${sessionId}`;
  tab.className = "tab";
  tab.dataset.session = sessionId;
  $("#tabbar").appendChild(tab);

  selectSession(sessionId);
  startWhenSized();
}

// ---------- Auto-reconnect con backoff ----------
function scheduleReconnect(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || s.closedByUser) return;
  clearTimeout(s.retryTimer);
  clearInterval(s.retryCountdown);
  s.retries = (s.retries ?? 0) + 1;
  if (s.retries > 10) {
    s.status = "disconnected";
    renderTabs();
    updateOverlay();
    return;
  }
  const delay = Math.min(30, Math.pow(2, s.retries));
  s.status = "connecting";
  renderTabs();
  updateOverlay();
  let left = delay;
  const countTxt = () => `Riconnessione tra ${left}s… (tentativo ${s.retries}/10)`;
  if (activeSession === sessionId) $("#overlayText").textContent = countTxt();
  s.retryCountdown = setInterval(() => {
    if (!sessions.has(sessionId) || --left <= 0) { clearInterval(s.retryCountdown); return; }
    if (activeSession === sessionId) $("#overlayText").textContent = countTxt();
  }, 1000);
  s.retryTimer = setTimeout(async () => {
    clearInterval(s.retryCountdown);
    if (!sessions.has(sessionId)) return;
    try { await invoke("pty_close", { id: sessionId }); } catch {}
    try {
      await invoke("pty_start", { sessionId, host: s.host, cols: s.term.cols, rows: s.term.rows });
      s.status = "connected";
      s.connectedAt = Date.now();
      s.retries = 0;
    } catch {
      scheduleReconnect(sessionId);
      return;
    }
    renderTabs();
    updateOverlay();
  }, delay * 1000);
}

function selectSession(id, side) {
  const s = sessions.get(id);
  if (!s) return;
  if (splitPair) {
    focusedSide = side ?? (splitPair.right === id ? "right" : "left");
    if (focusedSide === "left") splitPair.left = id;
    else splitPair.right = id;
    activeSession = id;
  } else {
    activeSession = id;
    focusedSide = "left";
  }
  layoutPanes();
  renderTabs();
  updateOverlay();
  s.term.focus();
}

function layoutPanes() {
  for (const [sid, s] of sessions) {
    const pane = s.pane;
    pane.classList.remove("split-left", "split-right");
    let visible = false;
    if (splitPair) {
      if (sid === splitPair.left) { pane.classList.add("split-left"); visible = true; }
      if (sid === splitPair.right) { pane.classList.add("split-right"); visible = true; }
    } else {
      visible = sid === activeSession;
    }
    pane.classList.toggle("hidden", !visible);
  }
  // fit + resize per i pannelli visibili
  requestAnimationFrame(() => {
    for (const [, s] of sessions) {
      if (!s.pane.classList.contains("hidden")) {
        try {
          s.fit.fit();
          if (s.status === "connected") {
            const id = [...sessions.entries()].find(([, v]) => v === s)[0];
            invoke("pty_resize", { id, cols: s.term.cols, rows: s.term.rows }).catch(() => {});
          }
        } catch {}
      }
    }
  });
}

function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  s.closedByUser = true;
  clearTimeout(s.retryTimer);
  clearInterval(s.retryCountdown);
  invoke("pty_close", { id }).catch(() => {});
  s.term.dispose();
  s.pane.remove();
  document.getElementById(`tab-${id}`)?.remove();
  sessions.delete(id);
  if (splitPair) {
    if (splitPair.left === id) splitPair.left = splitPair.right;
    if (splitPair.right === id || splitPair.left === splitPair.right) splitPair = null;
  }
  if (activeSession === id) {
    activeSession = splitPair ? (focusedSide === "left" ? splitPair.left : splitPair.right) : [...sessions.keys()].pop() ?? null;
    if (activeSession && !sessions.has(activeSession)) activeSession = [...sessions.keys()].pop() ?? null;
  }
  layoutPanes();
  renderTabs();
  updateOverlay();
  if (sessions.size === 0) $("#empty").classList.remove("hidden");
  updateTabTools();
}

// ---------- Split view ----------
$("#btnSplit").addEventListener("click", () => {
  if (splitPair) {
    splitPair = null;
    focusedSide = "left";
  } else {
    const others = [...sessions.keys()].filter(id => id !== activeSession);
    if (others.length === 0) {
      // apri una seconda sessione sullo stesso host
      const s = sessions.get(activeSession);
      if (!s) return;
      const prevActive = activeSession;
      const newId = crypto.randomUUID();
      splitPair = { left: prevActive, right: newId };
      focusedSide = "right";
      openSession(s.host, { force: true, sessionId: newId });
      return;
    }
    splitPair = { left: activeSession, right: others[0] };
    focusedSide = "right";
    activeSession = others[0];
  }
  layoutPanes();
  renderTabs();
});

// ---------- Broadcast ----------
$("#btnBroadcast").addEventListener("click", (e) => {
  broadcastOn = !broadcastOn;
  e.currentTarget.classList.toggle("on", broadcastOn);
});

// ---------- Find nel terminale ----------
function activeSearch() {
  return sessions.get(activeSession)?.search;
}
$("#btnFind").addEventListener("click", toggleFind);
function toggleFind() {
  $("#findbar").classList.toggle("hidden");
  if (!$("#findbar").classList.contains("hidden")) $("#findInput").focus();
}
$("#findInput").addEventListener("input", () => {
  activeSearch()?.findNext($("#findInput").value, { incremental: true });
});
$("#findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.shiftKey ? activeSearch()?.findPrevious($("#findInput").value)
               : activeSearch()?.findNext($("#findInput").value);
  }
  if (e.key === "Escape") $("#findbar").classList.add("hidden");
});
$("#findNext").addEventListener("click", () => activeSearch()?.findNext($("#findInput").value));
$("#findPrev").addEventListener("click", () => activeSearch()?.findPrevious($("#findInput").value));
$("#findClose").addEventListener("click", () => $("#findbar").classList.add("hidden"));

function renderTabs() {
  for (const [id, s] of sessions) {
    const tab = document.getElementById(`tab-${id}`);
    if (!tab) continue;
    const isActive = id === activeSession;
    tab.className = `tab${isActive ? " active" : ""}`;
    const title = s.title || s.host.name || s.host.hostname;
    tab.innerHTML = `
      <span class="dot ${s.status}"></span>
      <span class="title">${escapeHtml(title)}</span>
      <button class="close">✕</button>`;
    tab.querySelector(".close").onclick = (e) => { e.stopPropagation(); closeSession(id); };
    tab.onclick = (e) => {
      // ⌘-click → duplica la sessione sullo stesso host
      if (e.metaKey) openSession(s.host, { force: true });
      else selectSession(id);
    };
  }
  $("#empty").classList.toggle("hidden", sessions.size > 0);
  updateTabTools();
}

function updateTabTools() {
  const has = sessions.size > 0;
  for (const id of ["#btnSplit", "#btnBroadcast", "#btnSftp", "#btnFind", "#btnSrv", "#btnExport"]) {
    $(id).classList.toggle("hidden", !has);
  }
  $("#btnBroadcast").classList.toggle("on", broadcastOn);
  updateStatusbar();
}

// ---------- Status bar ----------
function updateStatusbar() {
  const sb = $("#statusbar");
  const s = sessions.get(activeSession);
  if (!s) { sb.classList.add("hidden"); return; }
  sb.classList.remove("hidden");
  $("#sbInfo").textContent =
    `${s.host.username ? s.host.username + "@" : ""}${s.host.hostname}${s.host.port !== 22 ? ":" + s.host.port : ""}` +
    (s.host.name && s.host.name !== s.host.hostname ? ` — ${s.host.name}` : "");
}

// durata sessione (1s) + latenza TCP (10s)
setInterval(() => {
  const s = sessions.get(activeSession);
  if (!s || !s.connectedAt || s.status !== "connected") { $("#sbTime").textContent = ""; return; }
  const sec = Math.floor((Date.now() - s.connectedAt) / 1000);
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  $("#sbTime").textContent = h ? `${h}h ${m % 60}m` : `${m}m ${sec % 60}s`;
}, 1000);

setInterval(async () => {
  const s = sessions.get(activeSession);
  const el = $("#sbLatency");
  if (!s || s.status !== "connected") { el.textContent = ""; return; }
  const ms = await invoke("ping_ms", { hostname: s.host.hostname, port: s.host.port }).catch(() => null);
  if (ms == null) { el.textContent = ""; return; }
  el.textContent = `${ms}ms`;
  el.className = " " + (ms < 80 ? "low" : ms < 200 ? "mid" : "high");
}, 10000);

function updateOverlay() {
  const overlay = $("#overlay"), actions = $("#overlayActions");
  if (!activeSession) { overlay.classList.add("hidden"); return; }
  const s = sessions.get(activeSession);
  if (!s || s.status === "connected") { overlay.classList.add("hidden"); return; }

  overlay.classList.remove("hidden");
  if (s.status === "connecting") {
    $("#overlayIcon").textContent = ">>";
    $("#overlayText").textContent = `Connessione a ${s.host.name || s.host.hostname}…`;
    actions.classList.add("hidden");
  } else if (s.status === "disconnected") {
    $("#overlayIcon").textContent = "##";
    $("#overlayText").textContent = "Connessione chiusa";
    actions.classList.remove("hidden");
  } else {
    $("#overlayIcon").textContent = "!!";
    $("#overlayText").textContent = "Avvio SSH fallito";
    actions.classList.remove("hidden");
  }
}

$("#overlayReconnect").addEventListener("click", async () => {
  const s = sessions.get(activeSession);
  if (!s) return;
  clearTimeout(s.retryTimer);
  clearInterval(s.retryCountdown);
  s.retries = 0;
  try { await invoke("pty_close", { id: activeSession }); } catch {}
  s.status = "connecting";
  s.term.reset();
  try {
    await invoke("pty_start", { sessionId: activeSession, host: s.host, cols: s.term.cols, rows: s.term.rows });
    s.status = "connected";
    s.connectedAt = Date.now();
  } catch (err) {
    s.status = "failed";
    s.term.writeln(`\x1b[31mErrore: ${err}\x1b[0m`);
  }
  renderTabs();
  updateOverlay();
  s.term.focus();
});
$("#overlayClose").addEventListener("click", () => closeSession(activeSession));

// ---------- Esporta sessione ----------
$("#btnExport").addEventListener("click", async () => {
  const s = sessions.get(activeSession);
  if (!s) return;
  const buf = s.term.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  const path = await dialog.save({
    defaultPath: `${s.host.name || s.host.hostname}-session.txt`,
    filters: [
      { name: "Testo", extensions: ["txt"] },
      { name: "HTML", extensions: ["html"] },
    ],
  });
  if (!path) return;
  const contents = path.endsWith(".html")
    ? `<!doctype html><meta charset="utf-8"><style>body{background:#0b0805;color:#ffe6bd;font:13px "IBM Plex Mono",monospace;padding:20px;white-space:pre-wrap}</style>${escapeHtml(text)}`
    : text;
  try {
    await invoke("write_text_file", { path, contents });
  } catch (e) {
    showFatal("Errore export: " + e);
  }
});

// ---------- Modale host ----------
function populateThemeSelects() {
  const opts = Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  $("#f_theme").innerHTML = `<option value="">(globale)</option>` + opts;
  $("#st_theme").innerHTML = opts;
}

function openHostModal(host) {
  editingHostId = host?.id ?? null;
  $("#hostModalTitle").textContent = host ? "Modifica host" : "Nuovo host";
  $("#f_name").value = host?.name ?? "";
  $("#f_hostname").value = host?.hostname ?? "";
  $("#f_port").value = host?.port ?? 22;
  $("#f_username").value = host?.username ?? "";
  $("#f_jump").value = host?.jump_host ?? "";
  $("#f_auth").value = host?.auth_method ?? "agent";
  $("#f_keypath").value = host?.private_key_path ?? "";
  $("#f_password").value = "";
  $("#f_extra").value = host?.extra_args ?? "";
  $("#f_forwards").value = host?.forwards ?? "";
  $("#f_loginscript").value = host?.login_script ?? "";
  $("#f_group").value = host?.group ?? "";
  $("#f_tags").value = (host?.tags ?? []).join(", ");
  $("#f_notes").value = host?.notes ?? "";
  $("#f_theme").value = host?.theme ?? "";
  $("#f_keepalive").checked = host?.keep_alive ?? true;
  $("#f_favorite").checked = host?.favorite ?? false;
  $("#f_reconnect").checked = host?.auto_reconnect ?? false;
  $("#f_mosh").checked = host?.mosh ?? false;
  $("#f_knock").value = host?.knock_ports ?? "";
  $("#testResult").textContent = "";
  updateAuthRows();
  $("#hostModal").classList.remove("hidden");
}

function updateAuthRows() {
  const m = $("#f_auth").value;
  $("#rowKey").classList.toggle("hidden", m !== "key");
  // mostra il campo segreto sia per password che per chiave (passphrase)
  $("#rowPwd").classList.toggle("hidden", m === "agent");
  $("#pwdLabel").textContent = m === "key" ? "Passphrase chiave (Keychain)" : "Password";
}
$("#f_auth").addEventListener("change", updateAuthRows);
$("#hostCancel").addEventListener("click", () => $("#hostModal").classList.add("hidden"));

function collectHostForm() {
  const hostname = $("#f_hostname").value.trim();
  const existing = hosts.find(h => h.id === editingHostId);
  return {
    id: editingHostId ?? crypto.randomUUID(),
    name: $("#f_name").value.trim() || hostname,
    hostname,
    port: parseInt($("#f_port").value) || 22,
    username: $("#f_username").value.trim(),
    auth_method: $("#f_auth").value,
    private_key_path: $("#f_keypath").value.trim(),
    jump_host: $("#f_jump").value.trim(),
    extra_args: $("#f_extra").value.trim(),
    keep_alive: $("#f_keepalive").checked,
    group: $("#f_group").value.trim(),
    tags: $("#f_tags").value.split(",").map(s => s.trim()).filter(Boolean),
    notes: $("#f_notes").value.trim(),
    favorite: $("#f_favorite").checked,
    last_connected: existing?.last_connected ?? null,
    login_script: $("#f_loginscript").value.trim(),
    forwards: $("#f_forwards").value.trim(),
    theme: $("#f_theme").value,
    auto_reconnect: $("#f_reconnect").checked,
    mosh: $("#f_mosh").checked,
    knock_ports: $("#f_knock").value.trim(),
  };
}

$("#hostTest").addEventListener("click", async () => {
  const el = $("#testResult");
  const host = collectHostForm();
  if (!host.hostname) { el.className = "err"; el.textContent = "hostname mancante"; return; }
  el.className = "";
  el.textContent = "test in corso…";
  try {
    const r = await invoke("test_host", { host });
    el.className = r.ssh_ok ? "ok" : "err";
    el.textContent = r.tcp_ms != null ? `TCP ${r.tcp_ms}ms — ${r.message}` : r.message;
  } catch (e) {
    el.className = "err";
    el.textContent = String(e);
  }
});

$("#hostSave").addEventListener("click", async () => {
  const host = collectHostForm();
  if (!host.hostname) { $("#f_hostname").focus(); return; }
  const pwd = $("#f_password").value;
  if (host.auth_method === "agent") {
    await invoke("delete_password", { hostId: host.id }).catch(() => {});
  }
  await invoke("save_host", { host, password: host.auth_method !== "agent" && pwd ? pwd : null });
  $("#hostModal").classList.add("hidden");
  await loadStore();
});

// ---------- Snippet ----------
function expandSnippet(cmd, host) {
  const now = new Date();
  return cmd
    .replaceAll("{host}", host?.hostname ?? "")
    .replaceAll("{user}", host?.username ?? "")
    .replaceAll("{port}", String(host?.port ?? ""))
    .replaceAll("{name}", host?.name ?? "")
    .replaceAll("{date}", now.toISOString().slice(0, 10))
    .replaceAll("{time}", now.toTimeString().slice(0, 5));
}

$("#btnSnippets").addEventListener("click", () => {
  renderSnippets();
  $("#snippetModal").classList.remove("hidden");
});
$("#snippetClose").addEventListener("click", () => $("#snippetModal").classList.add("hidden"));

function renderSnippets() {
  const list = $("#snippetList");
  list.innerHTML = "";
  if (!snippets.length) {
    list.innerHTML = '<div class="section-title">Nessuno snippet salvato</div>';
  }
  for (const s of snippets) {
    const el = document.createElement("div");
    el.className = "snippet-item";
    el.innerHTML = `
      <div class="meta">
        <div class="t">${escapeHtml(s.title)}${s.group ? ` <span style="color:var(--text-2);font-weight:400">· ${escapeHtml(s.group)}</span>` : ""}</div>
        <div class="c">${escapeHtml(s.command)}</div>
      </div>
      <button class="btn small" data-run>Esegui</button>
      <button class="btn small danger" data-del>✕</button>`;
    el.querySelector("[data-run]").onclick = async () => {
      const s2 = sessions.get(activeSession);
      if (s2 && s2.status === "connected") {
        const cmd = expandSnippet(s.command, s2.host);
        await invoke("pty_write", { id: activeSession, data: cmd + "\r" });
        s2.term.focus();
      }
    };
    el.querySelector("[data-del]").onclick = async () => {
      await invoke("delete_snippet", { id: s.id });
      snippets = snippets.filter(x => x.id !== s.id);
      renderSnippets();
    };
    list.appendChild(el);
  }
}

$("#snippetAdd").addEventListener("click", async () => {
  const title = $("#s_title").value.trim();
  const command = $("#s_command").value;
  if (!title || !command) return;
  const snippet = {
    id: crypto.randomUUID(),
    title,
    command,
    group: $("#s_group").value.trim(),
  };
  await invoke("save_snippet", { snippet });
  snippets.push(snippet);
  $("#s_title").value = $("#s_group").value = $("#s_command").value = "";
  renderSnippets();
});

// ---------- SFTP ----------
let sftpHost = null;
let sftpPath = "/";

async function openSftp(host) {
  sftpHost = host;
  $("#sftpHostName").textContent = host.name || host.hostname;
  $("#sftpModal").classList.remove("hidden");
  sftpStatus("Connessione…", true);
  try {
    sftpPath = await invoke("sftp_pwd", { host });
    $("#sftpPath").value = sftpPath;
    await sftpRefresh();
  } catch (err) {
    sftpStatus("Errore: " + err, false, true);
  }
}

function sftpStatus(msg, busy = false, err = false) {
  const el = $("#sftpStatus");
  el.textContent = msg;
  el.className = "sftp-status" + (busy ? " busy" : "") + (err ? " err" : "");
}

async function sftpRefresh() {
  $("#sftpPath").value = sftpPath;
  sftpStatus("Caricamento…", true);
  try {
    const entries = await invoke("sftp_ls", { host: sftpHost, path: sftpPath });
    renderSftpList(entries);
    sftpStatus(`${entries.length} elementi — trascina file qui per caricarli`);
  } catch (err) {
    sftpStatus("Errore: " + err, false, true);
  }
}

function sftpJoin(base, name) {
  if (name === "..") {
    const parts = base.replace(/\/+$/, "").split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/");
  }
  return (base.endsWith("/") ? base : base + "/") + name;
}

function fmtSize(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + "G";
  if (n > 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n > 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function renderSftpList(entries) {
  const list = $("#sftpList");
  list.innerHTML = "";
  const up = document.createElement("div");
  up.className = "sftp-row";
  up.innerHTML = `<span class="fi">${ICONS.folder}</span><span class="fname">..</span>`;
  up.ondblclick = () => { sftpPath = sftpJoin(sftpPath, ".."); sftpRefresh(); };
  list.appendChild(up);

  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "sftp-row";
    const icon = e.is_dir ? ICONS.folder : e.is_link ? ICONS.link : ICONS.file;
    row.innerHTML = `
      <span class="fi">${icon}</span>
      <span class="fname">${escapeHtml(e.name)}</span>
      <span class="fmtime">${escapeHtml(e.mtime)}</span>
      <span class="fsize">${e.is_dir ? "—" : fmtSize(e.size)}</span>
      ${e.is_dir ? "" : '<button data-dl title="Scarica">⇩</button>'}
      <button data-del class="del" title="Elimina">✕</button>`;
    if (e.is_dir) {
      row.ondblclick = () => { sftpPath = sftpJoin(sftpPath, e.name); sftpRefresh(); };
    }
    row.querySelector("[data-dl]")?.addEventListener("click", async () => {
      const local = await dialog.save({ defaultPath: e.name });
      if (!local) return;
      sftpStatus("Download…", true);
      try {
        await invoke("sftp_get", { host: sftpHost, remote: sftpJoin(sftpPath, e.name), local });
        sftpStatus("Scaricato: " + e.name);
      } catch (err) { sftpStatus("Errore: " + err, false, true); }
    });
    row.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm(`Eliminare ${e.name}${e.is_dir ? " (cartella)" : ""}?`)) return;
      try {
        await invoke("sftp_rm", { host: sftpHost, path: sftpJoin(sftpPath, e.name), isDir: e.is_dir });
        sftpRefresh();
      } catch (err) { sftpStatus("Errore: " + err, false, true); }
    });
    list.appendChild(row);
  }
}

$("#sftpClose").addEventListener("click", () => $("#sftpModal").classList.add("hidden"));
$("#sftpRefresh").addEventListener("click", sftpRefresh);
$("#sftpUp").addEventListener("click", () => { sftpPath = sftpJoin(sftpPath, ".."); sftpRefresh(); });
$("#sftpGo").addEventListener("click", () => { sftpPath = $("#sftpPath").value.trim() || "/"; sftpRefresh(); });
$("#sftpPath").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#sftpGo").click(); });
$("#btnSftp").addEventListener("click", () => {
  const s = sessions.get(activeSession);
  if (s) openSftp(s.host);
});
$("#sftpMkdir").addEventListener("click", async () => {
  const name = prompt("Nome cartella:");
  if (!name) return;
  try {
    await invoke("sftp_mkdir", { host: sftpHost, path: sftpJoin(sftpPath, name) });
    sftpRefresh();
  } catch (err) { sftpStatus("Errore: " + err, false, true); }
});
$("#sftpUpload").addEventListener("click", async () => {
  const paths = await dialog.open({ multiple: true });
  if (!paths) return;
  await sftpUploadFiles(Array.isArray(paths) ? paths : [paths]);
});

async function sftpUploadFiles(paths) {
  for (const p of paths) {
    const name = p.split("/").pop();
    sftpStatus(`Upload ${name}…`, true);
    try {
      await invoke("sftp_put", { host: sftpHost, local: p, remote: sftpJoin(sftpPath, name) });
      sftpStatus(`Caricato: ${name}`);
    } catch (err) { sftpStatus("Errore: " + err, false, true); }
  }
  sftpRefresh();
}

const sftpListEl = $("#sftpList");
sftpListEl.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    sftpListEl.classList.add("drag-over");
  }
});
sftpListEl.addEventListener("dragleave", () => sftpListEl.classList.remove("drag-over"));
sftpListEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  sftpListEl.classList.remove("drag-over");
  const files = [...e.dataTransfer.files].map(f => f.path ?? f.name).filter(Boolean);
  if (files.length) await sftpUploadFiles(files);
});

// ---------- Pannello server ----------
let srvHost = null;
let srvTab = "health";
let srvDomains = [];
let srvTimer = null;

function srvAuto() {
  clearInterval(srvTimer);
  srvTimer = null;
  if ($("#srvModal").classList.contains("hidden")) return;
  if (["health", "services"].includes(srvTab)) {
    srvTimer = setInterval(() => {
      if ($("#srvModal").classList.contains("hidden")) {
        clearInterval(srvTimer);
        return;
      }
      srvLoad();
    }, 15000);
  }
}

// riuso lo stile sftp-status
function sftpStatusEl(el) {
  return (msg, busy = false, err = false) => {
    el.textContent = msg;
    el.className = "sftp-status" + (busy ? " busy" : "") + (err ? " err" : "");
  };
}
const srvSetStatus = sftpStatusEl($("#srvStatus"));

async function openServerPanel(host) {
  srvHost = host;
  $("#srvHostName").textContent = host.name || host.hostname;
  $("#srvModal").classList.remove("hidden");
  srvLoad();
  srvAuto();
}

function srvLoad() {
  switch (srvTab) {
    case "health": srvHealth(); break;
    case "services": srvServices(); break;
    case "fail2ban": srvFail2ban(); break;
    case "domains": srvDomainsLoad(); break;
    case "wp": srvWp(); break;
    case "logs": srvLogsInit(); break;
  }
}

$$(".srv-tab").forEach(b => b.addEventListener("click", () => {
  $$(".srv-tab").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  srvTab = b.dataset.tab;
  $$(".srv-pane").forEach(p => p.classList.add("hidden"));
  $(`#srv-${srvTab}`).classList.remove("hidden");
  srvLoad();
  srvAuto();
}));
$("#srvRefresh").addEventListener("click", srvLoad);
$("#srvClose").addEventListener("click", () => {
  $("#srvModal").classList.add("hidden");
  clearInterval(srvTimer);
});
$("#btnSrv").addEventListener("click", () => {
  const s = sessions.get(activeSession);
  if (s) openServerPanel(s.host);
});

// Power remoto con conferma
async function srvPower(action) {
  const label = action === "reboot" ? "Riavviare" : "Spegnere";
  const ok = await dialog.confirm(`${label} ${srvHost.name || srvHost.hostname}? Le sessioni si chiuderanno.`, { title: "Conferma", kind: "warning" });
  if (!ok) return;
  try {
    const msg = await invoke("server_power", { host: srvHost, action });
    srvSetStatus(msg);
  } catch (e) { srvSetStatus("Errore: " + e, false, true); }
}
$("#srvReboot").addEventListener("click", () => srvPower("reboot"));
$("#srvPowerOff").addEventListener("click", () => srvPower("poweroff"));

async function srvHealth() {
  const el = $("#srv-health");
  srvSetStatus("Raccolgo metriche…", true);
  try {
    const h = await invoke("server_health", { host: srvHost });
    const loadPct = Math.min(100, Math.round((h.load[0] / Math.max(1, h.nproc)) * 100));
    const memPct = h.mem_total_mb ? Math.round((h.mem_used_mb / h.mem_total_mb) * 100) : 0;
    const bar = (pct) => `<div class="srv-bar${pct > 85 ? " hot" : ""}"><i style="width:${pct}%"></i></div>`;
    el.innerHTML = `
      <div class="srv-grid">
        <div class="srv-metric"><div class="lbl">Host</div><div class="val" style="font-size:14px">${escapeHtml(h.hostname)}</div><div class="sub2">up ${escapeHtml(h.uptime)}</div></div>
        <div class="srv-metric"><div class="lbl">Load 1/5/15 (${h.nproc} core)</div><div class="val">${h.load.map(x => x.toFixed(2)).join(" · ")}</div>${bar(loadPct)}<div class="sub2">${loadPct}% del carico</div></div>
        <div class="srv-metric"><div class="lbl">RAM</div><div class="val">${memPct}%</div>${bar(memPct)}<div class="sub2">${h.mem_used_mb}M / ${h.mem_total_mb}M (disp. ${h.mem_avail_mb}M)</div></div>
        <div class="srv-metric"><div class="lbl">Dischi</div>
          ${h.disks.map(d => `<div class="sub2" style="display:flex;justify-content:space-between"><span>${escapeHtml(d.mount)}</span><span>${d.used_pct}% di ${escapeHtml(d.size)} (liberi ${escapeHtml(d.avail)})</span></div>${bar(d.used_pct)}`).join("")}
        </div>
      </div>`;
    srvSetStatus("");
  } catch (e) { srvSetStatus("Errore: " + e, false, true); }
}

async function srvServices() {
  const el = $("#srv-services");
  srvSetStatus("Leggo i servizi…", true);
  try {
    const list = await invoke("service_list", { host: srvHost });
    el.innerHTML = `<table class="srv-table"><tr><th>Servizio</th><th>Stato</th><th></th></tr>` +
      list.map(s => `<tr><td class="mono">${escapeHtml(s.name)}</td>
        <td><span class="st ${s.status === "active" ? "active" : (s.status === "inactive" || s.status === "failed" ? "failed" : "other")}"></span>${escapeHtml(s.status)}</td>
        <td><button class="btn small" data-restart="${escapeHtml(s.name)}">Riavvia</button></td></tr>`).join("") +
      `</table>`;
    el.querySelectorAll("[data-restart]").forEach(b => b.addEventListener("click", async () => {
      const name = b.dataset.restart;
      b.disabled = true;
      srvSetStatus(`Riavvio ${name}…`, true);
      try {
        const msg = await invoke("service_restart", { host: srvHost, name });
        srvSetStatus(`${name}: ${msg}`);
      } catch (e) { srvSetStatus("Errore: " + e, false, true); }
      b.disabled = false;
      srvServices();
    }));
    srvSetStatus(list.length ? "" : "Nessun servizio noto trovato (serve root/sudo?)");
  } catch (e) { srvSetStatus("Errore: " + e, false, true); }
}

async function srvFail2ban() {
  const el = $("#srv-fail2ban");
  srvSetStatus("Leggo i ban…", true);
  try {
    const list = await invoke("fail2ban_status", { host: srvHost });
    if (!list.length) {
      el.innerHTML = '<div class="section-title">Nessun IP bannato</div>';
    } else {
      el.innerHTML = `<table class="srv-table"><tr><th>Jail</th><th>IP</th><th></th></tr>` +
        list.map(b => `<tr><td class="mono">${escapeHtml(b.jail)}</td><td class="mono">${escapeHtml(b.ip)}</td>
          <td><button class="btn small" data-unban="${escapeHtml(b.ip)}">Unban</button></td></tr>`).join("") + `</table>`;
      el.querySelectorAll("[data-unban]").forEach(b => b.addEventListener("click", async () => {
        const ip = b.dataset.unban;
        b.disabled = true;
        try {
          const msg = await invoke("fail2ban_unban", { host: srvHost, ip });
          srvSetStatus(msg);
        } catch (e) { srvSetStatus("Errore: " + e, false, true); }
        srvFail2ban();
      }));
    }
    srvSetStatus("");
  } catch (e) { srvSetStatus("Errore: " + e, false, true); }
}

async function srvDomainsLoad() {
  const el = $("#srvDomList");
  srvSetStatus("Leggo i domini Plesk…", true);
  try {
    const list = await invoke("plesk_domains", { host: srvHost });
    srvDomains = list;
    if (!list.length) {
      el.innerHTML = '<div class="section-title">Nessun dominio — Plesk non trovato o permessi insufficienti</div>';
    } else {
      el.innerHTML = `<table class="srv-table"><tr><th>Dominio</th><th>Stato</th><th></th></tr>` +
        list.map(d => `<tr><td class="mono">${escapeHtml(d.name)}</td><td>${escapeHtml(d.status)}</td>
          <td><button class="btn small" data-ssl="${escapeHtml(d.name)}">SSL</button></td></tr>`).join("") + `</table>`;
      el.querySelectorAll("[data-ssl]").forEach(b => b.addEventListener("click", async () => {
        const domain = b.dataset.ssl;
        b.disabled = true;
        srvSetStatus(`Let's Encrypt su ${domain}…`, true);
        try {
          const msg = await invoke("plesk_ssl", { host: srvHost, domain, email: "" });
          srvSetStatus(`${domain}: ${msg}`);
        } catch (e) { srvSetStatus("Errore: " + e, false, true); }
        b.disabled = false;
      }));
    }
    // piani di servizio per il form crea-dominio
    try {
      const plans = await invoke("plesk_service_plans", { host: srvHost });
      $("#srvDomPlan").innerHTML = '<option value="">(piano default)</option>' +
        plans.map(p => `<option>${escapeHtml(p)}</option>`).join("");
    } catch {}
    srvSetStatus("");
  } catch (e) { srvSetStatus("Errore: " + e, false, true); }
}

$("#srvDomNew").addEventListener("click", () => $("#srvDomForm").classList.toggle("hidden"));
$("#srvDomCreate").addEventListener("click", async () => {
  const domain = $("#srvDomName").value.trim();
  const login = $("#srvDomLogin").value.trim();
  const passwd = $("#srvDomPass").value;
  if (!domain || !login || !passwd) { srvSetStatus("Compila dominio, utente e password", false, true); return; }
  srvSetStatus(`Creo ${domain}…`, true);
  try {
    const msg = await invoke("plesk_create_domain", {
      host: srvHost, domain, plan: $("#srvDomPlan").value, login, passwd,
    });
    srvSetStatus(msg);
    $("#srvDomForm").classList.add("hidden");
    $("#srvDomName").value = $("#srvDomLogin").value = $("#srvDomPass").value = "";
    srvDomainsLoad();
  } catch (e) { srvSetStatus("Errore: " + e, false, true); }
});

async function srvWp() {
  const el = $("#srv-wp");
  srvSetStatus("Cerco istanze WordPress…", true);
  try {
    const list = await invoke("wp_instances", { host: srvHost });
    if (!list.length) {
      el.innerHTML = '<div class="section-title">Nessuna istanza WP (o WP Toolkit non installato)</div>';
    } else {
      el.innerHTML = `<table class="srv-table"><tr><th>ID</th><th>Sito</th><th>Info</th><th></th></tr>` +
        list.map(w => `<tr><td class="mono">${escapeHtml(w.id)}</td><td class="mono">${escapeHtml(w.url)}</td>
          <td>${escapeHtml(w.info)}</td>
          <td><button class="btn small" data-admin="${escapeHtml(w.url)}">wp-admin</button>
              <button class="btn small" data-wpup="${escapeHtml(w.id)}">Aggiorna</button></td></tr>`).join("") + `</table>`;
      el.querySelectorAll("[data-admin]").forEach(b => b.addEventListener("click", () => {
        invoke("open_url", { url: b.dataset.admin.replace(/\/+$/, "") + "/wp-admin" })
          .catch(e => srvSetStatus("" + e, false, true));
      }));
      el.querySelectorAll("[data-wpup]").forEach(b => b.addEventListener("click", async () => {
        b.disabled = true;
        srvSetStatus(`Aggiornamento istanza ${b.dataset.wpup}…`, true);
        try {
          const out = await invoke("wp_update", { host: srvHost, id: b.dataset.wpup });
          srvSetStatus(out.split("\n").filter(Boolean).pop() || "Aggiornato");
        } catch (e) { srvSetStatus("Errore: " + e, false, true); }
        b.disabled = false;
      }));
    }
    srvSetStatus("");
  } catch (e) { srvSetStatus("Errore: " + e, false, true); }
}

async function srvLogsInit() {
  // popola il select coi path comuni dei domini
  const sel = $("#srvLogPath");
  sel.innerHTML = "";
  const opts = [];
  if (srvDomains.length === 0) {
    try { srvDomains = await invoke("plesk_domains", { host: srvHost }); } catch {}
  }
  for (const d of srvDomains) {
    opts.push([`/var/www/vhosts/${d.name}/logs/error_log`, `${d.name} — error_log`]);
    opts.push([`/var/www/vhosts/${d.name}/logs/access_log`, `${d.name} — access_log`]);
  }
  opts.push(["/var/log/plesk/panel.log", "Plesk panel.log"]);
  opts.push(["/var/log/messages", "messages"]);
  opts.push(["/var/log/syslog", "syslog"]);
  opts.push(["__custom__", "(path personalizzato…)"]);
  for (const [v, t] of opts) {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  }
  srvSetStatus("Scegli un log e premi Carica");
}

$("#srvLogPath").addEventListener("change", (e) => {
  $("#srvLogCustom").classList.toggle("hidden", e.target.value !== "__custom__");
});
$("#srvLogLoad").addEventListener("click", async () => {
  let path = $("#srvLogPath").value;
  if (path === "__custom__") path = $("#srvLogCustom").value.trim();
  if (!path) return;
  const lines = parseInt($("#srvLogLines").value) || 200;
  const out = $("#srvLogOut");
  out.textContent = "caricamento…";
  srvSetStatus("Leggo il log…", true);
  try {
    out.textContent = await invoke("read_log", { host: srvHost, path, lines });
    srvSetStatus("");
    out.scrollTop = out.scrollHeight;
  } catch (e) {
    out.textContent = "";
    srvSetStatus("Errore: " + e, false, true);
  }
});

// ---------- Impostazioni ----------
function renderGroupThemes() {
  const el = $("#stGroupThemes");
  const groups = [...new Set(hosts.map(h => h.group).filter(Boolean))].sort();
  if (!groups.length) {
    el.innerHTML = '<div class="section-title">Nessun gruppo definito</div>';
    return;
  }
  el.innerHTML = "";
  const opts = Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  for (const g of groups) {
    const row = document.createElement("div");
    row.className = "gt-row";
    row.innerHTML = `<span class="gname mono">${escapeHtml(g)}</span>
      <select data-group="${escapeHtml(g)}"><option value="">(globale)</option>${opts}</select>`;
    row.querySelector("select").value = settings.group_themes?.[g] || "";
    el.appendChild(row);
  }
}

$("#btnSettings").addEventListener("click", () => {
  $("#st_theme").value = settings.theme || "termilal";
  $("#st_copy").checked = settings.copy_on_select !== false;
  $("#st_paste").checked = !!settings.right_click_paste;
  $("#st_log").checked = !!settings.log_sessions;
  $("#st_notify").checked = settings.notify_disconnect !== false;
  $("#st_lock").checked = !!settings.lock_on_start;
  $("#st_locktimeout").value = String(settings.lock_timeout_min || 0);
  $("#st_fontsize").value = settings.font_size || 13;
  $("#st_bright").value = String(settings.brightness ?? 2);
  renderGroupThemes();
  $("#settingsModal").classList.remove("hidden");
});

$("#settingsSave").addEventListener("click", async () => {
  const groupThemes = {};
  $$("#stGroupThemes select[data-group]").forEach(sel => {
    if (sel.value) groupThemes[sel.dataset.group] = sel.value;
  });
  settings = {
    ...settings,
    theme: $("#st_theme").value,
    copy_on_select: $("#st_copy").checked,
    right_click_paste: $("#st_paste").checked,
    log_sessions: $("#st_log").checked,
    notify_disconnect: $("#st_notify").checked,
    lock_on_start: $("#st_lock").checked,
    lock_timeout_min: parseInt($("#st_locktimeout").value) || 0,
    font_size: Math.min(24, Math.max(9, parseInt($("#st_fontsize").value) || 13)),
    brightness: parseInt($("#st_bright").value) || 2,
    group_themes: groupThemes,
  };
  await invoke("save_settings", { settings });
  applySettings();
  $("#settingsModal").classList.add("hidden");
});

$("#settingsLockNow").addEventListener("click", () => {
  $("#settingsModal").classList.add("hidden");
  lockScreen();
});

// ---------- Lock / Touch ID ----------
function lockScreen() {
  if (locked) return;
  locked = true;
  $("#lockScreen").classList.remove("hidden");
}

async function tryUnlock() {
  try {
    const ok = await invoke("touch_id_auth");
    if (ok) {
      locked = false;
      lastActivity = Date.now();
      $("#lockScreen").classList.add("hidden");
    }
  } catch (err) {
    // helper assente o LA non disponibile → sblocca comunque
    locked = false;
    $("#lockScreen").classList.add("hidden");
    console.warn("auth:", err);
  }
}
$("#btnUnlock").addEventListener("click", tryUnlock);

// auto-lock su inattività
["mousemove", "keydown", "mousedown"].forEach(ev =>
  document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true })
);
setInterval(() => {
  const min = settings.lock_timeout_min || 0;
  if (!locked && min > 0 && Date.now() - lastActivity > min * 60000) lockScreen();
}, 10000);

// ---------- Quick connect ⌘K ----------
let paletteIdx = 0;
function openPalette() {
  $("#palette").classList.remove("hidden");
  $("#paletteInput").value = "";
  renderPalette();
  $("#paletteInput").focus();
}
function closePalette() { $("#palette").classList.add("hidden"); }

function paletteHosts() {
  const q = $("#paletteInput").value.trim().toLowerCase();
  return q
    ? hosts.filter(h => [h.name, h.hostname, h.username, h.group].some(v => fuzzyMatch(q, v)))
    : sortedHosts(hosts);
}

function renderPalette() {
  const list = $("#paletteList");
  const items = paletteHosts();
  paletteIdx = Math.min(paletteIdx, Math.max(0, items.length - 1));
  list.innerHTML = "";
  items.slice(0, 12).forEach((h, i) => {
    const el = document.createElement("div");
    el.className = "palette-item" + (i === paletteIdx ? " sel" : "");
    el.innerHTML = `
      <span class="pi">${authIcon(h)}</span>
      <span style="min-width:0;flex:1">
        <div class="pname">${escapeHtml(h.name || h.hostname)}</div>
        <div class="sub">${escapeHtml(h.username ? h.username + "@" : "")}${escapeHtml(h.hostname)}${h.group ? " · " + escapeHtml(h.group) : ""}</div>
      </span>`;
    el.onclick = () => { closePalette(); openSession(h); };
    el.onmousemove = () => { paletteIdx = i; renderPalette(); };
    list.appendChild(el);
  });
  if (!items.length) {
    list.innerHTML = '<div class="section-title">Nessun host trovato</div>';
  }
}

$("#paletteInput").addEventListener("input", () => { paletteIdx = 0; renderPalette(); });
$("#paletteInput").addEventListener("keydown", (e) => {
  const items = paletteHosts();
  if (e.key === "ArrowDown") { e.preventDefault(); paletteIdx = Math.min(paletteIdx + 1, items.length - 1); renderPalette(); }
  if (e.key === "ArrowUp") { e.preventDefault(); paletteIdx = Math.max(paletteIdx - 1, 0); renderPalette(); }
  if (e.key === "Enter" && items[paletteIdx]) { closePalette(); openSession(items[paletteIdx]); }
  if (e.key === "Escape") closePalette();
});
$("#palette").addEventListener("click", (e) => {
  if (e.target === $("#palette")) closePalette();
});

// ---------- known_hosts ----------
async function openKhModal() {
  const el = $("#khList");
  try {
    const list = await invoke("known_hosts_list");
    if (!list.length) {
      el.innerHTML = '<div class="section-title">known_hosts vuoto</div>';
    } else {
      el.innerHTML = list.map(k => `
        <div class="snippet-item">
          <div class="meta">
            <div class="t">${escapeHtml(k.host)}</div>
            <div class="c">${escapeHtml(k.algo)}${k.hashed ? " · hashed" : ""}</div>
          </div>
          ${k.hashed ? "" : `<button class="btn small danger" data-kh="${escapeHtml(k.host)}">✕</button>`}
        </div>`).join("");
      el.querySelectorAll("[data-kh]").forEach(b => b.addEventListener("click", async () => {
        try { await invoke("known_hosts_delete", { pattern: b.dataset.kh }); } catch {}
        openKhModal();
      }));
    }
  } catch (e) {
    el.innerHTML = `<div class="section-title">Errore: ${escapeHtml(String(e))}</div>`;
  }
  $("#khModal").classList.remove("hidden");
}
$("#khClose").addEventListener("click", () => $("#khModal").classList.add("hidden"));

// ---------- Editor ~/.ssh/config ----------
async function openSshConfigEditor() {
  try {
    $("#sshConfigText").value = await invoke("read_ssh_config");
  } catch {
    $("#sshConfigText").value = "";
  }
  $("#sshConfigModal").classList.remove("hidden");
}
$("#sshConfigCancel").addEventListener("click", () => $("#sshConfigModal").classList.add("hidden"));
$("#sshConfigSave").addEventListener("click", async () => {
  try {
    await invoke("write_ssh_config", { text: $("#sshConfigText").value });
    $("#sshConfigModal").classList.add("hidden");
    alert("Salvato (backup in ~/.ssh/config.bak).");
  } catch (err) {
    alert("Errore: " + err);
  }
});

// ---------- Import/Export ----------
$("#btnIO").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#ioMenu").classList.toggle("open");
});

$("#ioMenu").addEventListener("click", async (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  $("#ioMenu").classList.remove("open");
  try {
    switch (action) {
      case "ssh-config": {
        const [total, added] = await invoke("import_ssh_config");
        alert(`Letti ${total} host in ~/.ssh/config, importati ${added} nuovi.`);
        await loadStore();
        break;
      }
      case "known-hosts": {
        const n = await invoke("import_known_hosts");
        alert(`Importati ${n} host da known_hosts.`);
        await loadStore();
        break;
      }
      case "edit-config": openSshConfigEditor(); break;
      case "known-manager": openKhModal(); break;
      case "logs": await invoke("open_logs_dir"); break;
      case "restore": {
        if (!confirm("Ripristinare l'ultimo backup dello store? Le modifiche recenti andranno perse.")) return;
        await invoke("restore_backup");
        await loadStore();
        break;
      }
      case "import": {
        const path = await dialog.open({
          filters: [{ name: "Terminal Velocity", extensions: ["json", "csv"] }],
          multiple: false,
        });
        if (!path) return;
        if (path.endsWith(".json")) {
          const [nHosts, snips] = await invoke("import_json", { path });
          alert(`Importati ${nHosts} host, ${snips} snippet.`);
        } else {
          const n = await invoke("import_csv", { path });
          alert(`Importati ${n} host.`);
        }
        await loadStore();
        break;
      }
      case "export": {
        const path = await dialog.save({
          filters: [{ name: "JSON", extensions: ["json"] }],
          defaultPath: "termilal-export.json",
        });
        if (!path) return;
        await invoke("export_json", { path });
        alert("Esportazione completata.");
        break;
      }
    }
  } catch (err) {
    alert("Errore: " + err);
  }
});

// ---------- Bottoni + scorciatoie ----------
$("#btnNewHost").addEventListener("click", () => openHostModal(null));
$("#emptyNewHost").addEventListener("click", () => openHostModal(null));
$("#search").addEventListener("input", renderHostList);

// ---------- Font size ⌘+/⌘-/⌘0 ----------
function adjustFontSize(d) {
  const cur = settings.font_size || 13;
  settings.font_size = d === 0 ? 13 : Math.min(24, Math.max(9, cur + d));
  for (const [, s] of sessions) {
    s.term.options.fontSize = settings.font_size;
    try { s.fit.fit(); } catch {}
  }
  invoke("save_settings", { settings }).catch(() => {});
}

document.addEventListener("keydown", (e) => {
  if (locked) return;
  if (e.metaKey && e.key === "n") { e.preventDefault(); openHostModal(null); }
  if (e.metaKey && e.key === "k") { e.preventDefault(); openPalette(); }
  if (e.metaKey && e.key === "f" && sessions.size > 0) { e.preventDefault(); toggleFind(); }
  if (e.metaKey && (e.key === "=" || e.key === "+")) { e.preventDefault(); adjustFontSize(1); }
  if (e.metaKey && e.key === "-") { e.preventDefault(); adjustFontSize(-1); }
  if (e.metaKey && e.key === "0") { e.preventDefault(); adjustFontSize(0); }
  if (e.key === "Escape") {
    $$(".modal").forEach(m => m.classList.add("hidden"));
    $("#ctxMenu").classList.add("hidden");
    closePalette();
  }
});

populateThemeSelects();
loadStore().then(() => {
  if (settings.lock_on_start) lockScreen();
});
renderTabs();
