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

  function fileNotFound(path) {
    const error = new Error("Datei nicht gefunden: " + path);
    error.code = "FILE_NOT_FOUND";
    return error;
  }

  async function fileRead(path) {
    let data;
    try {
      data = await nitrado(cfg.token, "GET",
        `/services/${cfg.service_id}/gameservers/file_server/download`, { file: path });
    } catch (e) {
      // Nitrado meldet fehlende Dateien als 500 "File doesn't exist (anymore?)"
      if (/doesn't exist|does not exist|no such file/i.test(e.message || ""))
        throw fileNotFound(path);
      throw e;
    }
    const url = data.data && data.data.token && data.data.token.url;
    if (!url) throw new Error("Nitrado hat keine Download-URL geliefert.");
    let resp;
    try {
      resp = await fetch(url);
    } catch (e) {
      throw new Error("Der Nitrado-Dateiserver blockiert den Browser-Download " +
                      "möglicherweise per CORS. Bitte erneut versuchen oder " +
                      "einen anderen Browser verwenden.");
    }
    if (resp.status === 404) throw fileNotFound(path);
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
                      "möglicherweise per CORS. Bitte erneut versuchen oder " +
                      "einen anderen Browser verwenden.");
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
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("backups", "readwrite");
        tx.objectStore("backups").add({ path, time: Date.now(), content });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Backup wurde abgebrochen."));
      });
      // Alte Einträge begrenzen (max. 40) und erst danach weiterschreiben.
      const all = await this.list();
      if (all.length > 40) {
        const db2 = await this.open();
        await new Promise((resolve, reject) => {
          const tx = db2.transaction("backups", "readwrite");
          all.slice(40).forEach((b) => tx.objectStore("backups").delete(b.id));
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("Backup-Bereinigung wurde abgebrochen."));
        });
      }
    },
    async list() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction("backups").objectStore("backups").getAll();
        req.onsuccess = () => resolve(req.result.sort((a, b) =>
          b.time - a.time || b.id - a.id));
        req.onerror = () => reject(req.error);
      });
    },
  };

  async function backupAndWrite(path, content) {
    let current;
    try {
      current = await fileRead(path);
    } catch (e) {
      // Nur eine eindeutig fehlende Datei ist eine erlaubte Neuanlage.
      // Netzwerk-, API- und Browser-Datenbankfehler müssen den Upload stoppen.
      if (e && e.code !== "FILE_NOT_FOUND") throw e;
    }
    if (current !== undefined) {
      try {
        await Backups.add(path, current);
      } catch (e) {
        throw new Error("Backup konnte nicht gespeichert werden. Der Upload wurde " +
                        "aus Sicherheitsgründen abgebrochen: " + (e.message || e));
      }
    }
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

  function xmlTagEnd(text, start) {
    let quote = "";
    for (let i = start + 1; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        return i;
      }
    }
    throw new Error("Datei enthält ein unvollständiges XML-Tag.");
  }

  function xmlDeclarationEnd(text, start) {
    let quote = "", brackets = 0;
    for (let i = start + 2; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "[") {
        brackets += 1;
      } else if (ch === "]" && brackets) {
        brackets -= 1;
      } else if (ch === ">" && brackets === 0) {
        return i;
      }
    }
    throw new Error("Datei enthält eine unvollständige XML-Deklaration.");
  }

  /* Liefert Quellbereiche echter types/type-Knoten. Kommentare, CDATA und
     Processing Instructions werden lexikalisch übersprungen; die Namen kommen
     aus dem bereits validierten DOM, damit auch Entities korrekt aufgelöst sind. */
  function scanTypeSources(text, doc) {
    const domTypes = Array.from(doc.querySelectorAll("types > type"));
    const sourceTypes = [];
    const stack = [];

    const addSegment = (start, end, kind) => {
      if (end <= start) return;
      const top = stack[stack.length - 1];
      if (top && top.field) top.field.segments.push({ start, end, kind });
    };

    let pos = 0;
    while (pos < text.length) {
      const start = text.indexOf("<", pos);
      if (start === -1) {
        addSegment(pos, text.length, "text");
        break;
      }
      addSegment(pos, start, "text");

      if (text.startsWith("<!--", start)) {
        const end = text.indexOf("-->", start + 4);
        if (end === -1) throw new Error("Datei enthält einen unvollständigen XML-Kommentar.");
        pos = end + 3;
        continue;
      }
      if (text.startsWith("<![CDATA[", start)) {
        const end = text.indexOf("]]>", start + 9);
        if (end === -1) throw new Error("Datei enthält einen unvollständigen CDATA-Block.");
        addSegment(start + 9, end, "cdata");
        pos = end + 3;
        continue;
      }
      if (text.startsWith("<?", start)) {
        const end = text.indexOf("?>", start + 2);
        if (end === -1) throw new Error("Datei enthält eine unvollständige Processing Instruction.");
        pos = end + 2;
        continue;
      }
      if (text.startsWith("<!", start)) {
        pos = xmlDeclarationEnd(text, start) + 1;
        continue;
      }

      const end = xmlTagEnd(text, start);
      const token = text.slice(start, end + 1);
      const closing = /^<\s*\//.test(token);
      const match = closing
        ? /^<\s*\/\s*([^\s>]+)/.exec(token)
        : /^<\s*([^\s/>]+)/.exec(token);
      if (!match) throw new Error("Datei enthält ein unbekanntes XML-Tag.");
      const tagName = match[1];

      if (closing) {
        const element = stack.pop();
        if (!element || element.name !== tagName)
          throw new Error("Datei enthält falsch verschachtelte XML-Tags.");
        pos = end + 1;
        continue;
      }

      const parent = stack[stack.length - 1];
      const selfClosing = /\/\s*>$/.test(token);
      let type = null, field = null;
      if (tagName === "type" && parent && parent.name === "types") {
        const domNode = domTypes[sourceTypes.length];
        if (!domNode) throw new Error("types.xml konnte nicht eindeutig dem Quelltext zugeordnet werden.");
        type = { name: domNode.getAttribute("name") || "", fields: new Map() };
        sourceTypes.push(type);
      } else if (TYPE_FIELDS.includes(tagName) && parent && parent.type) {
        field = { name: tagName, start, end: end + 1, selfClosing, segments: [] };
        if (!parent.type.fields.has(tagName)) parent.type.fields.set(tagName, []);
        parent.type.fields.get(tagName).push(field);
      }
      if (!selfClosing) stack.push({ name: tagName, type, field });
      pos = end + 1;
    }

    if (stack.length || sourceTypes.length !== domTypes.length)
      throw new Error("types.xml konnte nicht eindeutig dem Quelltext zugeordnet werden.");
    return sourceTypes;
  }

  function numericSourceRange(text, field) {
    const nonEmpty = field.segments.filter((part) => text.slice(part.start, part.end).trim());
    if (nonEmpty.length !== 1) return null;
    const part = nonEmpty[0];
    const raw = text.slice(part.start, part.end);
    const match = /^(\s*)[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(\s*)$/.exec(raw);
    if (!match) return null;
    return { start: part.start + match[1].length,
             end: part.end - match[2].length };
  }

  function updateTypes(text, updates) {
    const doc = parseXml(text);
    const sourceTypes = scanTypeSources(text, doc);
    const byName = new Map();
    sourceTypes.forEach((type) => {
      if (!byName.has(type.name)) byName.set(type.name, []);
      byName.get(type.name).push(type);
    });

    const missing = [], patches = [];
    for (const [name, fields] of Object.entries(updates || {})) {
      const matches = byName.get(name) || [];
      if (!matches.length) {
        missing.push(name);
        continue;
      }
      if (matches.length > 1)
        throw new Error(`types.xml enthält den Eintrag „${name}“ mehrfach. ` +
                        "Aus Sicherheitsgründen wurde nichts gespeichert.");
      const type = matches[0];
      for (const [fieldName, value] of Object.entries(fields || {})) {
        if (!TYPE_FIELDS.includes(fieldName) || value === null) continue;
        const fieldMatches = type.fields.get(fieldName) || [];
        if (fieldMatches.length !== 1) {
          missing.push(name + "." + fieldName);
          continue;
        }
        const number = Number(value);
        if (!Number.isFinite(number))
          throw new Error(`Ungültiger Zahlenwert für ${name}.${fieldName}.`);
        const numeric = String(Math.trunc(number));
        const field = fieldMatches[0];
        if (field.selfClosing) {
          const opening = text.slice(field.start, field.end);
          const expanded = opening.replace(/\s*\/\s*>$/, ">" + numeric +
            "</" + fieldName + ">");
          patches.push({ start: field.start, end: field.end, value: expanded });
          continue;
        }
        const range = numericSourceRange(text, field);
        if (!range) {
          missing.push(name + "." + fieldName);
          continue;
        }
        patches.push({ ...range, value: numeric });
      }
    }

    patches.sort((a, b) => b.start - a.start);
    let patched = text, previousStart = text.length;
    for (const patch of patches) {
      if (patch.end > previousStart)
        throw new Error("types.xml enthält überlappende Zahlenfelder.");
      patched = patched.slice(0, patch.start) + patch.value + patched.slice(patch.end);
      previousStart = patch.start;
    }
    return { text: patched, missing };
  }

  /* ------------------------------------------------ Objekt-Spawner-JSON */

  const OBJECT_SOURCE = Symbol("mapobject-source");

  function parseObjects(text) {
    const data = text.trim() ? JSON.parse(text) : {};
    return (data.Objects || []).map((raw) => {
      const obj = raw && typeof raw === "object" ? raw : {};
      const parsed = {
        name: obj.name || "",
        x: Number((obj.pos || [])[0]) || 0,
        y: Number((obj.pos || [])[1]) || 0,
        z: Number((obj.pos || [])[2]) || 0,
        yaw: Number((obj.ypr || [])[0]) || 0,
      };
      Object.defineProperty(parsed, OBJECT_SOURCE, { value: obj });
      return parsed;
    });
  }

  function writeObjects(objects) {
    return JSON.stringify({
      Objects: objects.filter((o) => (o.name || "").trim()).map((o) => {
        const source = o[OBJECT_SOURCE] && typeof o[OBJECT_SOURCE] === "object"
          ? o[OBJECT_SOURCE]
          : Object.fromEntries(Object.entries(o).filter(([key]) =>
              !["x", "y", "z", "yaw"].includes(key)));
        const originalYpr = Array.isArray(source.ypr) ? source.ypr : [];
        const ypr = originalYpr.slice();
        while (ypr.length < 3) ypr.push(0);
        ypr[0] = Math.round((o.yaw || 0) * 10) / 10;
        const result = {
          ...source,
          name: o.name.trim(),
          pos: [Math.round(o.x * 1000) / 1000, Math.round(o.y * 1000) / 1000,
                Math.round(o.z * 1000) / 1000],
          ypr,
        };
        if (!Object.prototype.hasOwnProperty.call(source, "scale")) result.scale = 1.0;
        if (!Object.prototype.hasOwnProperty.call(source, "enableCEPersistency"))
          result.enableCEPersistency = 0;
        return result;
      }),
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

  /* Alle Missionsordner über sämtliche Zweige bis zur Tiefengrenze sammeln.
     Der reine Helfer ist ohne Netzwerk testbar; doppelte Pfade und Zyklen
     werden abgefangen. */
  async function collectMissionDirs(start, depth, listDir) {
    const found = [], foundSet = new Set(), visited = new Set();
    const visit = async (dir, remaining) => {
      const key = String(dir || "").replace(/\/+$/, "");
      if (visited.has(key)) return;
      visited.add(key);
      let entries;
      try {
        entries = await listDir(dir);
      } catch (e) {
        return;
      }
      const dirs = (entries || []).filter((entry) => entry.type === "dir");
      dirs.sort((a, b) => {
        const aMission = /missions/i.test(a.name || "") ? 0 : 1;
        const bMission = /missions/i.test(b.name || "") ? 0 : 1;
        return aMission - bMission || String(a.name || "").localeCompare(String(b.name || ""));
      });
      const descend = [];
      for (const entry of dirs) {
        const path = entry.path || (String(dir).replace(/\/$/, "") + "/" + entry.name);
        if (/^dayzOffline\./i.test(entry.name || "")) {
          if (!foundSet.has(path)) {
            foundSet.add(path);
            found.push(path);
          }
        } else {
          descend.push(path);
        }
      }
      if (remaining <= 0) return;
      for (const path of descend) await visit(path, remaining - 1);
    };
    await visit(start, Math.max(0, Math.trunc(Number(depth) || 0)));
    return found;
  }

  async function findMissionDirs(token, serviceId, start, depth) {
    return collectMissionDirs(start, depth,
      (dir) => fileList(token, serviceId, dir));
  }

  /* Karten-Schlüssel (chernarusplus/enoch/sakhal) aus einem Missionspfad */
  const mapKeyOf = (dir) => {
    const m = /dayzoffline\.([a-z0-9_]+)/i.exec(dir || "");
    return m ? m[1].toLowerCase() : "";
  };

  /* Aktive Mission aus den Nitrado-Serverdaten erkennen: zuerst in den
     expliziten Einstellungen (settings.config) suchen, dann überall. */
  function detectActiveMission(gs, missionDirs) {
    let name = null;
    const conf = (gs.settings && gs.settings.config) || {};
    for (const key of Object.keys(conf)) {
      const m = /dayzoffline\.[a-z0-9_]+/i.exec(String(conf[key] || ""));
      if (m) { name = m[0]; break; }
    }
    if (!name) {
      try {
        const m = /dayzoffline\.[a-z0-9_]+/i.exec(JSON.stringify(gs));
        if (m) name = m[0];
      } catch (e) { /* dann eben nicht */ }
    }
    if (!name) return null;
    const want = name.toLowerCase();
    return missionDirs.find((d) =>
      (d.split("/").pop() || "").toLowerCase() === want) || null;
  }

  /* Missionsordner zu einem Karten-Schlüssel. Sicherheit: gewechselt wird
     nur, wenn der Ordner der Karte auf dem Server wirklich existiert. */
  async function missionDirForMap(key) {
    const want = "dayzoffline." + key.toLowerCase();
    const match = (dirs) => (dirs || []).find((d) =>
      (d.split("/").pop() || "").toLowerCase() === want);
    let dir = match(cfg.mission_dirs);
    if (dir) return dir;
    // Liste fehlt (ältere Einrichtung): neben dem aktuellen Ordner nachsehen …
    const parent = (cfg.mission_dir || "").split("/").slice(0, -1).join("/");
    if (parent) {
      const siblings = await findMissionDirs(cfg.token, cfg.service_id, parent, 0);
      if (siblings.length) { cfg.mission_dirs = siblings; saveCfg(); }
      dir = match(siblings);
      if (dir) return dir;
    }
    // … sonst komplette Suche ab dem Spielordner
    const all = await findMissionDirs(cfg.token, cfg.service_id, cfg.root_dir, 4);
    if (all.length) { cfg.mission_dirs = all; saveCfg(); }
    dir = match(all);
    if (dir) return dir;
    throw new Error("Auf dem Server wurde kein Missionsordner „dayzOffline." + key +
                    "“ gefunden – diese Karte ist dort anscheinend nicht " +
                    "installiert. Der bisherige Ordner bleibt aktiv.");
  }

  function state() {
    const configured = !!(cfg.token && cfg.mission_dir);
    const st = { configured, demo: false, direct: true,
                 tile_url: cfg.tile_url || "",
                 map: cfg.map || mapKeyOf(cfg.mission_dir) || "" };
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
        let missions = await findMissionDirs(body.token, body.service_id, root, 4);
        if (!missions.length) missions = await findMissionDirs(body.token,
          body.service_id, `/games/${gs.username}`, 4);
        if (!missions.length) {
          throw new Error("Konnte den Missionsordner (dayzOffline.*) nicht " +
                          "automatisch finden. Ist das wirklich ein DayZ-Server?");
        }
        // Aktive Karte des Servers erkennen – sonst den ersten Fund nehmen
        const mission = detectActiveMission(gs, missions) || missions[0];
        cfg = { token: body.token, service_id: body.service_id, game: gs.game,
                username: gs.username, root_dir: root,
                mission_dir: mission, mission_dirs: missions,
                map: mapKeyOf(mission), tile_url: cfg.tile_url || "" };
        saveCfg();
        return state();
      }

      case "/api/settings":
        // Nur mitgeschickte Felder ändern (Teil-Update)
        if ("tile_url" in body) cfg.tile_url = String(body.tile_url || "").trim();
        if ("map" in body) {
          const key = String(body.map || "").trim();
          // Sicherheit: die Dateipfade folgen immer der Kartenwahl
          if (key && cfg.token && cfg.mission_dir && key !== mapKeyOf(cfg.mission_dir)) {
            cfg.mission_dir = await missionDirForMap(key);
          }
          cfg.map = key;
        }
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
        const stack = [cfg.root_dir];
        const queued = new Set(stack);
        let visited = 0;
        while (stack.length && results.length < 200 && visited < 400) {
          const dir = stack.pop();
          visited += 1;
          let entries;
          try {
            entries = await call("/api/files?dir=" + encodeURIComponent(dir));
          } catch (e) { continue; }
          for (const entry of entries.entries) {
            if (entry.name.toLowerCase().includes(query)) {
              if (results.length >= 200) break;
              results.push(entry);
            }
            if (entry.type === "dir" && !queued.has(entry.path)) {
              queued.add(entry.path);
              stack.push(entry.path);
            }
          }
        }
        return {
          results,
          visited,
          truncated: stack.length > 0 || results.length >= 200 || visited >= 400,
        };
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
    list.slice(0, 40).forEach((backup) => {
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
             writeObjects, ensureObjectSpawner, collectMissionDirs },
  };
})();

window.DirectMode = DirectMode;
