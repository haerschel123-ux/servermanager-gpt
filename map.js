/* Interaktive DayZ-Karte (Leaflet, eigenes Koordinatensystem).
 *
 * DayZ-Weltkoordinaten: X = West→Ost, Z = Süd→Nord. Leaflet: latlng = [Z, X].
 * Bei Zoom 0 ist die ganze Karte eine 256px-Kachel (Standard-XYZ-Schema).
 * Unterstützte Karten: Chernarus, Livonia (Enoch), Sakhal — umschaltbar.
 */
"use strict";

/* Die drei offiziellen Karten mit Weltgröße (Meter) und Kachel-Slug.
 * Größen: Chernarus 15360, Livonia 12800 (163 km²), Sakhal 10240 (~105 km²). */
const MAPS = {
  chernarusplus: { label: "Chernarus", size: 15360, slug: "chernarusplus" },
  enoch: { label: "Livonia", size: 12800, slug: "livonia" },
  sakhal: { label: "Sakhal", size: 10240, slug: "sakhal" },
};

const tileUrl = (slug, layer) =>
  `https://static.xam.nu/dayz/maps/${slug}/1.27/${layer}/{z}/{x}/{y}.webp`;

/* Ortsnamen-Overlay (bisher nur für Chernarus gepflegt) */
const CITIES = [
  ["Chernogorsk", 6700, 2600], ["Elektrozavodsk", 10300, 2300],
  ["Balota", 4500, 2400], ["Kamenka", 1800, 2200],
  ["Kamyshovo", 12000, 3500], ["Solnichniy", 13400, 6200],
  ["Zelenogorsk", 2700, 5300], ["Pavlovo", 1600, 3800],
  ["Myshkino", 2000, 7300], ["Stary Sobor", 6100, 7700],
  ["Novy Sobor", 7100, 7700], ["Gorka", 9600, 8900],
  ["Berezino", 12000, 9000], ["Vybor", 3800, 8900],
  ["Flugplatz NW", 4600, 10400], ["Lopatino", 2700, 10000],
  ["Grishino", 6000, 10300], ["Dubrovka", 10300, 9800],
  ["Gvozdno", 10200, 11700], ["Krasnostav", 11200, 12300],
  ["Flugplatz NO", 12100, 12600], ["Severograd", 7900, 12600],
  ["Novodmitrovsk", 11800, 14400], ["Svetlojarsk", 13900, 13300],
  ["Tisy", 1700, 14000],
];

const LAYER_STYLE = {
  fresh:   { color: "#5cc768", label: "Spawn (fresh)" },
  hop:     { color: "#4d9de0", label: "Spawn (hop)" },
  travel:  { color: "#b07ce0", label: "Spawn (travel)" },
  events:  { color: "#e0a24d", label: "Event" },
  objects: { color: "#4dd0c4", label: "Objekt" },
};

/* Kachel-Ebene, die ein Koordinatengitter zeichnet (Fallback ohne Kartenbild).
 * Weltgröße kommt als Option: new GridBackdrop({world: 15360}) */
const GridBackdrop = L.GridLayer.extend({
  createTile(coords) {
    const WORLD = this.options.world || 15360;
    const tile = document.createElement("canvas");
    tile.width = tile.height = 256;
    const ctx = tile.getContext("2d");
    const metersPerTile = WORLD / Math.pow(2, coords.z);
    const west = coords.x * metersPerTile;
    const north = WORLD - coords.y * metersPerTile;
    const toPx = (m) => (m / metersPerTile) * 256;

    // Außerhalb der Welt: dunkel; innerhalb: gedecktes Grün
    ctx.fillStyle = "#161b16";
    ctx.fillRect(0, 0, 256, 256);
    const inWest = Math.max(west, 0), inEast = Math.min(west + metersPerTile, WORLD);
    const inSouth = Math.max(north - metersPerTile, 0), inNorth = Math.min(north, WORLD);
    if (inEast > inWest && inNorth > inSouth) {
      ctx.fillStyle = "#2e3a2e";
      ctx.fillRect(toPx(inWest - west), toPx(north - inNorth),
                   toPx(inEast - inWest), toPx(inNorth - inSouth));
    }

    // Gitterlinien: grob 1000 m, fein je nach Zoom
    const steps = metersPerTile <= 1000 ? [100, 1000] : [1000, 5000];
    steps.forEach((step, idx) => {
      ctx.strokeStyle = idx === 0 ? "#ffffff14" : "#ffffff2e";
      ctx.beginPath();
      for (let gx = Math.ceil(inWest / step) * step; gx <= inEast; gx += step) {
        ctx.moveTo(toPx(gx - west), toPx(north - inNorth));
        ctx.lineTo(toPx(gx - west), toPx(north - inSouth));
      }
      for (let gz = Math.ceil(inSouth / step) * step; gz <= inNorth; gz += step) {
        ctx.moveTo(toPx(inWest - west), toPx(north - gz));
        ctx.lineTo(toPx(inEast - west), toPx(north - gz));
      }
      ctx.stroke();
    });

    // Koordinaten-Beschriftung an den 1000er-Linien
    if (metersPerTile <= 4000) {
      ctx.fillStyle = "#ffffff55";
      ctx.font = "10px sans-serif";
      for (let gx = Math.ceil(inWest / 1000) * 1000; gx <= inEast; gx += 1000) {
        ctx.fillText(String(gx), toPx(gx - west) + 3, 12);
      }
      for (let gz = Math.ceil(inSouth / 1000) * 1000; gz <= inNorth; gz += 1000) {
        ctx.fillText(String(gz), 3, toPx(north - gz) - 3);
      }
    }
    return tile;
  },
});

const DayZMap = {
  map: null,
  mapKey: "chernarusplus",
  tileLayer: null,
  groups: {},
  data: null,
  loadedOk: { playerspawns: false, events: false, objects: false },
  dirty: false,
  dirtyParts: { playerspawns: false, events: false, objects: false },

  world() { return MAPS[this.mapKey].size; },

  /* ------------------------------------------------------------- Aufbau */

  create() {
    for (const key of Object.keys(LAYER_STYLE)) {
      this.groups[key] = L.layerGroup();
    }
    this.buildMap();
    this.bindUi();
  },

  /* Leaflet-Instanz für die aktuell gewählte Karte (neu) aufbauen */
  buildMap() {
    const cfg = MAPS[this.mapKey];
    const WORLD = cfg.size;
    if (this.map) { this.map.remove(); this.map = null; this.tileLayer = null; }

    const crs = L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(256 / WORLD, 0, -256 / WORLD, 256),
    });
    this.map = L.map("map", {
      crs, minZoom: 1, maxZoom: 8, zoomControl: true,
      maxBounds: [[-2000, -2000], [WORLD + 2000, WORLD + 2000]],
      attributionControl: true,
    });
    this.map.attributionControl.setPrefix(false);
    this.map.setView([WORLD / 2, WORLD / 2], 2);

    const tileOpts = {
      noWrap: true, minNativeZoom: 0, maxNativeZoom: 8,
      bounds: [[0, 0], [WORLD, WORLD]],
      attribution: cfg.label + " © Bohemia Interactive (Kacheln: xam.nu)",
    };
    this.baseLayers = {
      "🗺️ Karte": L.tileLayer(tileUrl(cfg.slug, "topographic"), tileOpts),
      "🛰️ Satellit": L.tileLayer(tileUrl(cfg.slug, "satellite"), tileOpts),
      "▦ Gitter (offline)": new GridBackdrop({ noWrap: true, world: WORLD }),
    };
    const topo = this.baseLayers["🗺️ Karte"];
    const grid = this.baseLayers["▦ Gitter (offline)"];
    const addTileFallback = (layer) => {
      let failedTiles = 0;
      layer.on("tileerror", () => {
        failedTiles += 1;
        if (failedTiles === 3 && this.map && this.map.hasLayer(layer)) {
          this.map.removeLayer(layer);
          grid.addTo(this.map);
          toast("Kartenbilder sind gerade nicht erreichbar – das Koordinatengitter wurde eingeschaltet.", "warn");
        }
      });
    };
    addTileFallback(topo);
    addTileFallback(this.baseLayers["🛰️ Satellit"]);
    topo.addTo(this.map);

    this.cityLabels = L.layerGroup();
    if (this.mapKey === "chernarusplus") {
      CITIES.forEach(([name, x, z]) => {
        this.cityLabels.addLayer(L.marker([z, x], {
          icon: L.divIcon({ className: "city-label", html: name,
                            iconSize: [120, 16], iconAnchor: [60, 8] }),
          interactive: false, keyboard: false,
        }));
      });
      this.cityLabels.addTo(this.map);
      L.control.layers(this.baseLayers, { "Ortsnamen": this.cityLabels })
        .addTo(this.map);
    } else {
      L.control.layers(this.baseLayers).addTo(this.map);
    }

    // Marker-Gruppen (bleiben über Kartenwechsel erhalten) wieder anhängen
    const toggles = { fresh: "#show-spawns", hop: "#show-spawns",
                      travel: "#show-spawns", events: "#show-events",
                      objects: "#show-objects" };
    for (const [key, sel] of Object.entries(toggles)) {
      const box = document.querySelector(sel);
      if (!box || box.checked) this.groups[key].addTo(this.map);
    }
    this.map.on("click", (ev) => this.onMapClick(ev));
    if (window.App && App.state.tile_url) this.applyTiles(App.state.tile_url);
  },

  /* Karte wechseln (chernarusplus | enoch | sakhal). Wechselt auch den
     Missionsordner auf dem Server mit – existiert der Ordner der Karte
     dort nicht, wird die Auswahl zurückgedreht (Pfad-Sicherheit). */
  async setMap(key, persist) {
    if (!MAPS[key]) return false;
    if (key === this.mapKey) { this.updateSwitchButtons(); return true; }
    const hasUnsaved = window.hasUnsavedServerState
      ? window.hasUnsavedServerState()
      : this.dirty;
    if (persist !== false && hasUnsaved &&
        !confirm("Es gibt ungespeicherte Änderungen. Beim Kartenwechsel werden " +
                 "sie verworfen. Trotzdem wechseln?")) {
      this.updateSwitchButtons();
      return false;
    }
    const before = this.mapKey;
    this.mapKey = key;
    this.buildMap();
    this.redraw();
    this.updateSwitchButtons();
    if (persist === false) return true;
    if (!window.App || !App.state.configured) return true;
    try {
      App.state = await api("/api/settings", { map: key });
      if (App.state.mission_dir)
        toast("Karte gewechselt – benutze jetzt: " + App.state.mission_dir);
      // Alles neu laden, was am Missionsordner hängt
      this.setDirty(false);
      await this.loadData();
      if (window.Loot) {
        Loot.reset();
        if ($("#tab-loot").classList.contains("active")) Loot.load();
      }
      if (window.Tools && Tools.onMissionChanged) Tools.onMissionChanged();
      if (window.Files) Files.reset();
      if (window.Files && App.state.mission_dir) Files.openDir(App.state.mission_dir);
      return true;
    } catch (err) {
      toast(err.message, "error");
      this.mapKey = before;
      this.buildMap();
      this.redraw();
      this.updateSwitchButtons();
      return false;
    }
  },

  updateSwitchButtons() {
    $$(".map-switch button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mapkey === this.mapKey);
    });
  },

  applyTiles(url) {
    if (this.tileLayer) { this.map.removeLayer(this.tileLayer); this.tileLayer = null; }
    if (url) {
      const WORLD = this.world();
      this.tileLayer = L.tileLayer(url, {
        noWrap: true, minNativeZoom: 0, maxNativeZoom: 8,
        bounds: [[0, 0], [WORLD, WORLD]],
      });
      let failures = 0;
      this.tileLayer.on("tileerror", () => {
        failures += 1;
        if (failures === 3 && this.tileLayer) {
          this.map.removeLayer(this.tileLayer);
          this.tileLayer = null;
          toast("Die eigene Kachel-URL konnte nicht geladen werden. Die Standardkarte bleibt sichtbar.", "warn");
        }
      });
      this.tileLayer.addTo(this.map);
    }
  },

  refreshSize() { if (this.map) setTimeout(() => this.map.invalidateSize(), 50); },

  /* -------------------------------------------------------------- Daten */

  async loadData() {
    this.data = null;
    this.loadedOk = { playerspawns: false, events: false, objects: false };
    Object.values(this.groups).forEach((group) => group.clearLayers());
    try {
      this.data = await api("/api/map/data");
      this.loadedOk.playerspawns = !this.data.warnings.some((w) => w.includes("cfgplayerspawnpoints"));
      this.loadedOk.events = !this.data.warnings.some((w) => w.includes("cfgeventspawns"));
      this.loadedOk.objects = !this.data.warnings.some((w) => w.includes("mapobjects"));
      this.data.warnings.forEach((w) => toast(w, "warn"));
      this.fillEventSelect();
      this.redraw();
      this.setDirty(false);
      return true;
    } catch (err) {
      toast("Kartendaten konnten nicht geladen werden: " + err.message, "error");
      return false;
    }
  },

  fillEventSelect() {
    const sel = $("#event-select");
    const current = sel.value;
    sel.innerHTML = "";
    this.data.events.forEach((ev) => {
      const opt = document.createElement("option");
      opt.value = ev.name;
      opt.textContent = ev.name + " (" + ev.positions.length + ")";
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  },

  setDirty(dirty, part) {
    if (!dirty) {
      for (const key of Object.keys(this.dirtyParts)) this.dirtyParts[key] = false;
    } else if (part && part in this.dirtyParts) {
      this.dirtyParts[part] = true;
    }
    this.dirty = Object.values(this.dirtyParts).some(Boolean);
    $("#map-dirty").classList.toggle("hidden", !this.dirty);
  },

  /* ------------------------------------------------------------ Zeichnen */

  redraw() {
    if (!this.data) return;
    Object.values(this.groups).forEach((g) => g.clearLayers());

    for (const section of ["fresh", "hop", "travel"]) {
      (this.data.playerspawns[section] || []).forEach((point) => {
        this.addDot(this.groups[section], LAYER_STYLE[section], point, {
          part: "playerspawns",
          title: LAYER_STYLE[section].label,
          onDelete: () => {
            const arr = this.data.playerspawns[section];
            arr.splice(arr.indexOf(point), 1);
          },
        });
      });
    }
    this.data.events.forEach((ev) => {
      ev.positions.forEach((point) => {
        this.addDot(this.groups.events, LAYER_STYLE.events, point, {
          part: "events",
          title: "Event: " + ev.name,
          onDelete: () => {
            ev.positions.splice(ev.positions.indexOf(point), 1);
            this.fillEventSelect();
          },
        });
      });
    });
    this.data.objects.forEach((obj) => {
      this.addDot(this.groups.objects, LAYER_STYLE.objects, obj, {
        part: "objects",
        title: "Objekt: " + obj.name,
        extra: "Höhe Y: " + obj.y + " m · Drehung: " + obj.yaw + "°",
        onDelete: () => {
          this.data.objects.splice(this.data.objects.indexOf(obj), 1);
        },
      });
    });
  },

  addDot(group, style, point, opts) {
    const marker = L.marker([point.z, point.x], {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: '<span style="display:block;width:14px;height:14px;border-radius:50%;' +
              "background:" + style.color + ';border:2px solid #000c;box-shadow:0 0 4px #000"></span>',
        iconSize: [14, 14], iconAnchor: [7, 7],
      }),
    });
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      const world = this.world();
      point.x = Math.max(0, Math.min(world, Math.round(pos.lng * 10) / 10));
      point.z = Math.max(0, Math.min(world, Math.round(pos.lat * 10) / 10));
      marker.setLatLng([point.z, point.x]);
      this.setDirty(true, opts.part);
      marker.setPopupContent(this.popupHtml(point, opts));
    });
    marker.bindPopup(this.popupHtml(point, opts));
    marker.on("popupopen", (ev) => {
      const btn = ev.popup.getElement().querySelector(".btn-del");
      if (btn) btn.addEventListener("click", () => {
        opts.onDelete();
        this.setDirty(true, opts.part);
        this.redraw();
      });
    });
    group.addLayer(marker);
  },

  popupHtml(point, opts) {
    return "<b>" + esc(opts.title) + "</b><br>" +
      "X: " + point.x + " · Z: " + point.z +
      (opts.extra ? "<br>" + esc(opts.extra) : "") +
      '<div class="popup-actions"><button class="btn-del danger small">🗑 Löschen</button></div>';
  },

  /* ---------------------------------------------------------- Bearbeiten */

  onMapClick(ev) {
    if (!this.data) return;
    const x = Math.round(ev.latlng.lng * 10) / 10;
    const z = Math.round(ev.latlng.lat * 10) / 10;
    if (x < 0 || z < 0 || x > this.world() || z > this.world()) return;
    const mode = document.querySelector('input[name="layer"]:checked').value;

    if (mode === "spawns") {
      const section = $("#spawn-section").value;
      if (!this.loadedOk.playerspawns)
        return toast("cfgplayerspawnpoints.xml wurde nicht geladen – Bearbeiten deaktiviert.", "warn");
      this.data.playerspawns[section].push({ x, z });
      this.setDirty(true, "playerspawns");
      this.redraw();
    } else if (mode === "events") {
      if (!this.loadedOk.events)
        return toast("cfgeventspawns.xml wurde nicht geladen – Bearbeiten deaktiviert.", "warn");
      const name = $("#event-select").value;
      if (!name) return toast("Bitte zuerst rechts ein Event auswählen oder anlegen.", "warn");
      const ev2 = this.data.events.find((e) => e.name === name);
      ev2.positions.push({ x, z, a: 0 });
      this.fillEventSelect();
      this.setDirty(true, "events");
      this.redraw();
    } else if (mode === "objects") {
      this.askNewObject(x, z);
    }
  },

  askNewObject(x, z) {
    const html =
      '<b>Neues Objekt platzieren</b><br>' +
      '<input id="obj-name" placeholder="Klassenname, z.B. Land_Mil_Barracks6" style="margin:6px 0"><br>' +
      '<input id="obj-y" type="number" value="0" title="Höhe Y in Metern" style="width:90px"> Höhe (Y)&nbsp;' +
      '<input id="obj-yaw" type="number" value="0" title="Drehung in Grad" style="width:70px"> Drehung°<br>' +
      '<small>Tipp: Höhe = Geländehöhe an der Stelle (z.B. aus iZurvive ablesen).</small>' +
      '<div class="popup-actions"><button class="btn-add primary small">Hinzufügen</button></div>';
    const popup = L.popup({ maxWidth: 320 }).setLatLng([z, x]).setContent(html).openOn(this.map);
    popup.getElement().querySelector(".btn-add").addEventListener("click", () => {
      const name = popup.getElement().querySelector("#obj-name").value.trim();
      if (!name) return toast("Bitte einen Klassennamen eingeben.", "warn");
      this.data.objects.push({
        name, x, z,
        y: Number(popup.getElement().querySelector("#obj-y").value) || 0,
        yaw: Number(popup.getElement().querySelector("#obj-yaw").value) || 0,
      });
      this.map.closePopup();
      this.setDirty(true, "objects");
      this.redraw();
    });
  },

  /* ------------------------------------------------------------ Speichern */

  async save() {
    if (!this.data) return false;
    const payload = {};
    if (this.dirtyParts.playerspawns && this.loadedOk.playerspawns)
      payload.playerspawns = this.data.playerspawns;
    if (this.dirtyParts.events && this.loadedOk.events)
      payload.events = this.data.events;
    if (this.dirtyParts.objects && (this.loadedOk.objects || this.data.objects.length))
      payload.objects = this.data.objects;
    if (!Object.keys(payload).length) {
      toast("Es gibt keine Kartenänderungen zum Speichern.", "warn");
      return false;
    }
    try {
      const result = await api("/api/map/save", payload);
      toast("Gespeichert: " + result.saved.join(", ") + " (Backups angelegt)");
      this.setDirty(false);
      return true;
    } catch (err) {
      toast("Speichern fehlgeschlagen: " + err.message, "error");
      return false;
    }
  },

  /* ---------------------------------------------------------------- UI */

  bindUi() {
    $$('#map-switch-main button').forEach((btn) => {
      btn.addEventListener("click", () => this.setMap(btn.dataset.mapkey));
    });
    this.updateSwitchButtons();
    $$('input[name="layer"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        $("#spawn-sub").classList.toggle("hidden", radio.value !== "spawns" || !radio.checked);
        $("#event-sub").classList.toggle("hidden", radio.value !== "events" || !radio.checked);
      });
    });
    const toggles = [
      ["#show-spawns", ["fresh", "hop", "travel"]],
      ["#show-events", ["events"]],
      ["#show-objects", ["objects"]],
    ];
    toggles.forEach(([sel, keys]) => {
      $(sel).addEventListener("change", (ev) => {
        keys.forEach((key) => {
          if (ev.target.checked) this.map.addLayer(this.groups[key]);
          else this.map.removeLayer(this.groups[key]);
        });
      });
    });
    $("#btn-new-event").addEventListener("click", () => {
      const name = prompt("Name des Events (wie in db/events.xml, z.B. StaticHeliCrash):");
      if (!name || !name.trim()) return;
      if (!this.data.events.some((e) => e.name === name.trim())) {
        this.data.events.push({ name: name.trim(), positions: [] });
        this.setDirty(true, "events");
      }
      this.fillEventSelect();
      $("#event-select").value = name.trim();
    });
    $("#btn-map-save").addEventListener("click", () => this.save());
    $("#btn-map-save-restart").addEventListener("click", async () => {
      if (!(await this.save())) return;
      if (!confirm("Server jetzt neu starten, damit die Änderungen aktiv werden?")) return;
      try {
        await api("/api/server/restart", {});
        toast("Neustart ausgelöst – in ein paar Minuten ist alles live.");
      } catch (err) { toast(err.message, "error"); }
    });
  },
};

window.DayZMap = DayZMap;

/* Gemeinsame Karten-Bausteine für andere Module (z.B. Mini-Karte im
 * Tools-Tab), damit CRS/Kacheln/Gitter nicht dupliziert werden müssen. */
window.DayZMapShared = {
  MAPS,
  GridBackdrop,
  tileUrl,
  currentKey: () => DayZMap.mapKey,
  worldSize: () => MAPS[DayZMap.mapKey].size,
  setMap: (key, persist) => DayZMap.setMap(key, persist),
  makeCrs(size) {
    return L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(256 / size, 0, -256 / size, 256),
    });
  },
};
