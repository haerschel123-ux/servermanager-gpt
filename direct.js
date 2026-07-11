/* Direkt-Modus: läuft komplett im Browser (Handy!), ohne Python-Server.
 *
 * Wird aktiv, wenn die Seite statisch gehostet ist (z.B. GitHub Pages).
 * Spricht die Nitrado-API direkt an (sie erlaubt Browser-Zugriff per CORS),
 * bildet dieselben /api/…-Routen nach wie server.py und sichert vor jedem
 * Speichern ein Backup in der Browser-Datenbank (IndexedDB) dieses Geräts.
 * Der API-Token bleibt ausschließlich im localStorage dieses Geräts.
 */
"use strict";

const DirectMode = (() => {
  const NITRADO = "https://api.nitrado.net";
  const CFG_KEY = "dayz-manager-cfg";
  const MISSION_FILES = {
    playerspawns: "cfgplayerspawnpoints.xml",
    events: "cfgeventspawns.xml",
    gameplay: "cfggameplay.json",
    objects: "mapobjects.json",
    types: "db/types.xml",
  };
  const SPAWN_SECTIONS = ["fresh", "hop", "travel"];

  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); } catch (e) { cfg = {}; }
  const saveCfg = () => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));

  /* ------------------------------------------------------- Nitrado-API */

  async function nitrado(token, method, path, params, form) {
    const url = new URL(NITRADO + path);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const opts = { method, headers: { Authorization: "Bearer " + token } };
    if (form) opts.body = new URLSearchParams(form);
    let resp;
    try {
      resp = await fetch(url, opts);
    } catch (e) {
      throw new Error("Keine Verbindung zur Nitrado-API (Internet aus?).");
    }
    let data = {};
    try { data = await resp.json(); } catch (e) { /* leere Antwort */ }
    if (resp.status === 401) {
      throw new Error("Nitrado hat den API-Token abgelehnt (401). Bitte Token " +
                      "prüfen – er braucht mindestens den Bereich 'service'.");
    }
    if (!resp.ok) {
      throw new Error("Nitrado-API-Fehler " + resp.status +
                      (data.message ? ": " + data.message : ""));
    }
    return data;
  }

  async function fileList(token, serviceId, dir) {
    const data = await nitrado(token, "GET",
      `/services/${serviceId}/gameservers/file_server/list`, { dir });
    return (data.data && data.data.entries) || [];
  }

  async function fileRead(path) {
    const data = await nitrado(cfg.token, "GET",
      `/services/${cfg.service_id}/gameservers/file_server/download`, { file: path });
    const url = data.data && data.data.token && data.data.token.url;
    if (!url) throw new Error("Nitrado hat keine Download-URL geliefert.");
    let resp;
    try {
      resp = await fetch(url);
    } catch (e) {
      throw new Error("Der Nitrado-Dateiserver blockiert den Browser-Download " +
                      "(CORS). Bitte die PC-Version (server.py) benutzen.");
    }
    if (!resp.ok) throw new Error("Download fehlgeschlagen (" + resp.status + ").");
    return resp.text();
  }

  async function fileWrite(path, content) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const data = await nitrado(cfg.token, "POST",
      `/services/${cfg.service_id}/gameservers/file_server/upload`,
      null, { path: dir, file: name });
    const tok = data.data && data.data.token;
    if (!tok || !tok.url || !tok.token) throw new Error("Nitrado hat keine Upload-URL geliefert.");
    let resp;
    try {
      resp = await fetch(tok.url, {
        method: "POST",
        headers: { token: tok.token, "Content-Type": "application/binary" },
        body: content,
      });
    } catch (e) {
      throw new Error("Der Nitrado-Dateiserver blockiert den Browser-Upload " +
                      "(CORS). Bitte die PC-Version (server.py) benutzen.");
    }
    if (!resp.ok) throw new Error("Upload fehlgeschlagen (" + resp.status + ").");
  }

  async function fileExists(path) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    try {
      const entries = await fileList(cfg.token, cfg.service_id, dir);
      return entries.some((e) => e.name === name);
    } catch (e) {
      return false;
    }
  }

  const missionFile = (key) => cfg.mission_dir + "/" + MISSION_FILES[key];

  /* ------------------------------------------------ Backups (IndexedDB) */

  const Backups = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("dayz-manager-backups", 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
        };
        req.onsuccess = () => { this._db = req.result; resolve(this._db); };
        req.onerror = () => reject(req.error);
      });
    },
    async add(path, content) {
      try {
        const db = await this.open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction("backups", "readwrite");
          tx.objectStore("backups").add({ path, time: Date.now(), content });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        // Alte Einträge begrenzen (max. 40)
        const all = await this.list();
        if (all.length > 40) {
          const db2 = await this.open();
          const tx = db2.transaction("backups", "readwrite");
          all.slice(40).forEach((b) => tx.objectStore("backups").delete(b.id));
        }
      } catch (e) {
        console.warn("Backup konnte nicht gespeichert werden:", e);
      }
    },
    async list() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction("backups").objectStore("backups").getAll();
        req.onsuccess = () => resolve(req.result.sort((a, b) => b.time - a.time));
        req.onerror = () => reject(req.error);
      });
    },
  };

  async function backupAndWrite(path, content) {
    try {
      const current = await fileRead(path);
      await Backups.add(path, current);
    } catch (e) { /* Datei existiert noch nicht – kein Backup nötig */ }
    await fileWrite(path, content);
  }

  /* --------------------------------------------------------- XML-Helfer */

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("Datei enthält fehlerhaftes XML.");
    return doc;
  }

  function dumpXml(doc) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      new XMLSerializer().serializeToString(doc.documentElement) + "\n";
  }

  function fmt(value) {
    const n = Number(value) || 0;
    return n === Math.trunc(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function appendIndented(parent, elements, depth) {
    const doc = parent.ownerDocument;
    const inner = "\n" + "    ".repeat(depth + 1);
    elements.forEach((el) => {
      parent.appendChild(doc.createTextNode(inner));
      parent.appendChild(el);
    });
    if (elements.length) parent.appendChild(doc.createTextNode("\n" + "    ".repeat(depth)));
  }

  /* --------------------------------------- cfgplayerspawnpoints.xml */

  function parsePlayerspawns(text) {
    const doc = parseXml(text);
    const sections = {};
    for (const name of SPAWN_SECTIONS) {
      sections[name] = [];
      const bubbles = doc.querySelector(`playerspawnpoints > ${name} > generator_posbubbles`);
      if (bubbles) {
        bubbles.querySelectorAll("pos").forEach((pos) => {
          sections[name].push({ x: Number(pos.getAttribute("x")) || 0,
                                z: Number(pos.getAttribute("z")) || 0 });
        });
      }
    }
    return sections;
  }

  function writePlayerspawns(text, sections) {
    const doc = parseXml(text);
    for (const name of SPAWN_SECTIONS) {
      if (!(name in sections)) continue;
      let section = doc.querySelector(`playerspawnpoints > ${name}`);
      if (!section) {
        section = doc.createElement(name);
        doc.documentElement.appendChild(section);
      }
      let bubbles = section.querySelector("generator_posbubbles");
      if (!bubbles) {
        bubbles = doc.createElement("generator_posbubbles");
        section.appendChild(bubbles);
      }
      clearChildren(bubbles);
      appendIndented(bubbles, sections[name].map((p) => {
        const pos = doc.createElement("pos");
        pos.setAttribute("x", fmt(p.x));
        pos.setAttribute("z", fmt(p.z));
        return pos;
      }), 2);
    }
    return dumpXml(doc);
  }

  /* --------------------------------------------- cfgeventspawns.xml */

  function parseEventspawns(text) {
    const doc = parseXml(text);
    const events = [];
    doc.querySelectorAll("eventposdef > event").forEach((ev) => {
      const positions = [];
      ev.querySelectorAll("pos").forEach((pos) => {
        const entry = { x: Number(pos.getAttribute("x")) || 0,
                        z: Number(pos.getAttribute("z")) || 0 };
        if (pos.getAttribute("a") !== null) entry.a = Number(pos.getAttribute("a")) || 0;
        positions.push(entry);
      });
      events.push({ name: ev.getAttribute("name") || "", positions });
    });
    return events;
  }

  function writeEventspawns(text, events) {
    const doc = parseXml(text);
    const existing = {};
    doc.querySelectorAll("eventposdef > event").forEach((ev) => {
      existing[ev.getAttribute("name")] = ev;
    });
    for (const entry of events) {
      const name = (entry.name || "").trim();
      if (!name) continue;
      let ev = existing[name];
      if (!ev) {
        ev = doc.createElement("event");
        ev.setAttribute("name", name);
        doc.documentElement.appendChild(doc.createTextNode("    "));
        doc.documentElement.appendChild(ev);
        doc.documentElement.appendChild(doc.createTextNode("\n"));
      }
      ev.querySelectorAll("pos").forEach((pos) => {
        if (pos.previousSibling && pos.previousSibling.nodeType === 3) pos.previousSibling.remove();
        pos.remove();
      });
      appendIndented(ev, (entry.positions || []).map((p) => {
        const pos = doc.createElement("pos");
        pos.setAttribute("x", fmt(p.x));
        pos.setAttribute("z", fmt(p.z));
        pos.setAttribute("a", fmt(p.a || 0));
        return pos;
      }), 1);
    }
    return dumpXml(doc);
  }

  /* --------------------------------------------------------- types.xml */

  const TYPE_FIELDS = ["nominal", "lifetime", "restock", "min", "quantmin", "quantmax", "cost"];

  function parseTypes(text) {
    const doc = parseXml(text);
    const items = [];
    doc.querySelectorAll("types > type").forEach((node) => {
      const item = { name: node.getAttribute("name") || "" };
      for (const field of TYPE_FIELDS) {
        const child = node.querySelector(":scope > " + field);
        item[field] = child ? Math.trunc(Number(child.textContent) || 0) : null;
      }
      const category = node.querySelector(":scope > category");
      item.category = category ? category.getAttribute("name") : "";
      const flags = node.querySelector(":scope > flags");
      item.flags = {};
      if (flags) for (const attr of flags.attributes) item.flags[attr.name] = attr.value;
      item.usages = Array.from(node.querySelectorAll(":scope > usage")).map((u) => u.getAttribute("name"));
      item.tiers = Array.from(node.querySelectorAll(":scope > value")).map((v) => v.getAttribute("name"));
      items.push(item);
    });
    return items;
  }

  function updateTypes(text, updates) {
    const doc = parseXml(text);
    const nodes = {};
    doc.querySelectorAll("types > type").forEach((n) => { nodes[n.getAttribute("name")] = n; });
    const missing = [];
    for (const [name, fields] of Object.entries(updates)) {
      const node = nodes[name];
      if (!node) { missing.push(name); continue; }
      for (const [field, value] of Object.entries(fields)) {
        if (!TYPE_FIELDS.includes(field) || value === null) continue;
        let child = node.querySelector(":scope > " + field);
        if (!child) {
          child = doc.createElement(field);
          node.appendChild(child);
        }
        child.textContent = String(Math.trunc(Number(value) || 0));
      }
    }
    return { text: dumpXml(doc), missing };
  }

  /* ------------------------------------------------ Objekt-Spawner-JSON */

  function parseObjects(text) {
    const data = text.trim() ? JSON.parse(text) : {};
    return (data.Objects || []).map((obj) => ({
      name: obj.name || "",
      x: Number((obj.pos || [])[0]) || 0,
      y: Number((obj.pos || [])[1]) || 0,
      z: Number((obj.pos || [])[2]) || 0,
      yaw: Number((obj.ypr || [])[0]) || 0,
    }));
  }

  function writeObjects(objects) {
    return JSON.stringify({
      Objects: objects.filter((o) => (o.name || "").trim()).map((o) => ({
        name: o.name.trim(),
        pos: [Math.round(o.x * 1000) / 1000, Math.round(o.y * 1000) / 1000,
              Math.round(o.z * 1000) / 1000],
        ypr: [Math.round((o.yaw || 0) * 10) / 10, 0, 0],
        scale: 1.0,
        enableCEPersistency: 0,
      })),
    }, null, 4) + "\n";
  }

  function ensureObjectSpawner(gameplayText, relPath) {
    const data = JSON.parse(gameplayText);
    if (!data.WorldsData) data.WorldsData = {};
    if (!Array.isArray(data.WorldsData.objectSpawnersArr)) data.WorldsData.objectSpawnersArr = [];
    if (data.WorldsData.objectSpawnersArr.includes(relPath)) {
      return { text: gameplayText, changed: false };
    }
    data.WorldsData.objectSpawnersArr.push(relPath);
    return { text: JSON.stringify(data, null, 4) + "\n", changed: true };
  }

  /* ------------------------------------------------------------- Setup */

  async function findMissionDir(token, serviceId, start, depth) {
    let entries;
    try {
      entries = await fileList(token, serviceId, start);
    } catch (e) {
      return null;
    }
    const dirs = entries.filter((e) => e.type === "dir");
    for (const entry of dirs) {
      if ((entry.name || "").startsWith("dayzOffline.")) {
        return entry.path || (start.replace(/\/$/, "") + "/" + entry.name);
      }
    }
    if (depth <= 0) return null;
    dirs.sort((a, b) => (a.name.includes("missions") ? -1 : 0) - (b.name.includes("missions") ? -1 : 0));
    for (const entry of dirs) {
      const path = entry.path || (start.replace(/\/$/, "") + "/" + entry.name);
      const found = await findMissionDir(token, serviceId, path, depth - 1);
      if (found) return found;
    }
    return null;
  }

  function state() {
    const configured = !!(cfg.token && cfg.mission_dir);
    const st = { configured, demo: false, direct: true, tile_url: cfg.tile_url || "" };
    if (configured) {
      st.mission_dir = cfg.mission_dir;
      st.root_dir = cfg.root_dir;
    }
    return st;
  }

  function requireCfg() {
    if (!cfg.token || !cfg.mission_dir) {
      throw new Error("Noch nicht eingerichtet. Bitte zuerst den Nitrado-API-" +
                      "Token eingeben und den Server auswählen (Zahnrad oben rechts).");
    }
  }

  /* ------------------------------------------------------------ Routen */

  async function call(pathWithQuery, body) {
    const [route, qs] = pathWithQuery.split("?");
    const q = Object.fromEntries(new URLSearchParams(qs || ""));

    switch (route) {
      case "/api/state":
        return state();

      case "/api/setup/token": {
        const data = await nitrado(body.token, "GET", "/services");
        const services = ((data.data && data.data.services) || []).map((svc) => {
          const details = svc.details || {};
          const game = (details.game || "").toLowerCase();
          return {
            id: svc.id,
            name: details.name || svc.comment || "Service " + svc.id,
            game: details.game || "",
            address: details.address || "",
            is_dayz: game.includes("dayz"),
          };
        });
        services.sort((a, b) => Number(b.is_dayz) - Number(a.is_dayz));
        return { services };
      }

      case "/api/setup/select": {
        const gsData = await nitrado(body.token, "GET",
          `/services/${body.service_id}/gameservers`);
        const gs = (gsData.data && gsData.data.gameserver) || {};
        const root = `/games/${gs.username}/noftp/${gs.game}`;
        let mission = await findMissionDir(body.token, body.service_id, root, 4);
        if (!mission) mission = await findMissionDir(body.token, body.service_id,
          `/games/${gs.username}`, 4);
        if (!mission) {
          throw new Error("Konnte den Missionsordner (dayzOffline.*) nicht " +
                          "automatisch finden. Ist das wirklich ein DayZ-Server?");
        }
        cfg = { token: body.token, service_id: body.service_id, game: gs.game,
                username: gs.username, root_dir: root, mission_dir: mission,
                tile_url: cfg.tile_url || "" };
        saveCfg();
        return state();
      }

      case "/api/settings":
        cfg.tile_url = (body.tile_url || "").trim();
        saveCfg();
        return state();

      case "/api/files": {
        requireCfg();
        const dir = q.dir || cfg.root_dir;
        const entries = (await fileList(cfg.token, cfg.service_id, dir)).map((e) => ({
          name: e.name || "",
          path: e.path || (dir.replace(/\/$/, "") + "/" + e.name),
          type: e.type === "dir" ? "dir" : "file",
          size: e.size || 0,
        }));
        entries.sort((a, b) => (a.type !== "dir") - (b.type !== "dir") ||
                               a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        return { dir, entries };
      }

      case "/api/file":
        requireCfg();
        if (body) {
          await backupAndWrite(body.path, body.content);
          return { ok: true };
        }
        return { path: q.path, content: await fileRead(q.path) };

      case "/api/search": {
        requireCfg();
        const query = (q.q || "").trim().toLowerCase();
        if (query.length < 2) throw new Error("Bitte mindestens 2 Zeichen eingeben.");
        const results = [];
        const stack = [[cfg.root_dir, 0]];
        let visited = 0;
        while (stack.length && results.length < 200 && visited < 400) {
          const [dir, depth] = stack.pop();
          visited += 1;
          let entries;
          try {
            entries = await call("/api/files?dir=" + encodeURIComponent(dir));
          } catch (e) { continue; }
          for (const entry of entries.entries) {
            if (entry.name.toLowerCase().includes(query)) results.push(entry);
            if (entry.type === "dir" && depth < 6) stack.push([entry.path, depth + 1]);
          }
        }
        return { results };
      }

      case "/api/map/data": {
        requireCfg();
        const data = { playerspawns: { fresh: [], hop: [], travel: [] },
                       events: [], objects: [], warnings: [] };
        try {
          data.playerspawns = parsePlayerspawns(await fileRead(missionFile("playerspawns")));
        } catch (e) {
          data.warnings.push("cfgplayerspawnpoints.xml konnte nicht geladen werden: " + e.message);
        }
        try {
          data.events = parseEventspawns(await fileRead(missionFile("events")));
        } catch (e) {
          data.warnings.push("cfgeventspawns.xml konnte nicht geladen werden: " + e.message);
        }
        if (await fileExists(missionFile("objects"))) {
          try {
            data.objects = parseObjects(await fileRead(missionFile("objects")));
          } catch (e) {
            data.warnings.push("mapobjects.json konnte nicht geladen werden: " + e.message);
          }
        }
        return data;
      }

      case "/api/map/save": {
        requireCfg();
        const saved = [];
        if (body.playerspawns) {
          const path = missionFile("playerspawns");
          await backupAndWrite(path, writePlayerspawns(await fileRead(path), body.playerspawns));
          saved.push("cfgplayerspawnpoints.xml");
        }
        if (body.events) {
          const path = missionFile("events");
          await backupAndWrite(path, writeEventspawns(await fileRead(path), body.events));
          saved.push("cfgeventspawns.xml");
        }
        if (body.objects) {
          await backupAndWrite(missionFile("objects"), writeObjects(body.objects));
          saved.push("mapobjects.json");
          const gpPath = missionFile("gameplay");
          const result = ensureObjectSpawner(await fileRead(gpPath), MISSION_FILES.objects);
          if (result.changed) {
            await backupAndWrite(gpPath, result.text);
            saved.push("cfggameplay.json (objectSpawnersArr ergänzt)");
          }
        }
        return { ok: true, saved };
      }

      case "/api/types": {
        requireCfg();
        const path = missionFile("types");
        if (body) {
          const result = updateTypes(await fileRead(path), body.updates);
          await backupAndWrite(path, result.text);
          return { ok: true, missing: result.missing };
        }
        return { types: parseTypes(await fileRead(path)) };
      }

      case "/api/server/status": {
        requireCfg();
        const gsData = await nitrado(cfg.token, "GET",
          `/services/${cfg.service_id}/gameservers`);
        const gs = (gsData.data && gsData.data.gameserver) || {};
        const query = gs.query || {};
        return {
          status: gs.status || "unbekannt",
          game: gs.game_human || gs.game || "",
          player_current: query.player_current ?? null,
          player_max: query.player_max ?? null,
          server_name: query.server_name || null,
          demo: false,
        };
      }

      case "/api/server/restart":
        requireCfg();
        await nitrado(cfg.token, "POST",
          `/services/${cfg.service_id}/gameservers/restart`,
          null, { restart_message: "Neustart über DayZ-Server-Manager" });
        return { ok: true };

      case "/api/server/stop":
        requireCfg();
        await nitrado(cfg.token, "POST",
          `/services/${cfg.service_id}/gameservers/stop`,
          null, { stop_message: "Stopp über DayZ-Server-Manager" });
        return { ok: true };

      default:
        throw new Error("Unbekannte Funktion: " + route);
    }
  }

  /* ---------------------------------------------------- Backup-Ansicht */

  async function renderBackups(container) {
    let list;
    try {
      list = await Backups.list();
    } catch (e) {
      container.textContent = "Backups nicht verfügbar: " + e.message;
      return;
    }
    if (!list.length) {
      container.textContent = "Noch keine Backups.";
      return;
    }
    container.innerHTML = "";
    list.slice(0, 25).forEach((backup) => {
      const row = document.createElement("div");
      const name = backup.path.split("/").pop();
      const when = new Date(backup.time).toLocaleString("de-DE");
      const link = document.createElement("a");
      link.textContent = "⬇ " + name + " – " + when;
      link.href = URL.createObjectURL(new Blob([backup.content], { type: "text/plain" }));
      link.download = when.replace(/[.:, ]+/g, "-") + "_" + name;
      row.appendChild(link);
      row.style.margin = "6px 0";
      container.appendChild(row);
    });
  }

  return {
    call, renderBackups, state,
    // Für automatische Tests zugänglich:
    _test: { parsePlayerspawns, writePlayerspawns, parseEventspawns,
             writeEventspawns, parseTypes, updateTypes, parseObjects,
             writeObjects, ensureObjectSpawner },
  };
})();

window.DirectMode = DirectMode;
