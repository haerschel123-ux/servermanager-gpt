/* Kernlogik: API, Tabs, Einrichtung, Server-Tab, Loot-Tab */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const App = {
  state: { configured: false, demo: false, tile_url: "" },
  setupToken: "",
};
window.App = App;

/* ------------------------------------------------------------------ API
 * Zwei Betriebsarten:
 *  - "server": Seite kommt vom lokalen Python-Server (server.py auf dem PC)
 *  - "direct": Seite ist statisch gehostet (GitHub Pages / Handy pur) und
 *              spricht die Nitrado-API direkt aus dem Browser an (direct.js)
 */

let apiMode = "server";
let pendingRequests = 0;

function setLoading(delta) {
  pendingRequests = Math.max(0, pendingRequests + delta);
  const indicator = $("#loading");
  if (indicator) indicator.classList.toggle("hidden", pendingRequests === 0);
}

async function detectApiMode() {
  try {
    const resp = await fetch("api/state");
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data.configured === "boolean") return "server";
    }
  } catch (e) { /* kein lokaler Server – statisch gehostet */ }
  return "direct";
}

async function api(path, body) {
  setLoading(1);
  try {
    if (apiMode === "direct") return await DirectMode.call(path, body);
    const opts = body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" } };
    const resp = await fetch(path, opts);
    let data = {};
    try { data = await resp.json(); } catch (e) { /* leere Antwort */ }
    if (!resp.ok) throw new Error(data.error || ("HTTP " + resp.status));
    return data;
  } finally {
    setLoading(-1);
  }
}

/* ---------------------------------------------------------------- Toasts */

function toast(message, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = message;
  $("#toast-wrap").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 9000 : 5000);
}

/* ------------------------------------------------------------------ Tabs */

$$("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#tabs button").forEach((b) => b.classList.remove("active"));
    $$(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "map" && window.DayZMap) DayZMap.refreshSize();
    if (btn.dataset.tab === "server") refreshServerStatus();
    if (btn.dataset.tab === "loot" && !Loot.loaded) Loot.load();
    if (btn.dataset.tab === "tools" && window.Tools) Tools.init();
  });
});

/* ------------------------------------------------------------ Einrichtung */

function showSetup(settingsOnly) {
  $("#setup-overlay").classList.remove("hidden");
  $("#setup-step2").classList.add("hidden");
  $("#setup-error").classList.add("hidden");
  $("#setup-step1").classList.toggle("hidden", !!settingsOnly);
  $("#setup-settings").classList.toggle("hidden", !settingsOnly);
  $("#btn-setup-close").classList.toggle("hidden", !App.state.configured);
  $("#setup-tileurl").value = App.state.tile_url || "";
  const showBackups = !!settingsOnly && apiMode === "direct";
  $("#backup-section").classList.toggle("hidden", !showBackups);
  if (showBackups) DirectMode.renderBackups($("#backup-list"));
}

function setupError(msg) {
  const el = $("#setup-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

$("#btn-settings").addEventListener("click", () => showSetup(true));
$("#btn-setup-close").addEventListener("click", () =>
  $("#setup-overlay").classList.add("hidden"));
$("#btn-setup-back").addEventListener("click", () => {
  $("#setup-step2").classList.add("hidden");
  $("#setup-step1").classList.remove("hidden");
});

$("#btn-setup-next").addEventListener("click", async () => {
  const token = $("#setup-token").value.trim();
  if (!token) return setupError("Bitte zuerst den API-Token einfügen.");
  $("#setup-error").classList.add("hidden");
  $("#btn-setup-next").disabled = true;
  try {
    const data = await api("/api/setup/token", { token });
    App.setupToken = token;
    const wrap = $("#setup-services");
    wrap.innerHTML = "";
    if (!data.services.length) {
      return setupError("Auf diesem Nitrado-Konto wurden keine Server gefunden.");
    }
    data.services.forEach((svc) => {
      const div = document.createElement("div");
      div.className = "service";
      div.innerHTML = "<b>" + esc(svc.name) + "</b>" +
        (svc.is_dayz ? " 🧟" : "") +
        "<small>" + esc(svc.game || "unbekanntes Spiel") +
        (svc.address ? " · " + esc(svc.address) : "") + "</small>";
      div.addEventListener("click", () => selectService(svc.id));
      wrap.appendChild(div);
    });
    $("#setup-step1").classList.add("hidden");
    $("#setup-step2").classList.remove("hidden");
  } catch (err) {
    setupError(err.message);
  } finally {
    $("#btn-setup-next").disabled = false;
  }
});

async function selectService(id) {
  $("#setup-error").classList.add("hidden");
  try {
    toast("Verbinde… suche Missionsordner auf dem Server…");
    App.state = await api("/api/setup/select",
      { token: App.setupToken, service_id: id });
    App.setupToken = "";
    $("#setup-token").value = "";
    $("#setup-overlay").classList.add("hidden");
    toast("Verbunden! Missionsordner: " + App.state.mission_dir);
    afterConfigured();
  } catch (err) {
    setupError(err.message);
  }
}

$("#btn-settings-save").addEventListener("click", async () => {
  try {
    App.state = await api("/api/settings",
      { tile_url: $("#setup-tileurl").value });
    $("#setup-overlay").classList.add("hidden");
    toast("Einstellungen gespeichert.");
    if (window.DayZMap) DayZMap.applyTiles(App.state.tile_url);
  } catch (err) {
    setupError(err.message);
  }
});

$("#btn-server-change").addEventListener("click", () => {
  $("#setup-settings").classList.add("hidden");
  $("#setup-step2").classList.add("hidden");
  $("#setup-step1").classList.remove("hidden");
  $("#setup-token").value = "";
  $("#setup-token").focus();
  toast("API-Token erneut eingeben und den gewünschten Server auswählen.");
});

/* ------------------------------------------------------------ Server-Tab */

async function refreshServerStatus() {
  const box = $("#server-status");
  try {
    const s = await api("/api/server/status");
    const rows = [
      ["Status", '<span class="status-' + esc(s.status) + '">' + esc(s.status) + "</span>"],
      ["Spiel", esc(s.game || "–")],
      ["Servername", esc(s.server_name || "–")],
      ["Spieler", (s.player_current ?? "?") + " / " + (s.player_max ?? "?")],
    ];
    box.innerHTML = rows.map(([k, v]) =>
      '<div class="row"><span class="k">' + k + "</span><span>" + v + "</span></div>").join("");
    const pill = $("#status-pill");
    const prefix = App.state.demo ? "DEMO · " : (apiMode === "direct" ? "📱 " : "");
    pill.textContent = prefix + s.status;
    pill.className = "pill " + (s.status === "started" ? "ok" : "bad");
  } catch (err) {
    box.textContent = "Status nicht verfügbar: " + err.message;
  }
}

$("#btn-refresh-status").addEventListener("click", refreshServerStatus);

$("#btn-restart").addEventListener("click", async () => {
  if (!confirm("Server jetzt wirklich neu starten?\nAlle Spieler werden getrennt.")) return;
  try {
    await api("/api/server/restart", {});
    toast("Neustart wurde ausgelöst. Das dauert meist 2–5 Minuten.");
    setTimeout(refreshServerStatus, 3000);
  } catch (err) { toast(err.message, "error"); }
});

$("#btn-stop").addEventListener("click", async () => {
  if (!confirm("Server jetzt wirklich stoppen?")) return;
  try {
    await api("/api/server/stop", {});
    toast("Server wird gestoppt.");
    setTimeout(refreshServerStatus, 3000);
  } catch (err) { toast(err.message, "error"); }
});

/* -------------------------------------------------------------- Loot-Tab */

const Loot = {
  loaded: false,
  items: [],
  changes: {},   // {name: {feld: wert}}

  async load() {
    try {
      const data = await api("/api/types");
      this.items = data.types;
      this.loaded = true;
      this.render();
    } catch (err) {
      toast("types.xml konnte nicht geladen werden: " + err.message, "error");
    }
  },

  render() {
    const filter = $("#loot-search").value.trim().toLowerCase();
    const tbody = $("#loot-table tbody");
    tbody.innerHTML = "";
    const fields = ["nominal", "min", "lifetime", "restock", "quantmin", "quantmax"];
    let shown = 0;
    for (const item of this.items) {
      if (filter && !item.name.toLowerCase().includes(filter)) continue;
      if (++shown > 500) break;  // Performance-Schutz bei riesigen Listen
      const tr = document.createElement("tr");
      tr.innerHTML = "<td class='mono'>" + esc(item.name) + "</td><td>" +
        esc(item.category || "–") + "</td>";
      for (const field of fields) {
        const td = document.createElement("td");
        if (item[field] === null) {
          td.textContent = "–";
        } else {
          const input = document.createElement("input");
          input.type = "number";
          input.value = this.changes[item.name]?.[field] ?? item[field];
          input.addEventListener("input", () => {
            const orig = item[field];
            if (input.value !== "" && Number(input.value) !== orig) {
              (this.changes[item.name] ??= {})[field] = Number(input.value);
              input.classList.add("changed");
            } else {
              if (this.changes[item.name]) {
                delete this.changes[item.name][field];
                if (!Object.keys(this.changes[item.name]).length)
                  delete this.changes[item.name];
              }
              input.classList.remove("changed");
            }
            this.updateBar();
          });
          td.appendChild(input);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  },

  updateBar() {
    const n = Object.keys(this.changes).length;
    $("#btn-loot-save").disabled = n === 0;
    const badge = $("#loot-changed");
    badge.classList.toggle("hidden", n === 0);
    badge.textContent = "● " + n + " Item(s) geändert";
  },

  async save() {
    try {
      const result = await api("/api/types", { updates: this.changes });
      toast("types.xml gespeichert (Backup wurde angelegt). Änderungen gelten nach dem nächsten Neustart.");
      if (result.missing?.length)
        toast("Nicht gefunden: " + result.missing.join(", "), "warn");
      this.changes = {};
      this.loaded = false;
      await this.load();
      this.updateBar();
    } catch (err) {
      toast("Speichern fehlgeschlagen: " + err.message, "error");
    }
  },
};
window.Loot = Loot;

$("#loot-search").addEventListener("input", () => Loot.render());
$("#btn-loot-save").addEventListener("click", () => Loot.save());

/* ------------------------------------------------------------------ Start */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Karte aus dem Missionsordner erkennen (dayzOffline.enoch / .sakhal / …) */
function detectMapKey(missionDir) {
  const dir = (missionDir || "").toLowerCase();
  if (dir.includes(".enoch")) return "enoch";
  if (dir.includes(".sakhal")) return "sakhal";
  return "chernarusplus";
}

function afterConfigured() {
  refreshServerStatus();
  if (window.DayZMap) {
    DayZMap.setMap(App.state.map || detectMapKey(App.state.mission_dir), false);
    DayZMap.applyTiles(App.state.tile_url);
    DayZMap.loadData();
  }
  if (window.Files) Files.openDir(App.state.mission_dir || App.state.root_dir);
}

/* ----------------------------------------------------- App-Installation */

let installPrompt = null;
const standalone = () => window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

function showInstallTip() {
  if (standalone() || localStorage.getItem("dayz-manager-install-tip") === "hidden") return;
  $("#install-tip").classList.remove("hidden");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("#btn-install").classList.remove("hidden");
  showInstallTip();
});

$("#btn-install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#install-tip").classList.add("hidden");
});

$("#btn-install-help").addEventListener("click", () => {
  alert("Android/Chrome: Browser-Menü ⋮ → „Zum Startbildschirm hinzufügen“.\n\n" +
        "iPhone/Safari: Teilen-Symbol □↑ → „Zum Home-Bildschirm“.");
});

$("#btn-install-close").addEventListener("click", () => {
  localStorage.setItem("dayz-manager-install-tip", "hidden");
  $("#install-tip").classList.add("hidden");
});

async function init() {
  apiMode = await detectApiMode();
  try {
    App.state = await api("/api/state");
  } catch (err) {
    toast("Backend nicht erreichbar: " + err.message, "error");
    return;
  }
  if (window.DayZMap) DayZMap.create();
  if (App.state.configured) {
    afterConfigured();
  } else {
    $("#status-pill").textContent = "nicht verbunden";
    showSetup(false);
  }
  setTimeout(showInstallTip, 1200);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Die App funktioniert auch ohne Offline-Cache vollständig.
    });
  }
}

window.addEventListener("DOMContentLoaded", init);
