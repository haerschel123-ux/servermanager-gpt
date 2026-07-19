/* 🧰 Tools-Tab: fertige Generatoren für beliebte Server-Anpassungen.
 *
 * Jedes Tool erzeugt "Pläne": {path, summary[], transform(alterText)->neuerText}.
 * Ablauf: Formular → Vorschau (Diff) → Übernehmen (Staging) → Speichern
 * (lädt jede Datei frisch, wendet alle vorgemerkten Transformationen an und
 * schreibt sie mit automatischem Backup über /api/file zurück).
 *
 * Die App läuft rein statisch im Browser. api() aus app.js reicht Datei- und
 * Serverzugriffe an den browserseitigen Nitrado-Direktmodus weiter; ein
 * eigenes Backend gibt es nicht.
 */
"use strict";

const Tools = (() => {

  /* ================================================== Kleine DOM-Helfer */

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      el.append(child.nodeType ? child : document.createTextNode(child));
    }
    return el;
  }

  const num = (value, fallback) => {
    const s = String(value).trim().replace(",", ".");
    if (s === "") return fallback;   // Number("") wäre 0 – hier Fallback
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  };

  /* Gas-Partikel-Effekte (auswählbar im Gaszonen-Tool) */
  const GAS_PARTICLES = [
    ["graphics/particles/contaminated_area_gas_bigass", "Groß (Standard)"],
    ["graphics/particles/contaminated_area_gas", "Mittel"],
    ["graphics/particles/contaminated_area_gas_small", "Klein"],
  ];

  /* Bewegungsstil einer Zombie-Horde → smin/smax/dmin/dmax */
  const HORDE_MOVEMENT = {
    stationary: { label: "Stehend (bleibt am Ort)", smin: 0, smax: 0, dmin: 30, dmax: 30 },
    patrol: { label: "Patrouille (läuft umher)", smin: 2, smax: 5, dmin: 10, dmax: 50 },
    dynamic: { label: "Aggressiv (verfolgt weit)", smin: 5, smax: 10, dmin: 5, dmax: 20 },
  };

  /* Zombie-Klassen nach Kategorie – damit niemand Klassennamen tippen muss */
  const ZOMBIE_DATA = {
    InfectedArmy: ["ZmbM_PatrolNormal_Autumn", "ZmbM_PatrolNormal_Flat", "ZmbM_PatrolNormal_PautRev", "ZmbM_PatrolNormal_Summer", "ZmbM_SoldierNormal", "ZmbM_usSoldier_normal_Desert", "ZmbM_usSoldier_normal_Woodland"],
    InfectedArmyHard: ["ZmbM_PatrolNormal_Autumn", "ZmbM_PatrolNormal_Flat", "ZmbM_PatrolNormal_PautRev", "ZmbM_PatrolNormal_Summer", "ZmbM_SoldierNormal", "ZmbM_usSoldier_Heavy_Woodland", "ZmbM_usSoldier_Officer_Desert", "ZmbM_usSoldier_normal_Desert", "ZmbM_usSoldier_normal_Woodland"],
    InfectedCity: ["ZmbF_CitizenANormal_Blue", "ZmbF_CitizenBSkinny", "ZmbF_Clerk_Normal_Blue", "ZmbF_JournalistNormal_Blue", "ZmbF_ShortSkirt_beige", "ZmbF_SkaterYoung_Brown", "ZmbF_SurvivorNormal_Blue", "ZmbM_CitizenASkinny_Blue", "ZmbM_CitizenBFat_Blue", "ZmbM_ClerkFat_Grey", "ZmbM_CommercialPilotOld_Blue", "ZmbM_Gamedev_Black", "ZmbM_JournalistSkinny", "ZmbM_SkaterYoung_Brown"],
    InfectedFirefighter: ["ZmbM_FirefighterNormal", "ZmbM_NBC_Yellow"],
    InfectedIndustrial: ["ZmbF_BlueCollarFat_Blue", "ZmbF_MechanicNormal_Beige", "ZmbM_ConstrWorkerNormal_Beige", "ZmbM_HandymanNormal_Beige", "ZmbM_HeavyIndustryWorker", "ZmbM_MechanicSkinny_Blue", "ZmbM_OffshoreWorker_Green"],
    InfectedMedic: ["ZmbF_DoctorSkinny", "ZmbF_NurseFat", "ZmbF_ParamedicNormal_Blue", "ZmbM_DoctorFat", "ZmbM_ParamedicNormal_Black", "ZmbM_PatientSkinny"],
    InfectedNBC: ["ZmbM_NBC_Grey", "ZmbM_NBC_Yellow"],
    InfectedPolice: ["ZmbF_PoliceWomanNormal", "ZmbM_PolicemanFat", "ZmbM_PolicemanSpecForce", "ZmbM_PolicemanSpecForce_Heavy"],
    InfectedPrisoner: ["ZmbM_PrisonerSkinny"],
    InfectedReligious: ["ZmbM_priestPopSkinny"],
    InfectedSanta: ["ZmbM_Santa"],
    InfectedSolitude: ["ZmbF_HikerSkinny_Blue", "ZmbM_FishermanOld_Blue", "ZmbM_HermitSkinny_Beige", "ZmbM_HikerSkinny_Blue", "ZmbM_HunterOld_Autumn"],
    InfectedVillage: ["ZmbF_JoggerSkinny_Blue", "ZmbF_MilkMaidOld_Beige", "ZmbF_VillagerOld_Green", "ZmbM_FarmerFat_Blue", "ZmbM_Jacket_beige", "ZmbM_JoggerSkinny_Blue", "ZmbM_VillagerOld_Blue"],
  };

  /* ===================================================== XML-Werkzeuge */

  /* Zum Lesen, Vorbelegen und zur abschließenden Validierung. Geschrieben wird
     unten per chirurgischem Text-Edit; vor Vorschau und Upload muss das
     Ergebnis trotzdem ein vollständig gültiges XML-Dokument sein. */
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("Datei enthält fehlerhaftes XML.");
    return doc;
  }

  function validateGeneratedFile(path, text) {
    if (/\.xml$/i.test(path)) parseXml(text);
    if (/\.json$/i.test(path)) JSON.parse(text);
  }

  /* ------------------------------------ Chirurgische Text-Edits (XML) --
   * Statt die ganze Datei zu parsen und komplett neu zu schreiben, wird nur
   * der betroffene Block ersetzt bzw. eingefügt. Der Rest der Datei bleibt
   * Byte für Byte erhalten – und Fehler an anderen Stellen der Datei
   * stören nicht. */

  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* Zeilenende-Stil der Datei übernehmen (Windows \r\n vs. \n) */
  const eol = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

  /* `<tag … name="X" …>…</tag>` (oder self-closing) samt Einrückung finden */
  function findNamedBlock(text, tag, name) {
    const re = new RegExp(
      "[ \\t]*<" + tag + "(?=[\\s/>])[^>]*\\bname=([\"'])" + escRe(name) + "\\1[^>]*" +
      "(?:/>|>[\\s\\S]*?</" + tag + "\\s*>)");
    const m = re.exec(text);
    return m ? { start: m.index, end: m.index + m[0].length, block: m[0] } : null;
  }

  /* Snippet als neuen Eintrag direkt vor dem schließenden Root-Tag einfügen */
  function insertIntoRoot(text, rootTag, snippet) {
    const idx = text.lastIndexOf("</" + rootTag);
    if (idx === -1)
      throw new Error("Kein schließendes </" + rootTag + "> in der Datei gefunden – " +
                      "ist das die richtige Datei?");
    const nl = eol(text);
    let head = text.slice(0, idx);
    // Einrückung der Schlusszeile abtrennen und hinterher wiederherstellen
    const closeIndent = (/(?:^|\n)([ \t]*)$/.exec(head) || [, ""])[1];
    head = head.slice(0, head.length - closeIndent.length);
    if (head && !head.endsWith("\n")) head += nl;
    return head + "    " + snippet.replace(/\n/g, nl) + nl +
           closeIndent + text.slice(idx);
  }

  /* Benannten Block ersetzen oder – falls nicht vorhanden – neu einfügen */
  function upsertNamedBlock(text, rootTag, tag, name, snippet) {
    const found = findNamedBlock(text, tag, name);
    if (!found) return insertIntoRoot(text, rootTag, snippet);
    const indent = (/^[ \t]*/.exec(found.block) || [""])[0];
    return text.slice(0, found.start) + indent +
           snippet.replace(/\n/g, eol(text)) + text.slice(found.end);
  }

  const fmtNum = (v) => {
    const n = Number(v) || 0;
    return n === Math.trunc(n) ? String(n) : n.toFixed(1);
  };

  const escXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function findElementByName(root, selector, name) {
    return Array.from(root.querySelectorAll(selector))
      .find((el) => el.getAttribute("name") === name) || null;
  }

  /* Bereich eines direkten XML-Kindes im Originaltext finden. Damit lassen
     sich einzelne Event-Felder aktualisieren, ohne den restlichen Event-Block
     (Kommentare, unbekannte Felder/Attribute und Formatierung) neu zu bauen. */
  function findDirectChildRange(block, parentTag, childTag) {
    const tagRe = /<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\?[^]*?\?>|<\/?\s*([A-Za-z_][\w:.-]*)\b(?:"[^"]*"|'[^']*'|[^'"<>])*?>/g;
    const stack = [];
    let target = null;
    for (const match of block.matchAll(tagRe)) {
      const name = match[1];
      if (!name) continue;
      const token = match[0];
      const closing = /^<\s*\//.test(token);
      if (closing) {
        if (target && stack.length === 2 && stack[0] === parentTag &&
            stack[1] === childTag && name === childTag) {
          return { ...target, closeStart: match.index,
                   end: match.index + token.length, selfClosing: false };
        }
        stack.pop();
        continue;
      }
      const selfClosing = /\/\s*>$/.test(token);
      if (stack.length === 1 && stack[0] === parentTag && name === childTag) {
        const range = { start: match.index, startTagEnd: match.index + token.length,
                        end: match.index + token.length, selfClosing };
        if (selfClosing) return range;
        target = range;
      }
      if (!selfClosing) stack.push(name);
    }
    return null;
  }

  function directChildIndent(block, parentTag) {
    const open = new RegExp("<" + parentTag + "(?=[\\s>])[^>]*>").exec(block);
    if (!open) return "        ";
    const tail = block.slice(open.index + open[0].length);
    const existing = /^\r?\n([ \t]+)</.exec(tail);
    if (existing) return existing[1];
    const lineStart = block.lastIndexOf("\n", open.index) + 1;
    const parentIndent = (/^[ \t]*/.exec(block.slice(lineStart, open.index)) || [""])[0];
    return parentIndent + "    ";
  }

  function insertDirectChild(block, parentTag, snippet) {
    const open = new RegExp("<" + parentTag + "(?=[\\s>])[^>]*>").exec(block);
    if (!open) return block;
    const nl = eol(block);
    const at = open.index + open[0].length;
    return block.slice(0, at) + nl + directChildIndent(block, parentTag) + snippet +
           block.slice(at);
  }

  function replaceDirectChildText(block, parentTag, childTag, value) {
    const range = findDirectChildRange(block, parentTag, childTag);
    if (!range) return insertDirectChild(block, parentTag,
      "<" + childTag + ">" + escXml(value) + "</" + childTag + ">");
    if (range.selfClosing) {
      const open = block.slice(range.start, range.end).replace(/\s*\/>$/, ">");
      return block.slice(0, range.start) + open + escXml(value) +
             "</" + childTag + ">" + block.slice(range.end);
    }
    return block.slice(0, range.startTagEnd) + escXml(value) +
           block.slice(range.closeStart);
  }

  function setXmlAttribute(tag, attribute, value) {
    const re = new RegExp("(\\s" + escRe(attribute) + "\\s*=\\s*)([\\\"'])([^\\\"']*)\\2");
    if (re.test(tag)) return tag.replace(re,
      (_all, prefix, quote) => prefix + quote + escXml(value) + quote);
    return tag.replace(/(\s*\/?>)$/, " " + attribute + "=\"" + escXml(value) + "\"$1");
  }

  const EVENT_FIELDS = ["nominal", "min", "max", "lifetime", "restock",
    "saferadius", "distanceradius", "cleanupradius", "position", "limit", "active"];
  const EVENT_DEFAULTS = {
    nominal: 1, min: 1, max: 1, lifetime: 1800, restock: 0,
    saferadius: 500, distanceradius: 500, cleanupradius: 1000,
    position: "fixed", limit: "custom", active: 1,
  };
  const EVENT_FLAG_DEFAULTS = { deletable: 0, init_random: 0, remove_damaged: 1 };

  function eventDefinitionFromElement(ev) {
    const read = (field) => {
      const node = Array.from(ev.children).find((el) => el.localName === field);
      const fallback = EVENT_DEFAULTS[field];
      if (!node) return fallback;
      return typeof fallback === "number" ? num(node.textContent, fallback)
                                           : node.textContent.trim();
    };
    const flagNode = Array.from(ev.children).find((el) => el.localName === "flags");
    const flags = {};
    for (const [name, fallback] of Object.entries(EVENT_FLAG_DEFAULTS)) {
      const raw = flagNode && flagNode.getAttribute(name);
      flags[name] = raw === null || raw === undefined ? fallback : num(raw, fallback);
    }
    const childrenNode = Array.from(ev.children).find((el) => el.localName === "children");
    const children = childrenNode ? Array.from(childrenNode.children)
      .filter((el) => el.localName === "child").map((child) => ({
        type: child.getAttribute("type") || "",
        max: num(child.getAttribute("max"), 1),
        min: num(child.getAttribute("min"), 1),
        lootmax: num(child.getAttribute("lootmax"), 0),
        lootmin: num(child.getAttribute("lootmin"), 0),
      })) : [];
    return {
      name: ev.getAttribute("name") || "",
      ...Object.fromEntries(EVENT_FIELDS.map((field) => [field, read(field)])),
      flags, children,
    };
  }

  function parseEventDefinition(text, name) {
    const doc = parseXml(text);
    const ev = findElementByName(doc, "events > event", name);
    return ev ? eventDefinitionFromElement(ev) : null;
  }

  const eventChildrenKey = (children) => JSON.stringify((children || []).map((child) => ({
    type: String(child.type || ""), max: Number(child.max), min: Number(child.min),
    lootmax: Number(child.lootmax), lootmin: Number(child.lootmin),
  })));

  function replaceEventChildren(block, children) {
    const range = findDirectChildRange(block, "event", "children");
    const nl = eol(block);
    const parentIndent = directChildIndent(block, "event");
    const childIndent = parentIndent + "    ";
    const lines = (children || []).map((child) => childIndent +
      `<child lootmax="${child.lootmax ?? 0}" lootmin="${child.lootmin ?? 0}" ` +
      `max="${child.max}" min="${child.min}" type="${escXml(child.type)}"/>`).join(nl);
    const snippet = "<children>" + (lines ? nl + lines : "") + nl +
                    parentIndent + "</children>";
    if (!range) return insertDirectChild(block, "event", snippet);
    return block.slice(0, range.start) + snippet + block.slice(range.end);
  }

  /* Beim Bearbeiten einer geladenen Vorlage nur wirklich geänderte Werte im
     frisch gelesenen Servertext anfassen. Unbekannte/zusätzliche Felder und
     Flag-Attribute bleiben dadurch erhalten. */
  function updateEventTemplate(text, loadedName, def, baseline) {
    if (!loadedName || def.name !== loadedName || !baseline)
      return upsertEvent(text, def);
    const found = findNamedBlock(text, "event", loadedName);
    if (!found) return upsertEvent(text, def);
    let block = found.block;
    for (const field of EVENT_FIELDS) {
      if (String(def[field]) !== String(baseline[field]))
        block = replaceDirectChildText(block, "event", field, def[field]);
    }
    const changedFlags = Object.keys(EVENT_FLAG_DEFAULTS)
      .filter((name) => Number(def.flags[name]) !== Number(baseline.flags[name]));
    if (changedFlags.length) {
      const range = findDirectChildRange(block, "event", "flags");
      if (!range) {
        const values = { ...EVENT_FLAG_DEFAULTS, ...def.flags };
        block = insertDirectChild(block, "event",
          `<flags deletable="${values.deletable}" init_random="${values.init_random}" ` +
          `remove_damaged="${values.remove_damaged}"/>`);
      } else {
        let opening = block.slice(range.start, range.startTagEnd);
        for (const name of changedFlags)
          opening = setXmlAttribute(opening, name, def.flags[name]);
        block = block.slice(0, range.start) + opening + block.slice(range.startTagEnd);
      }
    }
    if (eventChildrenKey(def.children) !== eventChildrenKey(baseline.children))
      block = replaceEventChildren(block, def.children);
    return text.slice(0, found.start) + block + text.slice(found.end);
  }

  /* events.xml: Event komplett anlegen/ersetzen */
  function upsertEvent(text, def) {
    const flags = def.flags || { deletable: 0, init_random: 0, remove_damaged: 1 };
    const kids = (def.children || []).map((c) =>
      `        <child lootmax="${c.lootmax ?? 0}" lootmin="${c.lootmin ?? 0}" ` +
      `max="${c.max}" min="${c.min}" type="${escXml(c.type)}"/>`).join("\n");
    const snippet =
`<event name="${escXml(def.name)}">
        <nominal>${def.nominal}</nominal>
        <min>${def.min}</min>
        <max>${def.max}</max>
        <lifetime>${def.lifetime}</lifetime>
        <restock>${def.restock}</restock>
        <saferadius>${def.saferadius}</saferadius>
        <distanceradius>${def.distanceradius}</distanceradius>
        <cleanupradius>${def.cleanupradius}</cleanupradius>
        <flags deletable="${flags.deletable}" init_random="${flags.init_random}" remove_damaged="${flags.remove_damaged}"/>
        <position>${def.position || "fixed"}</position>
        <limit>${def.limit || "custom"}</limit>
        <active>${def.active ?? 1}</active>
        <children>
${kids}
        </children>
    </event>`;
    return upsertNamedBlock(text, "events", "event", def.name, snippet);
  }

  /* events.xml: nur Zahlenfelder eines vorhandenen Events ändern */
  function updateEventCounts(text, name, values) {
    const found = findNamedBlock(text, "event", name);
    if (!found) throw new Error(`Event "${name}" nicht in events.xml gefunden.`);
    let block = found.block;
    const nl = eol(text);
    for (const [field, value] of Object.entries(values)) {
      const re = new RegExp("(<" + field + "\\s*>)[^<]*(</" + field + "\\s*>)");
      if (re.test(block)) {
        block = block.replace(re, "$1" + value + "$2");
      } else {
        block = block.replace(/(<event[^>]*>)/,
          "$1" + nl + "        <" + field + ">" + value + "</" + field + ">");
      }
    }
    return text.slice(0, found.start) + block + text.slice(found.end);
  }

  /* cfgeventspawns.xml: Event-Block holen oder leer anlegen; self-closing
     Blöcke (<event …/>) werden zum offenen Block erweitert. */
  function ensureSpawnEventBlock(text, name) {
    let found = findNamedBlock(text, "event", name);
    if (!found) {
      text = insertIntoRoot(text, "eventposdef",
        `<event name="${escXml(name)}">\n    </event>`);
      found = findNamedBlock(text, "event", name);
    }
    let block = found.block;
    if (/\/>\s*$/.test(block))
      block = block.replace(/\s*\/>\s*$/, ">" + eol(text) + "    </event>");
    return { text, found, block };
  }

  /* cfgeventspawns.xml: Positionen eines Events setzen/ergänzen */
  function upsertEventspawns(text, name, positions, mode) {
    const ctx = ensureSpawnEventBlock(text, name);
    text = ctx.text;
    let block = ctx.block;
    const nl = eol(text);
    const existing = new Set();
    if (mode === "replace") {
      block = block.replace(/[ \t]*<pos\b[^>]*\/>[ \t]*\r?\n?/g, "");
    } else {
      for (const m of block.matchAll(/<pos\b[^>]*?\bx="([^"]+)"[^>]*?\bz="([^"]+)"/g))
        existing.add(Math.round(Number(m[1])) + "/" + Math.round(Number(m[2])));
    }
    let added = 0, lines = "";
    for (const point of positions) {
      const key = Math.round(point.x) + "/" + Math.round(point.z);
      if (existing.has(key)) continue;
      existing.add(key);
      lines += '        <pos x="' + fmtNum(point.x) + '" z="' + fmtNum(point.z) +
               '" a="' + fmtNum(point.a || 0) + '"/>' + nl;
      added += 1;
    }
    block = block.replace(/([ \t]*)<\/event\s*>$/, lines + "$1</event>");
    return { text: text.slice(0, ctx.found.start) + block + text.slice(ctx.found.end),
             added };
  }

  /* cfgeventspawns.xml: Zonen (<zone> mit Bewegungsradius) eines Events setzen –
     korrektes Format für Zombie-Horden. Ersetzt vorhandene zone/pos des Events. */
  function writeEventZones(text, name, zones) {
    const ctx = ensureSpawnEventBlock(text, name);
    text = ctx.text;
    let block = ctx.block;
    const nl = eol(text);
    block = block.replace(/[ \t]*<(?:zone|pos)\b[^>]*\/>[ \t]*\r?\n?/g, "");
    let lines = "";
    for (const z of zones) {
      lines += '        <zone smin="' + z.smin + '" smax="' + z.smax +
               '" dmin="' + z.dmin + '" dmax="' + z.dmax + '" r="' + z.r +
               '" x="' + fmtNum(z.x) + '" y="' + fmtNum(z.y || 0) +
               '" z="' + fmtNum(z.z) + '"/>' + nl;
    }
    block = block.replace(/([ \t]*)<\/event\s*>$/, lines + "$1</event>");
    return text.slice(0, ctx.found.start) + block + text.slice(ctx.found.end);
  }

  const chanceText = (value) => Math.max(0, Math.min(1, Number(value) || 0)).toFixed(2);

  function spawnableDefinitionFromElement(typeNode) {
    const blocks = Array.from(typeNode.children)
      .filter((block) => block.localName === "attachments" || block.localName === "cargo")
      .map((block) => ({
        kind: block.localName,
        chance: num(block.getAttribute("chance"), 1),
        items: Array.from(block.children).filter((item) => item.localName === "item")
          .map((item) => ({
            name: item.getAttribute("name") || "",
            chance: num(item.getAttribute("chance"), 1),
          })),
      }));
    return { name: typeNode.getAttribute("name") || "", blocks };
  }

  function parseSpawnableType(text, name) {
    const doc = parseXml(text);
    const typeNode = findElementByName(doc, "spawnabletypes > type", name);
    return typeNode ? spawnableDefinitionFromElement(typeNode) : null;
  }

  const spawnableBlocksKey = (blocks) => JSON.stringify((blocks || []).map((block) => ({
    kind: block.kind,
    chance: Number(block.chance),
    items: (block.items || []).map((item) => ({
      name: String(item.name || ""), chance: Number(item.chance),
    })),
  })));

  function renderSpawnableType(name, blocks) {
    const body = (blocks || []).map((block) => {
      const items = (block.items || []).map((item) =>
        `            <item name="${escXml(item.name)}" chance="${chanceText(item.chance)}"/>`)
        .join("\n");
      return `        <${block.kind} chance="${chanceText(block.chance)}">\n${items}\n` +
             `        </${block.kind}>`;
    }).join("\n");
    return `<type name="${escXml(name)}">\n${body}\n    </type>`;
  }

  function upsertSpawnableTypeBlocks(text, name, blocks) {
    return upsertNamedBlock(text, "spawnabletypes", "type", name,
                            renderSpawnableType(name, blocks));
  }

  /* Bestehende Aufrufer übergeben eine flache Zeile je Block. Die
     vollständig strukturierte Variante oben behält zusätzlich mehrere Items
     innerhalb desselben attachments-/cargo-Blocks bei. */
  function upsertSpawnableType(text, name, rows) {
    return upsertSpawnableTypeBlocks(text, name, rows.map((row) => ({
      kind: row.kind, chance: row.chance,
      items: [{ name: row.item, chance: row.itemChance ?? 1 }],
    })));
  }

  function updateSpawnableType(text, name, blocks, baseline) {
    if (baseline && spawnableBlocksKey(blocks) === spawnableBlocksKey(baseline.blocks))
      return text;
    return upsertSpawnableTypeBlocks(text, name, blocks);
  }

  function mergeSpawnableBlockKinds(attachments, cargo, baseline) {
    const remaining = {
      attachments: [...attachments],
      cargo: [...cargo],
    };
    const merged = [];
    for (const oldBlock of (baseline && baseline.blocks) || []) {
      const queue = remaining[oldBlock.kind];
      if (queue && queue.length) merged.push(queue.shift());
    }
    return [...merged, ...remaining.attachments, ...remaining.cargo];
  }

  /* Fahrzeug-Editor: unveränderte Gruppen bleiben erhalten. Nur bewusst
     geänderte Stückzahlen entfernen Vorkommen oder ergänzen neue 100%-Blöcke. */
  function applySpawnableItemCounts(blocks, desiredRows) {
    const desired = new Map();
    desiredRows.forEach((row) => desired.set(row.item,
      (desired.get(row.item) || 0) + Math.max(0, Math.round(row.num))));
    const result = (blocks || []).map((block) => ({
      kind: block.kind, chance: block.chance,
      items: (block.items || []).map((item) => ({ ...item })),
    }));
    const occurrences = new Map();
    result.forEach((block) => block.items.forEach((item) => {
      if (!occurrences.has(item.name)) occurrences.set(item.name, []);
      occurrences.get(item.name).push({ block, item });
    }));
    for (const [name, refs] of occurrences) {
      const wanted = desired.has(name) ? desired.get(name) : 0;
      for (let i = refs.length - 1; i >= wanted; i -= 1) {
        const { block, item } = refs[i];
        block.items.splice(block.items.indexOf(item), 1);
      }
      desired.delete(name);
      for (let i = refs.length; i < wanted; i += 1)
        result.push({ kind: "attachments", chance: 1,
                      items: [{ name, chance: 1 }] });
    }
    for (const [name, count] of desired) {
      for (let i = 0; i < count; i += 1)
        result.push({ kind: "attachments", chance: 1,
                      items: [{ name, chance: 1 }] });
    }
    return result.filter((block) => block.items.length);
  }

  /* ================================================== Datei-Zugriff */

  const mission = (rel) => (App.state.mission_dir || "") + "/" + rel;

  /* Der Nitrado-Dateiserver ist case-sensitiv – die tatsächliche Schreibweise
     einer Datei im Missionsordner nachschlagen (z.B. cfgEffectArea.json),
     damit vorhandene Dateien ergänzt statt doppelt angelegt werden. */
  let missionFiles = null;
  async function missionPath(rel) {
    if (rel.includes("/")) return mission(rel);   // Unterordner: unverändert
    try {
      if (!missionFiles) {
        const data = await api("/api/files?dir=" +
          encodeURIComponent(App.state.mission_dir || ""));
        missionFiles = data.entries.filter((e) => e.type === "file").map((e) => e.name);
      }
      const hit = missionFiles.find((n) => n.toLowerCase() === rel.toLowerCase());
      return mission(hit || rel);
    } catch (err) {
      return mission(rel);
    }
  }

  async function readOrNull(path) {
    try {
      return (await api("/api/file?path=" + encodeURIComponent(path))).content;
    } catch (err) {
      const msg = String(err.message || "");
      if (/404|nicht gefunden|doesn't exist|does not exist|fehlgeschlagen \(4/i.test(msg)) return null;
      throw err;
    }
  }

  /* Datei als XML-Dokument lesen – null bei "fehlt" oder Parse-Fehler.
     (Vorbelegungen sind optional und dürfen das Tool nie blockieren.) */
  async function readXmlOrNull(path) {
    try {
      const text = await readOrNull(path);
      return text ? parseXml(text) : null;
    } catch (err) {
      return null;
    }
  }

  async function readJsonOrNull(path) {
    try {
      const text = await readOrNull(path);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      return null;
    }
  }

  let itemCache = null;
  async function itemNames() {
    if (!itemCache) {
      try {
        itemCache = (await api("/api/types")).types.map((t) => t.name);
      } catch (err) {
        itemCache = [];
      }
    }
    return itemCache;
  }

  async function ensureDatalists() {
    if (document.getElementById("dl-items")) return;
    const names = await itemNames();
    const all = h("datalist", { id: "dl-items" });
    const zmb = h("datalist", { id: "dl-zmb" });
    for (const name of names) {
      all.append(h("option", { value: name }));
      if (name.startsWith("Zmb")) zmb.append(h("option", { value: name }));
    }
    document.body.append(all, zmb);
  }

  /* =============================================== Formular-Bausteine */

  function field(label, input) {
    return h("div", { class: "field" }, h("label", { class: "fl" }, label), input);
  }

  /* Auswahl "Neu anlegen oder vorhandenen Eintrag bearbeiten": Dropdown mit
     allen vorhandenen Einträgen; bei Auswahl füllt onPick das Formular. */
  function loadPicker(newLabel, names, onPick) {
    const sel = h("select", {}, h("option", { value: "" }, newLabel));
    for (const n of names) sel.append(h("option", { value: n }, n));
    sel.addEventListener("change", () => onPick(sel.value));
    return field("Neu oder bearbeiten?", sel);
  }

  function textInput(id, value, placeholder, datalist) {
    const attrs = { id, value: value ?? "", placeholder: placeholder ?? "" };
    if (datalist) attrs.list = datalist;
    return h("input", attrs);
  }

  function numInput(id, value, step) {
    return h("input", { id, type: "number", value, step: step ?? "1" });
  }

  /* Item-Zeilen-Liste: [{item, num}] mit + / – Knöpfen */
  function itemList(opts) {
    const wrap = h("div", { class: "itemlist" });
    const rows = h("div");
    function addRow(item, value) {
      const row = h("div", { class: "row" },
        h("input", { class: "item-name", list: opts.datalist || "dl-items",
                     placeholder: opts.placeholder || "Item-Name…", value: item ?? "" }),
        h("input", { class: "num", type: "number", step: opts.step ?? "1",
                     min: "0", title: opts.numLabel, value: value ?? opts.numDefault }),
        h("span", { class: "hint" }, opts.numLabel),
        h("button", { class: "small", onclick: () => row.remove() }, "✕"));
      rows.append(row);
    }
    (opts.initial || [["", undefined]]).forEach(([i, v]) => addRow(i, v));
    wrap.append(rows, h("button", { class: "small", onclick: () => addRow() }, "+ Item"));
    wrap.values = () => Array.from(rows.children).map((row) => ({
      item: row.querySelector(".item-name").value.trim(),
      num: num(row.querySelector(".num").value, opts.numDefault),
    })).filter((r) => r.item);
    return wrap;
  }

  /* Event-Kinder haben fünf unabhängige Werte. Eine gemeinsame "Anzahl"
     würde min/max und die Loot-Grenzen beim Laden unbemerkt zusammenziehen. */
  function eventChildrenList(initial) {
    const wrap = h("div", { class: "itemlist" });
    const rows = h("div");
    function addRow(child) {
      const value = child || {};
      const input = (className, label, fallback) => h("label", { class: "hint" },
        label, h("input", { class: "num " + className, type: "number", step: "1",
                            min: "0", value: value[className] ?? fallback,
                            title: label }));
      const row = h("div", { class: "row" },
        h("input", { class: "item-name", list: "dl-items",
                     placeholder: "Spawn-Typ…", value: value.type || "" }),
        input("max", "max", 1), input("min", "min", 1),
        input("lootmax", "lootmax", 0), input("lootmin", "lootmin", 0),
        h("button", { class: "small", onclick: () => row.remove() }, "✕"));
      rows.append(row);
    }
    (initial && initial.length ? initial : [{}]).forEach(addRow);
    wrap.append(rows,
      h("button", { class: "small", onclick: () => addRow() }, "+ Kind"));
    wrap.values = () => Array.from(rows.children).map((row) => ({
      type: row.querySelector(".item-name").value.trim(),
      max: Math.round(num(row.querySelector(".max").value, 1)),
      min: Math.round(num(row.querySelector(".min").value, 1)),
      lootmax: Math.round(num(row.querySelector(".lootmax").value, 0)),
      lootmin: Math.round(num(row.querySelector(".lootmin").value, 0)),
    })).filter((child) => child.type);
    return wrap;
  }

  const percentValue = (chance) => Math.round(Number(chance) * 10000) / 100;

  /* Ein cfgspawnabletypes-Block kann mehrere Items enthalten und besitzt eine
     eigene Chance; jedes Item darin hat zusätzlich seine eigene Chance. */
  function spawnableBlockList(kind, initial) {
    const wrap = h("div", { class: "itemlist" });
    const blocks = h("div");
    const label = kind === "cargo" ? "cargo" : "attachments";
    function addBlock(value) {
      const blockValue = value || { kind, chance: 1, items: [] };
      const itemRows = h("div");
      function addItem(item) {
        const itemValue = item || {};
        const row = h("div", { class: "row" },
          h("input", { class: "item-name", list: "dl-items",
                       placeholder: "Item-Name…", value: itemValue.name || "" }),
          h("input", { class: "num item-chance", type: "number", step: "0.01",
                       min: "0", max: "100", title: "Item-Chance %",
                       value: percentValue(itemValue.chance ?? 1) }),
          h("span", { class: "hint" }, "Item-Chance %"),
          h("button", { class: "small", onclick: () => row.remove() }, "✕"));
        itemRows.append(row);
      }
      const box = h("div", { class: "grp" },
        h("div", { class: "row" },
          h("strong", {}, label + "-Block"),
          h("input", { class: "num block-chance", type: "number", step: "0.01",
                       min: "0", max: "100", title: "Block-Chance %",
                       value: percentValue(blockValue.chance ?? 1) }),
          h("span", { class: "hint" }, "Block-Chance %"),
          h("button", { class: "small", onclick: () => box.remove() },
            "Block entfernen")),
        itemRows,
        h("button", { class: "small", onclick: () => addItem() }, "+ Item im Block"));
      ((blockValue.items && blockValue.items.length) ? blockValue.items : [{}]).forEach(addItem);
      blocks.append(box);
    }
    (initial && initial.length ? initial : [{ kind, chance: 1, items: [] }]).forEach(addBlock);
    wrap.append(blocks,
      h("button", { class: "small", onclick: () => addBlock() }, "+ " + label + "-Block"));
    wrap.values = () => Array.from(blocks.children).map((box) => ({
      kind,
      chance: Math.max(0, Math.min(1,
        num(box.querySelector(".block-chance").value, 100) / 100)),
      items: Array.from(box.querySelectorAll(":scope > div:nth-child(2) > .row"))
        .map((row) => ({
          name: row.querySelector(".item-name").value.trim(),
          chance: Math.max(0, Math.min(1,
            num(row.querySelector(".item-chance").value, 100) / 100)),
        })).filter((item) => item.name),
    })).filter((block) => block.items.length);
    return wrap;
  }

  /* Zombie-Auswahl: Kategorie- + Typ-Dropdown, ausgewählte Zombies mit Anzahl */
  function zombiePicker() {
    const wrap = h("div");
    const cat = h("select", {});
    const char = h("select", {});
    Object.keys(ZOMBIE_DATA).forEach((c) => cat.append(h("option", { value: c }, c)));
    function fillChars() {
      char.innerHTML = "";
      (ZOMBIE_DATA[cat.value] || []).forEach((z) => char.append(h("option", { value: z }, z)));
    }
    cat.addEventListener("change", fillChars);
    fillChars();
    const rows = h("div");
    function addZombie(type, count) {
      if (!type) return;
      if (Array.from(rows.children).some((r) => r.dataset.type === type)) return;
      const row = h("div", { class: "row" },
        h("span", { style: "flex:1 1 180px" }, type),
        h("input", { class: "num", type: "number", min: "1",
                     value: count || 3, title: "Anzahl pro Zone" }),
        h("button", { class: "small", onclick: () => row.remove() }, "✕"));
      row.dataset.type = type;
      rows.append(row);
    }
    wrap.append(
      field("Zombie-Kategorie", cat),
      field("Zombie-Typ", char),
      h("button", { class: "small",
                    onclick: () => addZombie(char.value) }, "+ Zombie hinzufügen"),
      h("div", { class: "grp" }, h("h4", {}, "Ausgewählte Zombies (Anzahl je Zone)"), rows));
    wrap.values = () => Array.from(rows.children).map((r) => ({
      item: r.dataset.type, num: num(r.querySelector(".num").value, 3),
    }));
    wrap.add = addZombie;
    wrap.setValues = (list) => {
      rows.innerHTML = "";
      (list || []).forEach((z) => addZombie(z.item, z.num));
    };
    return wrap;
  }

  /* Positions-Liste: X/Z(/Ausrichtung) + Mini-Karten-Picker */
  function posList(opts) {
    const withAngle = !!(opts && opts.angle);
    const wrap = h("div", { class: "poslist" });
    const rows = h("div");
    function addRow(x, z, a) {
      const row = h("div", { class: "row" },
        "X:", h("input", { class: "px", type: "number", value: x ?? "" }),
        "Z:", h("input", { class: "pz", type: "number", value: z ?? "" }),
        withAngle ? "Drehung:" : null,
        withAngle ? h("input", { class: "pa", type: "number", value: a ?? 0 }) : null,
        h("button", { class: "small", onclick: () => row.remove() }, "✕"));
      rows.append(row);
    }
    if (opts && opts.startEmpty) { /* keine Startzeile */ } else addRow();
    wrap.append(rows,
      h("div", { class: "row" },
        h("button", { class: "small", onclick: () => addRow() }, "+ Position"),
        h("button", { class: "small", onclick: () => openMapPicker(wrap) },
          "🗺️ Auf Karte wählen")));
    wrap.values = () => Array.from(rows.children).map((row) => ({
      x: num(row.querySelector(".px").value, NaN),
      z: num(row.querySelector(".pz").value, NaN),
      a: withAngle ? num(row.querySelector(".pa").value, 0) : 0,
    })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
    wrap.setValues = (points) => {
      rows.innerHTML = "";
      points.forEach((p) => addRow(p.x, p.z, p.a || 0));
      if (!points.length) addRow();
    };
    return wrap;
  }

  /* --------------------------- Mini-Karten-Picker (Modal) */

  let pickMap = null, pickGroup = null, pickTarget = null, pickMapKey = null;

  function clampPickerPoint(point, size) {
    return {
      x: Math.max(0, Math.min(size, Math.round(Number(point.x) * 10) / 10)),
      z: Math.max(0, Math.min(size, Math.round(Number(point.z) * 10) / 10)),
    };
  }

  function openMapPicker(target) {
    pickTarget = target;
    $("#mappick-overlay").classList.remove("hidden");
    const shared = window.DayZMapShared;
    const key = shared.currentKey();
    const cfg = shared.MAPS[key];
    // Bei Kartenwechsel die gecachte Picker-Karte verwerfen und neu bauen
    if (pickMap && pickMapKey !== key) {
      pickMap.remove();
      pickMap = null;
    }
    if (!pickMap) {
      pickMapKey = key;
      const WORLD = cfg.size;
      pickMap = L.map("mappick-map", {
        crs: shared.makeCrs(WORLD), minZoom: 1, maxZoom: 8,
        maxBounds: [[-2000, -2000], [WORLD + 2000, WORLD + 2000]],
        attributionControl: false,
      });
      L.tileLayer(shared.tileUrl(cfg.slug, "topographic"), {
        noWrap: true, minNativeZoom: 0, maxNativeZoom: 8,
        bounds: [[0, 0], [WORLD, WORLD]],
      }).addTo(pickMap);
      new shared.GridBackdrop({ noWrap: true, opacity: 0.35, world: WORLD }).addTo(pickMap);
      pickGroup = L.layerGroup().addTo(pickMap);
      pickMap.on("click", (ev) => {
        const x = Math.round(ev.latlng.lng * 10) / 10;
        const z = Math.round(ev.latlng.lat * 10) / 10;
        const size = shared.MAPS[pickMapKey].size;
        if (x < 0 || z < 0 || x > size || z > size) return;
        addPickMarker({ x, z, a: 0 });
      });
    }
    // Umschalt-Buttons im Modal markieren
    $$("#map-switch-pick button").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mapkey === key));
    pickGroup.clearLayers();
    (target.values() || []).forEach(addPickMarker);
    // Die Karte wird im gerade sichtbar gewordenen Modal mehrfach neu
    // vermessen, damit Klick-Koordinaten von Anfang an stimmen.
    [30, 150, 400].forEach((ms) => setTimeout(() => {
      pickMap.invalidateSize();
      pickMap.setView([cfg.size / 2, cfg.size / 2], 2);
    }, ms));
  }

  function addPickMarker(point) {
    const marker = L.marker([point.z, point.x], {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: '<span style="display:block;width:16px;height:16px;border-radius:50%;' +
              'background:#e0a24d;border:2px solid #000c;box-shadow:0 0 4px #000"></span>',
        iconSize: [16, 16], iconAnchor: [8, 8],
      }),
    });
    marker._point = point;
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      const size = window.DayZMapShared.MAPS[pickMapKey].size;
      const clamped = clampPickerPoint({ x: pos.lng, z: pos.lat }, size);
      point.x = clamped.x;
      point.z = clamped.z;
      marker.setLatLng([point.z, point.x]);
    });
    marker.on("click", () => pickGroup.removeLayer(marker));
    pickGroup.addLayer(marker);
  }

  function bindPickerButtons() {
    $$("#map-switch-pick button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const shared = window.DayZMapShared;
        if (btn.dataset.mapkey === shared.currentKey()) return;
        if (!confirm("Für eine andere Karte muss auch der Missionsordner " +
                     "gewechselt werden. Das aktuelle Tool-Formular wird " +
                     "geschlossen. Trotzdem wechseln?")) return;
        const changed = await shared.setMap(btn.dataset.mapkey);
        if (!changed) return;
        pickTarget = null;
        if (pickGroup) pickGroup.clearLayers();
        $("#mappick-overlay").classList.add("hidden");
        toast("Karte und Missionsordner gewechselt. Bitte das gewünschte Tool erneut öffnen.");
      });
    });
    $("#btn-mappick-ok").addEventListener("click", () => {
      const points = pickGroup.getLayers().map((m) => m._point);
      if (pickTarget) pickTarget.setValues(points);
      $("#mappick-overlay").classList.add("hidden");
    });
    $("#btn-mappick-cancel").addEventListener("click", () =>
      $("#mappick-overlay").classList.add("hidden"));
  }

  /* ====================================================== Zeilen-Diff */

  function lineDiff(oldText, newText) {
    const a = (oldText || "").split("\n");
    const b = (newText || "").split("\n");
    if (a.length * b.length > 4_000_000) {
      // Zu groß für LCS: nur hinzugefügte/entfernte Zeilen zählen
      const counts = new Map();
      a.forEach((l) => counts.set(l, (counts.get(l) || 0) - 1));
      b.forEach((l) => counts.set(l, (counts.get(l) || 0) + 1));
      const out = [];
      for (const [line, c] of counts) {
        if (c > 0) for (let i = 0; i < c; i++) out.push(["add", line]);
        if (c < 0) for (let i = 0; i < -c; i++) out.push(["del", line]);
      }
      return out;
    }
    // Klassisches LCS
    const m = a.length, n = b.length;
    const lcs = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1
                                  : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { out.push(["ctx", a[i]]); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push(["del", a[i]]); i++; }
      else { out.push(["add", b[j]]); j++; }
    }
    while (i < m) out.push(["del", a[i++]]);
    while (j < n) out.push(["add", b[j++]]);
    return out;
  }

  function renderDiff(ops) {
    const box = h("div", { class: "diff" });
    let ctxRun = [];
    const flushCtx = (isEdge) => {
      if (ctxRun.length <= 4) {
        ctxRun.forEach((l) => box.append(h("div", { class: "ctx" }, l)));
      } else {
        box.append(h("div", { class: "ctx" }, ctxRun[0]),
                   h("div", { class: "ctx" }, ctxRun[1]),
                   h("div", { class: "skip" },
                     "… " + (ctxRun.length - 4) + " unveränderte Zeilen …"),
                   h("div", { class: "ctx" }, ctxRun[ctxRun.length - 2]),
                   h("div", { class: "ctx" }, ctxRun[ctxRun.length - 1]));
      }
      ctxRun = [];
    };
    for (const [kind, line] of ops) {
      if (kind === "ctx") { ctxRun.push(line); continue; }
      flushCtx();
      box.append(h("div", { class: kind }, (kind === "add" ? "+ " : "− ") + line));
    }
    flushCtx(true);
    return box;
  }

  /* ============================================== Vorschau & Staging */

  const staged = [];   // {path, summary, transform, tool}
  let pendingPlans = null;

  async function showPreview(tool) {
    let plans;
    try {
      plans = await tool.generate();
    } catch (err) {
      return toast(err.message, "error");
    }
    if (!plans || !plans.length) return;
    const box = $("#preview-files");
    box.innerHTML = "";
    try {
      for (const plan of plans) {
        const current = await readOrNull(plan.path);
        const next = plan.transform(current);
        validateGeneratedFile(plan.path, next);
        const fileBox = h("div", { class: "preview-file" },
          h("div", { class: "pf-head" },
            h("span", { class: "badge " + (current === null ? "new" : "mod") },
              current === null ? "NEU" : "GEÄNDERT"),
            h("span", { class: "mono" }, plan.path.split("/").slice(-2).join("/"))),
          h("ul", { class: "pf-summary" }, plan.summary.map((s) => h("li", {}, s))));
        const details = h("details", { class: "pf-diff-toggle" },
          h("summary", {}, "Änderungen im Detail (Diff) anzeigen"));
        details.addEventListener("toggle", () => {
          if (details.open && !details.querySelector(".diff"))
            details.append(renderDiff(lineDiff(current, next)));
        }, { once: false });
        fileBox.append(details);
        box.append(fileBox);
      }
    } catch (err) {
      return toast("Vorschau fehlgeschlagen: " + err.message, "error");
    }
    pendingPlans = plans.map((p) => ({ ...p, tool: tool.title }));
    $("#preview-overlay").classList.remove("hidden");
  }

  function updateStagingBar() {
    const bar = $("#staging-bar");
    bar.classList.toggle("hidden", staged.length === 0);
    const files = [...new Set(staged.map((s) => s.path.split("/").pop()))];
    $("#staging-info").textContent =
      "● " + staged.length + " Änderung(en) vorgemerkt: " + files.join(", ");
  }

  async function saveStaged() {
    if (!staged.length) return;
    const files = [...new Set(staged.map((s) => s.path))];
    if (!confirm("Jetzt " + files.length + " Datei(en) auf den Server hochladen?\n\n" +
                 files.map((f) => "• " + f.split("/").slice(-2).join("/")).join("\n") +
                 "\n\n(Vorher wird automatisch ein Backup angelegt.)")) return;
    const btn = $("#btn-staging-save");
    btn.disabled = true;
    try {
      const contents = new Map();
      for (const entry of staged) {
        if (!contents.has(entry.path)) contents.set(entry.path, await readOrNull(entry.path));
        contents.set(entry.path, entry.transform(contents.get(entry.path)));
      }
      for (const [path, content] of contents) validateGeneratedFile(path, content);
      for (const [path, content] of contents) {
        await api("/api/file", { path, content });
      }
      staged.length = 0;
      updateStagingBar();
      toast("Gespeichert: " + files.map((f) => f.split("/").pop()).join(", ") +
            " (Backups angelegt)");
      setTimeout(() => {
        if (confirm("Änderungen sind hochgeladen. Server jetzt neu starten, " +
                    "damit sie in Kraft treten?")) {
          api("/api/server/restart", {})
            .then(() => toast("Neustart ausgelöst – in ein paar Minuten ist alles live."))
            .catch((err) => toast(err.message, "error"));
        }
      }, 300);
    } catch (err) {
      toast("Speichern fehlgeschlagen: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  /* ========================================================= Die Tools */

  const registry = [];
  let currentTool = null;

  /* ------------------------------------------------ 1. Loadout Generator */

  const SLOTS = [
    ["Shoulder", "Schulterwaffe"], ["Melee", "Nahkampfwaffe"],
    ["Hands", "In den Händen"], ["Headgear", "Kopfbedeckung"],
    ["Mask", "Maske"], ["Eyewear", "Brille"], ["Gloves", "Handschuhe"],
    ["Armband", "Armbinde"], ["Body", "Oberteil"], ["Vest", "Weste"],
    ["Back", "Rucksack"], ["Hips", "Gürtel"], ["Legs", "Hose"],
    ["Feet", "Schuhe"],
  ];

  const LOADOUT_HEALTH_VALUES = ["0.7,1.0", "0.3,0.7", "0.1,1.0"];
  const jsonClone = (value) => JSON.parse(JSON.stringify(value));
  const asArray = (value) => Array.isArray(value) ? value : [];

  function firstLoadoutSlotSet(preset, slotName) {
    return asArray(preset && preset.attachmentSlotItemSets)
      .find((set) => set && typeof set === "object" && set.slotName === slotName) || null;
  }

  function firstLoadoutItemSet(slotSet) {
    const first = asArray(slotSet && slotSet.discreteItemSets)[0];
    return first && typeof first === "object" && !Array.isArray(first) ? first : null;
  }

  function loadoutHealthValue(preset) {
    let attributes = null;
    for (const [slotName] of SLOTS) {
      const itemSet = firstLoadoutItemSet(firstLoadoutSlotSet(preset, slotName));
      if (itemSet && itemSet.attributes && typeof itemSet.attributes === "object") {
        attributes = itemSet.attributes;
        break;
      }
    }
    if (!attributes) {
      const unsorted = asArray(preset && preset.discreteUnsortedItemSets)
        .find((set) => set && set.attributes && typeof set.attributes === "object");
      attributes = unsorted && unsorted.attributes;
    }
    if (!attributes) return LOADOUT_HEALTH_VALUES[0];
    const hMin = Number(attributes.healthMin);
    const hMax = Number(attributes.healthMax);
    return LOADOUT_HEALTH_VALUES.find((value) => {
      const [minValue, maxValue] = value.split(",").map(Number);
      return minValue === hMin && maxValue === hMax;
    }) || LOADOUT_HEALTH_VALUES[0];
  }

  function loadoutCargoCounts(rows) {
    const counts = new Map();
    for (const row of rows || []) {
      const item = String(row.item || "").trim();
      if (!item) continue;
      const amount = Math.max(1, Math.round(num(row.num, 1)));
      counts.set(item, (counts.get(item) || 0) + amount);
    }
    return counts;
  }

  function loadoutCargoKey(rows) {
    return JSON.stringify(Array.from(loadoutCargoCounts(rows)).sort(([a], [b]) =>
      a.localeCompare(b)));
  }

  function loadoutVisibleState(preset, fallbackName) {
    const slots = {};
    for (const [slotName] of SLOTS) {
      const itemSet = firstLoadoutItemSet(firstLoadoutSlotSet(preset, slotName));
      slots[slotName] = itemSet && typeof itemSet.itemType === "string"
        ? itemSet.itemType : "";
    }
    const counts = new Map();
    for (const set of asArray(preset && preset.discreteUnsortedItemSets)) {
      for (const item of asArray(set && set.simpleChildrenTypes)) {
        if (typeof item === "string" && item)
          counts.set(item, (counts.get(item) || 0) + 1);
      }
    }
    return {
      name: (preset && typeof preset.name === "string" && preset.name) || fallbackName,
      slots,
      cargo: Array.from(counts, ([item, amount]) => ({ item, num: amount })),
      health: loadoutHealthValue(preset),
    };
  }

  function loadoutHealthNumbers(value) {
    const selected = LOADOUT_HEALTH_VALUES.includes(value)
      ? value : LOADOUT_HEALTH_VALUES[0];
    return selected.split(",").map(Number);
  }

  function defaultLoadoutAttributes(health) {
    const [healthMin, healthMax] = loadoutHealthNumbers(health);
    return { healthMin, healthMax, quantityMin: -1, quantityMax: -1 };
  }

  function defaultLoadoutItemSet(itemType, health) {
    return {
      itemType, spawnWeight: 1, attributes: defaultLoadoutAttributes(health),
      quickBarSlot: -1, simpleChildrenTypes: [], complexChildrenSets: [],
    };
  }

  function setLoadoutSlot(preset, slotName, itemType, health) {
    if (!Array.isArray(preset.attachmentSlotItemSets))
      preset.attachmentSlotItemSets = [];
    const slots = preset.attachmentSlotItemSets;
    const index = slots.findIndex((set) =>
      set && typeof set === "object" && set.slotName === slotName);
    if (!itemType) {
      if (index < 0) return;
      const slotSet = slots[index];
      const alternatives = asArray(slotSet.discreteItemSets);
      if (alternatives.length > 1) slotSet.discreteItemSets = alternatives.slice(1);
      else slots.splice(index, 1);
      return;
    }
    if (index < 0) {
      slots.push({ slotName, discreteItemSets: [defaultLoadoutItemSet(itemType, health)] });
      return;
    }
    const slotSet = slots[index];
    if (!Array.isArray(slotSet.discreteItemSets)) slotSet.discreteItemSets = [];
    const first = slotSet.discreteItemSets[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      first.itemType = itemType;
      if (!first.attributes || typeof first.attributes !== "object")
        first.attributes = defaultLoadoutAttributes(health);
    } else {
      slotSet.discreteItemSets.unshift(defaultLoadoutItemSet(itemType, health));
    }
  }

  function setLoadoutHealth(preset, health) {
    const [healthMin, healthMax] = loadoutHealthNumbers(health);
    for (const [slotName] of SLOTS) {
      const itemSet = firstLoadoutItemSet(firstLoadoutSlotSet(preset, slotName));
      if (!itemSet) continue;
      if (!itemSet.attributes || typeof itemSet.attributes !== "object")
        itemSet.attributes = defaultLoadoutAttributes(health);
      else {
        itemSet.attributes.healthMin = healthMin;
        itemSet.attributes.healthMax = healthMax;
      }
    }
  }

  function applyLoadoutCargoDelta(preset, baselineRows, desiredRows, health) {
    const before = loadoutCargoCounts(baselineRows);
    const after = loadoutCargoCounts(desiredRows);
    const removals = new Map();
    for (const [item, count] of before) {
      const remove = count - (after.get(item) || 0);
      if (remove > 0) removals.set(item, remove);
    }
    if (!Array.isArray(preset.discreteUnsortedItemSets))
      preset.discreteUnsortedItemSets = [];
    const sets = preset.discreteUnsortedItemSets;
    for (let setIndex = sets.length - 1; setIndex >= 0; setIndex -= 1) {
      const simple = sets[setIndex] && sets[setIndex].simpleChildrenTypes;
      if (!Array.isArray(simple)) continue;
      for (let itemIndex = simple.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = simple[itemIndex];
        const remaining = removals.get(item) || 0;
        if (remaining > 0) {
          simple.splice(itemIndex, 1);
          removals.set(item, remaining - 1);
        }
      }
    }
    const additions = [];
    for (const row of desiredRows || []) {
      const item = String(row.item || "").trim();
      if (!item) continue;
      const wanted = after.get(item) || 0;
      const add = wanted - (before.get(item) || 0);
      if (add > 0 && !additions.some(([name]) => name === item))
        additions.push([item, add]);
    }
    if (!additions.length) return;
    let target = sets.find((set) => set && typeof set === "object" &&
      Array.isArray(set.simpleChildrenTypes));
    if (!target) target = sets.find((set) => set && typeof set === "object");
    if (!target) {
      target = {
        name: "Startitems", spawnWeight: 1,
        attributes: defaultLoadoutAttributes(health),
        simpleChildrenTypes: [], complexChildrenSets: [],
      };
      sets.push(target);
    }
    if (!Array.isArray(target.simpleChildrenTypes)) target.simpleChildrenTypes = [];
    for (const [item, count] of additions)
      for (let i = 0; i < count; i += 1) target.simpleChildrenTypes.push(item);
  }

  function loadoutChanges(baseline, desired) {
    const slots = SLOTS.map(([slotName]) => slotName)
      .filter((slotName) => desired.slots[slotName] !== baseline.slots[slotName]);
    return {
      name: desired.name !== baseline.name,
      health: desired.health !== baseline.health,
      cargo: loadoutCargoKey(desired.cargo) !== loadoutCargoKey(baseline.cargo),
      slots,
    };
  }

  function updateLoadoutPreset(text, baseline, desired, fallbackPreset) {
    const changes = loadoutChanges(baseline, desired);
    const unchanged = !changes.name && !changes.health && !changes.cargo &&
                      !changes.slots.length;
    if (unchanged && text !== null) return text;
    const preset = text !== null ? JSON.parse(text) : jsonClone(fallbackPreset);
    if (!preset || typeof preset !== "object" || Array.isArray(preset))
      throw new Error("Die Loadout-Datei enthält kein gültiges Preset.");
    if (changes.name) preset.name = desired.name;
    for (const slotName of changes.slots)
      setLoadoutSlot(preset, slotName, desired.slots[slotName], desired.health);
    if (changes.health) setLoadoutHealth(preset, desired.health);
    if (changes.cargo)
      applyLoadoutCargoDelta(preset, baseline.cargo, desired.cargo, desired.health);
    return JSON.stringify(preset, null, 4) + "\n";
  }

  function buildNewLoadoutPreset(desired) {
    const slotSets = [];
    for (const [slotName] of SLOTS) {
      const item = String(desired.slots[slotName] || "").trim();
      if (item) slotSets.push({
        slotName, discreteItemSets: [defaultLoadoutItemSet(item, desired.health)],
      });
    }
    const loose = [];
    for (const [item, count] of loadoutCargoCounts(desired.cargo))
      for (let i = 0; i < count; i += 1) loose.push(item);
    return {
      version: 1, name: desired.name, spawnWeight: 1, characterTypes: [],
      attachmentSlotItemSets: slotSets,
      discreteUnsortedItemSets: loose.length ? [{
        name: "Startitems", spawnWeight: 1,
        attributes: defaultLoadoutAttributes(desired.health),
        simpleChildrenTypes: loose, complexChildrenSets: [],
      }] : [],
    };
  }

  registry.push({
    id: "loadout", icon: "🧍", title: "Loadout Generator",
    desc: "Start-Ausrüstung für frisch gespawnte Spieler festlegen – neu anlegen oder vorhandene Presets bearbeiten. (Funktioniert ab DayZ 1.20 auch auf Konsole.)",
    async render(form) {
      this._file = null;
      this._loadedPreset = null;
      this._loadedVisible = null;
      const gameplay = await readJsonOrNull(await missionPath("cfggameplay.json"));
      const files = (gameplay && gameplay.PlayerData &&
                     gameplay.PlayerData.spawnGearPresetFiles) || [];
      form.append(loadPicker("– Neues Preset erstellen –", files, async (file) => {
        this._file = file || null;
        this._loadedPreset = null;
        this._loadedVisible = null;
        if (!file) return;
        const preset = await readJsonOrNull(await missionPath(file));
        if (!preset) {
          this._file = null;
          return toast("Preset „" + file + "“ konnte nicht geladen werden.", "error");
        }
        const visible = loadoutVisibleState(preset, file.replace(/\.json$/i, ""));
        this._loadedPreset = jsonClone(preset);
        this._loadedVisible = jsonClone(visible);
        $("#lo-name").value = visible.name;
        for (const [slot] of SLOTS)
          $("#lo-slot-" + slot).value = visible.slots[slot];
        const fresh = itemList({ numLabel: "Anzahl", numDefault: 1,
          initial: visible.cargo.length
            ? visible.cargo.map((row) => [row.item, row.num]) : [["", undefined]] });
        this.invList.replaceWith(fresh);
        this.invList = fresh;
        $("#lo-health").value = visible.health;
        toast("Preset geladen – anpassen und Vorschau öffnen.");
      }));
      form.append(field("Name des Presets",
        textInput("lo-name", "MeinLoadout")));
      const grp = h("div", { class: "grp" },
        h("h4", {}, "Ausrüstungs-Slots (leer = Standard-Zufall)"));
      for (const [slot, label] of SLOTS) {
        grp.append(h("div", { class: "row" },
          h("span", { style: "width:130px" }, label),
          textInput("lo-slot-" + slot, "", "z.B. TShirt_Red", "dl-items")));
      }
      form.append(grp);
      const inv = h("div", { class: "grp" }, h("h4", {}, "Items im Inventar"));
      this.invList = itemList({ numLabel: "Anzahl", numDefault: 1,
        initial: [["BandageDressing", 2], ["", undefined]] });
      inv.append(this.invList);
      form.append(inv);
      form.append(field("Zustand der Slot-Items",
        h("select", { id: "lo-health" },
          h("option", { value: "0.7,1.0" }, "Neuwertig"),
          h("option", { value: "0.3,0.7" }, "Gebraucht"),
          h("option", { value: "0.1,1.0" }, "Zufällig"))));
    },
    async generate() {
      const name = $("#lo-name").value.trim() || "MeinLoadout";
      const slots = {};
      for (const [slotName] of SLOTS)
        slots[slotName] = $("#lo-slot-" + slotName).value.trim();
      const desired = {
        name, slots, cargo: this.invList.values(), health: $("#lo-health").value,
      };
      // Beim Bearbeiten dieselbe Datei behalten, sonst Namen aus dem Preset ableiten
      const fileName = this._file ||
        "custom_" + ((name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_")
          .replace(/^_+|_+$/g, "")) || "loadout") + ".json";
      const selectedSlots = Object.values(slots).filter(Boolean).length;
      const looseCount = Array.from(loadoutCargoCounts(desired.cargo).values())
        .reduce((sum, count) => sum + count, 0);
      if (!this._file && !selectedSlots && !looseCount)
        throw new Error("Bitte mindestens ein Kleidungsstück oder Item angeben.");
      const baseline = this._loadedVisible && jsonClone(this._loadedVisible);
      const fallbackPreset = this._loadedPreset && jsonClone(this._loadedPreset);
      const newPreset = baseline ? null : buildNewLoadoutPreset(desired);
      return [
        {
          path: await missionPath(fileName),
          summary: ["Preset „" + name + "“ mit " + selectedSlots +
                    " sichtbaren Slot(s) und " + looseCount + " Inventar-Item(s)."],
          transform: (current) => baseline
            ? updateLoadoutPreset(current, baseline, desired, fallbackPreset)
            : JSON.stringify(newPreset, null, 4) + "\n",
        },
        {
          path: await missionPath("cfggameplay.json"),
          summary: ["Trägt „" + fileName + "“ bei PlayerData → spawnGearPresetFiles ein" +
                    " (falls noch nicht vorhanden)."],
          transform: (current) => {
            if (current === null) throw new Error("cfggameplay.json wurde auf dem Server nicht gefunden.");
            const data = JSON.parse(current);
            if (!data.PlayerData) data.PlayerData = {};
            if (!Array.isArray(data.PlayerData.spawnGearPresetFiles))
              data.PlayerData.spawnGearPresetFiles = [];
            if (data.PlayerData.spawnGearPresetFiles.includes(fileName)) return current;
            data.PlayerData.spawnGearPresetFiles.push(fileName);
            return JSON.stringify(data, null, 4) + "\n";
          },
        },
      ];
    },
  });

  /* ------------------------------------------------ 2. Gas-Zonen Builder */

  registry.push({
    id: "gaszone", icon: "☣️", title: "Gas-Zonen Builder",
    desc: "Statische Kontaminationszonen (wie Rify/Pavlovo) neu anlegen oder vorhandene bearbeiten – mit Partikel-Effekt und sicheren Teleport-Punkten für Spieler, die in der Zone einloggen.",
    async render(form) {
      const eff = await readJsonOrNull(await missionPath("cfgEffectArea.json"));
      const areas = (eff && Array.isArray(eff.Areas)) ? eff.Areas : [];
      form.append(loadPicker("– Neue Gaszone erstellen –",
        areas.map((a) => a.AreaName).filter(Boolean), (name) => {
        const area = areas.find((a) => a.AreaName === name);
        if (!area) return;
        const d = area.Data || {};
        $("#gz-name").value = area.AreaName;
        $("#gz-radius").value = d.Radius ?? 150;
        $("#gz-posheight").value = d.PosHeight ?? 20;
        $("#gz-negheight").value = d.NegHeight ?? 3;
        $("#gz-innerpart").value = d.InnerPartDist ?? 100;
        $("#gz-outeroffset").value = d.OuterOffset ?? 20;
        if (Array.from($("#gz-particle").options).some((o) => o.value === d.ParticleName))
          $("#gz-particle").value = d.ParticleName;
        const p = d.Pos || [0, 0, 0];
        this.pos.setValues([{ x: p[0], z: p[2] }]);
        this.safe.setValues((Array.isArray(eff.SafePositions) ? eff.SafePositions : [])
          .map(([x, z]) => ({ x, z })));
        toast("Gaszone „" + name + "“ geladen – anpassen und Vorschau öffnen.");
      }));
      form.append(field("Name der Zone", textInput("gz-name", "MeineGasZone")));
      form.append(h("div", { class: "grp" },
        h("h4", {}, "Zonen-Eigenschaften"),
        h("div", { class: "row" },
          "Radius (m):", numInput("gz-radius", 150),
          "Höhe oben:", numInput("gz-posheight", 20),
          "Höhe unten:", numInput("gz-negheight", 3)),
        h("div", { class: "row" },
          "Partikel-Abstand:", numInput("gz-innerpart", 100),
          "Außenversatz:", numInput("gz-outeroffset", 20)),
        field("Gas-Partikel",
          h("select", { id: "gz-particle" },
            ...GAS_PARTICLES.map(([v, l]) => h("option", { value: v }, l))))));
      this.pos = posList({});
      form.append(h("div", { class: "grp" },
        h("h4", {}, "Position(en) der Gaszone(n)"),
        h("p", { class: "hint" }, "Jede Position wird eine eigene Zone."),
        this.pos));
      this.safe = posList({ startEmpty: true });
      this.safe.setValues((Array.isArray(eff && eff.SafePositions) ? eff.SafePositions : [])
        .map(([x, z]) => ({ x, z })));
      form.append(h("div", { class: "grp" },
        h("h4", {}, "Sichere Teleport-Punkte (SafePositions)"),
        h("p", { class: "hint" }, "Globale Liste für alle Gaszonen. Vorhandene " +
          "Punkte sind bereits eingetragen. Dorthin werden Spieler versetzt, " +
          "die mitten in einer Gaszone einloggen."),
        this.safe));
    },
    async generate() {
      const name = $("#gz-name").value.trim() || "MeineGasZone";
      const radius = num($("#gz-radius").value, 150);
      const posHeight = num($("#gz-posheight").value, 20);
      const negHeight = num($("#gz-negheight").value, 3);
      const innerPartDist = num($("#gz-innerpart").value, 100);
      const outerOffset = num($("#gz-outeroffset").value, 20);
      const particle = $("#gz-particle").value;
      const positions = this.pos.values();
      if (!positions.length) throw new Error("Bitte mindestens eine Zonen-Position angeben.");
      const safe = this.safe.values();
      const areas = positions.map((p, idx) => ({
        AreaName: positions.length > 1 ? name + "_" + (idx + 1) : name,
        Type: "ContaminatedArea_Static",
        TriggerType: "ContaminatedTrigger",
        Data: {
          Pos: [p.x, 0, p.z], Radius: radius,
          PosHeight: posHeight, NegHeight: negHeight,
          InnerPartDist: innerPartDist, OuterOffset: outerOffset,
          ParticleName: particle,
        },
        PlayerData: {
          AroundPartName: "graphics/particles/contaminated_area_gas_around",
          TinyPartName: "graphics/particles/contaminated_area_gas_around_tiny",
          PPERequesterType: "PPERequester_ContaminatedAreaTint",
        },
      }));
      const summary = areas.map((a) =>
        "Gaszone „" + a.AreaName + "“ bei X " + a.Data.Pos[0] + " / Z " +
        a.Data.Pos[2] + ", Radius " + radius + " m.");
      if (safe.length) summary.push(safe.length + " sichere Teleport-Punkt(e).");
      return [{
        path: await missionPath("cfgEffectArea.json"),
        summary,
        transform: (current) => {
          const data = current ? JSON.parse(current)
                               : { Areas: [], SafePositions: [] };
          if (!Array.isArray(data.Areas)) data.Areas = [];
          const newNames = new Set(areas.map((a) => a.AreaName));
          data.Areas = data.Areas.filter((a) => !newNames.has(a.AreaName));
          data.Areas.push(...areas);
          data.SafePositions = safe.map((s) => [s.x, s.z]);
          return JSON.stringify(data, null, 4) + "\n";
        },
      }];
    },
  });

  /* -------------------------------------------- 3. Zombie-Horden Generator */

  registry.push({
    id: "horde", icon: "🧟", title: "Zombie-Horden Generator",
    desc: "Feste Zombie-Horden an Wunschpositionen – neu anlegen oder vorhandene bearbeiten. Zombie-Typen bequem per Liste auswählen, Bewegungsverhalten und Zonen-Radius einstellbar.",
    async render(form) {
      this._evDoc = await readXmlOrNull(mission("db/events.xml"));
      this._spDoc = await readXmlOrNull(await missionPath("cfgeventspawns.xml"));
      const hordes = [];
      if (this._evDoc) this._evDoc.querySelectorAll("events > event").forEach((ev) => {
        const kids = Array.from(ev.querySelectorAll(":scope > children > child"));
        if (kids.length && kids.every((c) => (c.getAttribute("type") || "").startsWith("Zmb")))
          hordes.push(ev.getAttribute("name"));
      });
      form.append(loadPicker("– Neue Horde erstellen –", hordes,
        (name) => this.fillFrom(name)));
      form.append(field("Name der Horde", textInput("hd-name", "InfectedHorde")));
      this.zombies = zombiePicker();
      this.zombies.add("ZmbM_SoldierNormal", 5);
      form.append(this.zombies);
      form.append(field("Bewegungsverhalten",
        h("select", { id: "hd-move" },
          ...Object.entries(HORDE_MOVEMENT).map(([v, m]) =>
            h("option", { value: v }, m.label)))));
      this.pos = posList({});
      form.append(h("div", { class: "grp" },
        h("h4", {}, "Position(en) der Horde"),
        h("div", { class: "row" }, "Zonen-Radius (m):", numInput("hd-radius", 25)),
        this.pos));
      form.append(h("details", {},
        h("summary", {}, "Experten-Einstellungen"),
        field("Lifetime (Sek.)", numInput("hd-lifetime", 300)),
        field("Loot pro Zombie (min/max)",
          h("span", { class: "row" }, numInput("hd-lootmin", 0), numInput("hd-lootmax", 0))),
        field("Cleanupradius", numInput("hd-cleanup", 400))));
    },
    fillFrom(name) {
      if (!name || !this._evDoc) return;
      const ev = this._evDoc.querySelector(`event[name="${name}"]`);
      if (!ev) return;
      const get = (f, dflt) => {
        const el = ev.querySelector(":scope > " + f);
        return el ? el.textContent.trim() : dflt;
      };
      $("#hd-name").value = name;
      $("#hd-lifetime").value = get("lifetime", 300);
      $("#hd-cleanup").value = get("cleanupradius", 400);
      const kids = Array.from(ev.querySelectorAll(":scope > children > child"));
      this.zombies.setValues(kids.map((c) => ({
        item: c.getAttribute("type"),
        num: Number(c.getAttribute("max")) || 1,
      })));
      if (kids[0]) {
        $("#hd-lootmin").value = kids[0].getAttribute("lootmin") || 0;
        $("#hd-lootmax").value = kids[0].getAttribute("lootmax") || 0;
      }
      if (this._spDoc) {
        const zones = Array.from(this._spDoc.querySelectorAll(`event[name="${name}"] > zone`));
        if (zones.length) {
          const z0 = zones[0];
          $("#hd-radius").value = Number(z0.getAttribute("r")) || 25;
          const smin = Number(z0.getAttribute("smin")) || 0;
          const smax = Number(z0.getAttribute("smax")) || 0;
          const style = Object.entries(HORDE_MOVEMENT).find(
            ([, m]) => m.smin === smin && m.smax === smax);
          $("#hd-move").value = style ? style[0] : "stationary";
        }
        this.pos.setValues(zones.map((z) => ({
          x: Number(z.getAttribute("x")) || 0,
          z: Number(z.getAttribute("z")) || 0,
        })));
      }
      toast("Horde „" + name + "“ geladen – anpassen und Vorschau öffnen.");
    },
    async generate() {
      const name = $("#hd-name").value.trim() || "InfectedHorde";
      const zombies = this.zombies.values();
      const positions = this.pos.values();
      if (!zombies.length) throw new Error("Bitte mindestens einen Zombie-Typ hinzufügen.");
      if (!positions.length) throw new Error("Bitte mindestens eine Position angeben.");
      const move = HORDE_MOVEMENT[$("#hd-move").value] || HORDE_MOVEMENT.stationary;
      const radius = num($("#hd-radius").value, 25);
      const lootmin = num($("#hd-lootmin").value, 0);
      const lootmax = num($("#hd-lootmax").value, 0);
      const count = positions.length;
      const total = zombies.reduce((s, z) => s + z.num, 0);
      const def = {
        name, nominal: count, min: count, max: count,
        lifetime: num($("#hd-lifetime").value, 300), restock: 0,
        saferadius: 10, distanceradius: 300,
        cleanupradius: num($("#hd-cleanup").value, 400),
        flags: { deletable: 0, init_random: 0, remove_damaged: 1 },
        position: "fixed", limit: "custom", active: 1,
        children: zombies.map((z) => ({ type: z.item, min: Math.round(z.num),
                                        max: Math.round(z.num),
                                        lootmin, lootmax })),
      };
      const zones = positions.map((p) => ({ x: p.x, y: 0, z: p.z, r: radius,
        smin: move.smin, smax: move.smax, dmin: move.dmin, dmax: move.dmax }));
      return [
        {
          path: mission("db/events.xml"),
          summary: ["Event „" + name + "“ mit " + total + " Zombies pro Zone (" +
                    zombies.map((z) => z.num + "× " + z.item).join(", ") +
                    "), Verhalten: " + move.label + "."],
          transform: (current) => {
            if (current === null) throw new Error("db/events.xml wurde auf dem Server nicht gefunden.");
            return upsertEvent(current, def);
          },
        },
        {
          path: await missionPath("cfgeventspawns.xml"),
          summary: [count + " Horden-Zone(n), Radius " + radius + " m: " +
                    positions.map((p) => "X " + p.x + "/Z " + p.z).join(", ") + "."],
          transform: (current) => {
            if (current === null) throw new Error("cfgeventspawns.xml wurde auf dem Server nicht gefunden.");
            return writeEventZones(current, name, zones);
          },
        },
      ];
    },
  });

  /* --------------------------------------- 4. Heli-Crash / Supply-Drop Loot */

  registry.push({
    id: "heliloot", icon: "🚁", title: "Heli-Crash Loot",
    desc: "Eigenen Loot an Helikopter-Absturzstellen festlegen, Anzahl der Crashes erhöhen und zusätzliche Absturzorte setzen.",
    async render(form) {
      const grp = h("div", { class: "grp" },
        h("h4", {}, "Loot an der Absturzstelle (Wreck_UH1Y)"));
      this._loadedSpawnable = null;
      this.lootAtt = spawnableBlockList("attachments", []);
      this.lootCargo = spawnableBlockList("cargo", [
        { kind: "cargo", chance: 0.25, items: [{ name: "M4A1", chance: 1 }] },
        { kind: "cargo", chance: 0.60,
          items: [{ name: "Mag_STANAG_30Rnd", chance: 1 }] },
      ]);
      grp.append(h("h4", {}, "Aufsatz-Blöcke"), this.lootAtt,
        h("h4", {}, "Cargo-Blöcke"), this.lootCargo,
        h("p", { class: "hint" }, "Block-Chance und Item-Chance werden getrennt " +
          "bearbeitet. Alle vorhandenen Blöcke und alle Items darin werden geladen."));
      form.append(grp);
      const counts = h("div", { class: "grp" }, h("h4", {}, "Anzahl gleichzeitiger Heli-Crashes"));
      counts.append(h("div", { class: "row" },
        "nominal:", numInput("hl-nominal", 5),
        "min:", numInput("hl-min", 3), "max:", numInput("hl-max", 7)));
      form.append(counts);
      this.pos = posList({ startEmpty: true });
      form.append(h("div", { class: "grp" },
        h("h4", {}, "Zusätzliche Absturzorte (optional)"),
        h("p", { class: "hint" }, "Werden zu den vorhandenen Vanilla-Positionen hinzugefügt."),
        this.pos));
      // Aktuelle Werte aus events.xml vorbelegen
      const evDoc = await readXmlOrNull(mission("db/events.xml"));
      const ev = evDoc && evDoc.querySelector('event[name="StaticHeliCrash"]');
      if (ev) {
        for (const f of ["nominal", "min", "max"]) {
          const el = ev.querySelector(":scope > " + f);
          if (el) $("#hl-" + f).value = el.textContent.trim();
        }
      }
      // Aktuellen Wreck-Loot aus cfgspawnabletypes.xml zum Bearbeiten laden
      const stDoc = await readXmlOrNull(await missionPath("cfgspawnabletypes.xml"));
      const node = stDoc && findElementByName(stDoc, "spawnabletypes > type", "Wreck_UH1Y");
      if (node) {
        this._loadedSpawnable = spawnableDefinitionFromElement(node);
        const att = spawnableBlockList("attachments",
          this._loadedSpawnable.blocks.filter((block) => block.kind === "attachments"));
        const cargo = spawnableBlockList("cargo",
          this._loadedSpawnable.blocks.filter((block) => block.kind === "cargo"));
        this.lootAtt.replaceWith(att);
        this.lootCargo.replaceWith(cargo);
        this.lootAtt = att;
        this.lootCargo = cargo;
      }
    },
    async generate() {
      const baseline = this._loadedSpawnable;
      const blocks = mergeSpawnableBlockKinds(
        this.lootAtt.values(), this.lootCargo.values(), baseline);
      const loot = blocks.flatMap((block) => block.items);
      if (!loot.length) throw new Error("Bitte mindestens ein Loot-Item angeben.");
      const nominal = num($("#hl-nominal").value, 5);
      const minV = num($("#hl-min").value, 3);
      const maxV = num($("#hl-max").value, 7);
      const positions = this.pos.values();
      const plans = [
        {
          path: await missionPath("cfgspawnabletypes.xml"),
          summary: ["Heli-Crash-Loot: " + blocks.length + " Block/Blöcke, " +
                    loot.length + " Item(s): " + loot.map((item) => item.name).join(", ")],
          transform: (current) => {
            const base = current ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<spawnabletypes>\n</spawnabletypes>\n';
            return updateSpawnableType(base, "Wreck_UH1Y", blocks, baseline);
          },
        },
        {
          path: mission("db/events.xml"),
          summary: ["StaticHeliCrash: nominal " + nominal + ", min " + minV + ", max " + maxV + "."],
          transform: (current) => {
            if (current === null) throw new Error("db/events.xml wurde auf dem Server nicht gefunden.");
            return updateEventCounts(current, "StaticHeliCrash",
              { nominal, min: minV, max: maxV });
          },
        },
      ];
      if (positions.length) {
        plans.push({
          path: await missionPath("cfgeventspawns.xml"),
          summary: [positions.length + " zusätzliche Absturzposition(en)."],
          transform: (current) => {
            if (current === null) throw new Error("cfgeventspawns.xml wurde auf dem Server nicht gefunden.");
            return upsertEventspawns(current, "StaticHeliCrash", positions, "append").text;
          },
        });
      }
      return plans;
    },
  });

  /* ------------------------------------------------ 5. Fahrzeug-Builder */

  const VEHICLES = {
    OffroadHatchback: { label: "ADA 4x4 (Lada)", parts: [
      ["HatchbackWheel", 4], ["HatchbackHood", 1], ["HatchbackTrunk", 1],
      ["HatchbackDoors_Driver", 1], ["HatchbackDoors_CoDriver", 1],
      ["CarBattery", 1], ["SparkPlug", 1], ["CarRadiator", 1], ["HeadlightH7", 2]] },
    Hatchback_02: { label: "Gunter 2 (Golf)", parts: [
      ["Hatchback_02_Wheel", 4], ["Hatchback_02_Hood", 1], ["Hatchback_02_Trunk", 1],
      ["Hatchback_02_Door_1_1", 1], ["Hatchback_02_Door_1_2", 1],
      ["Hatchback_02_Door_2_1", 1], ["Hatchback_02_Door_2_2", 1],
      ["CarBattery", 1], ["SparkPlug", 1], ["CarRadiator", 1], ["HeadlightH7", 2]] },
    CivilianSedan: { label: "Olga 24 (Wolga)", parts: [
      ["CivSedanWheel", 4], ["CivSedanHood", 1], ["CivSedanTrunk", 1],
      ["CivSedanDoors_Driver", 1], ["CivSedanDoors_CoDriver", 1],
      ["CivSedanDoors_BackLeft", 1], ["CivSedanDoors_BackRight", 1],
      ["CarBattery", 1], ["SparkPlug", 1], ["CarRadiator", 1], ["HeadlightH7", 2]] },
    Sedan_02: { label: "Sarka 120 (Skoda)", parts: [
      ["Sedan_02_Wheel", 4], ["Sedan_02_Hood", 1], ["Sedan_02_Trunk", 1],
      ["Sedan_02_Door_1_1", 1], ["Sedan_02_Door_1_2", 1],
      ["Sedan_02_Door_2_1", 1], ["Sedan_02_Door_2_2", 1],
      ["CarBattery", 1], ["SparkPlug", 1], ["CarRadiator", 1], ["HeadlightH7", 2]] },
    Truck_01_Covered: { label: "M3S Truck (V3S)", parts: [
      ["Truck_01_Wheel", 2], ["Truck_01_WheelDouble", 4], ["Truck_01_Hood", 1],
      ["Truck_01_Door_1_1", 1], ["Truck_01_Door_2_1", 1],
      ["TruckBattery", 1], ["GlowPlug", 1], ["HeadlightH7", 2]] },
    Offroad_02: { label: "M1025 Humvee", parts: [
      ["Offroad_02_Wheel", 4], ["Offroad_02_Hood", 1], ["Offroad_02_Trunk", 1],
      ["Offroad_02_Door_1_1", 1], ["Offroad_02_Door_1_2", 1],
      ["Offroad_02_Door_2_1", 1], ["Offroad_02_Door_2_2", 1],
      ["CarBattery", 1], ["GlowPlug", 1], ["HeadlightH7", 2]] },
  };

  registry.push({
    id: "vehicle", icon: "🚗", title: "Fahrzeug-Builder",
    desc: "Fahrzeuge an Wunschpositionen spawnen – neue Fahrzeug-Events anlegen oder vorhandene laden und bearbeiten. Auf Wunsch komplett fahrbereit mit allen Teilen.",
    async render(form) {
      this._evDoc = await readXmlOrNull(mission("db/events.xml"));
      this._spDoc = await readXmlOrNull(await missionPath("cfgeventspawns.xml"));
      this._stDoc = await readXmlOrNull(await missionPath("cfgspawnabletypes.xml"));
      this._nameTouched = false;
      this._loadedVehicleSpawnable = null;
      this._loadedVehicleType = null;
      const vehEvents = [];
      if (this._evDoc) this._evDoc.querySelectorAll("events > event").forEach((ev) => {
        const kids = Array.from(ev.querySelectorAll(":scope > children > child"));
        if (kids.some((c) => VEHICLES[c.getAttribute("type")]))
          vehEvents.push(ev.getAttribute("name"));
      });
      form.append(loadPicker("– Neues Fahrzeug-Event erstellen –", vehEvents,
        (name) => this.fillFrom(name)));
      const sel = h("select", { id: "vh-type" });
      for (const [type, info] of Object.entries(VEHICLES))
        sel.append(h("option", { value: type }, info.label + " – " + type));
      form.append(field("Fahrzeug", sel));
      const autoName = () => "Vehicle" + sel.value.replace(/_/g, "");
      const nameInput = textInput("vh-name", autoName());
      nameInput.addEventListener("input", () => { this._nameTouched = true; });
      form.append(field("Event-Name (db/events.xml)", nameInput));
      form.append(h("p", { class: "hint" },
        "Gleicher Name = vorhandenes Event wird bearbeitet, " +
        "neuer Name = neues Event wird angelegt."));
      form.append(h("div", { class: "row" },
        "nominal:", numInput("vh-nominal", 3),
        "min:", numInput("vh-min", 2), "max:", numInput("vh-max", 4)));
      this.pos = posList({ angle: true });
      form.append(h("div", { class: "grp" },
        h("h4", {}, "Spawnpositionen"),
        field("Positions-Modus", h("select", { id: "vh-posmode" },
          h("option", { value: "replace" }, "Vorhandene Positionen ersetzen"),
          h("option", { value: "append" }, "Zu vorhandenen Positionen hinzufügen"))),
        this.pos));
      const fit = h("div", { class: "grp" },
        h("h4", {}, h("label", {},
          h("input", { type: "checkbox", id: "vh-fit", checked: "" }),
          " Komplett fahrbereit spawnen (Teile unten anpassbar)")));
      this.parts = itemList({ numLabel: "Anzahl", numDefault: 1, initial: [] });
      fit.append(this.parts);
      form.append(fit);
      const fillParts = () => {
        const fresh = itemList({ numLabel: "Anzahl", numDefault: 1,
          initial: VEHICLES[sel.value].parts.map(([i, c]) => [i, c]) });
        this.parts.replaceWith(fresh);
        this.parts = fresh;
      };
      sel.addEventListener("change", () => {
        if (!this._nameTouched) nameInput.value = autoName();
        this._loadedVehicleSpawnable = null;
        this._loadedVehicleType = null;
        fillParts();
      });
      fillParts();
    },
    fillFrom(name) {
      if (!name || !this._evDoc) return;
      const ev = findElementByName(this._evDoc, "events > event", name);
      if (!ev) return;
      const get = (f, dflt) => {
        const el = ev.querySelector(":scope > " + f);
        return el ? el.textContent.trim() : dflt;
      };
      const kids = Array.from(ev.querySelectorAll(":scope > children > child"));
      const child = kids.find((c) => VEHICLES[c.getAttribute("type")]);
      const type = child ? child.getAttribute("type") : "";
      if (type) $("#vh-type").value = type;
      $("#vh-name").value = name;
      this._nameTouched = true;   // geladener Name bleibt beim Fahrzeugwechsel stehen
      $("#vh-nominal").value = get("nominal", 3);
      $("#vh-min").value = get("min", 2);
      $("#vh-max").value = get("max", 4);
      // Verbaute Teile aus cfgspawnabletypes.xml übernehmen
      const typeNode = type && this._stDoc &&
        findElementByName(this._stDoc, "spawnabletypes > type", type);
      this._loadedVehicleSpawnable = null;
      this._loadedVehicleType = null;
      $("#vh-fit").checked = !!typeNode;
      if (typeNode) {
        this._loadedVehicleSpawnable = spawnableDefinitionFromElement(typeNode);
        this._loadedVehicleType = type;
        const counts = new Map();
        this._loadedVehicleSpawnable.blocks.forEach((block) => block.items.forEach((item) => {
          if (item.name) counts.set(item.name, (counts.get(item.name) || 0) + 1);
        }));
        const fresh = itemList({ numLabel: "Anzahl", numDefault: 1,
                                 initial: Array.from(counts) });
        this.parts.replaceWith(fresh);
        this.parts = fresh;
      }
      // Vorhandene Positionen aus cfgeventspawns.xml laden
      if (this._spDoc) {
        this.pos.setValues(Array.from(
          this._spDoc.querySelectorAll(`event[name="${name}"] > pos`)).map((p) => ({
            x: Number(p.getAttribute("x")) || 0,
            z: Number(p.getAttribute("z")) || 0,
            a: Number(p.getAttribute("a")) || 0,
          })));
      }
      toast("Event „" + name + "“ geladen – anpassen und Vorschau öffnen.");
    },
    async generate() {
      const type = $("#vh-type").value;
      const eventName = $("#vh-name").value.trim() ||
        ("Vehicle" + type.replace(/_/g, ""));
      const posMode = $("#vh-posmode").value;
      const positions = this.pos.values();
      if (!positions.length) throw new Error("Bitte mindestens eine Position angeben.");
      const nominal = num($("#vh-nominal").value, 3);
      const minV = num($("#vh-min").value, 2);
      const maxV = num($("#vh-max").value, 4);
      const def = {
        name: eventName, nominal, min: minV, max: maxV,
        lifetime: 300, restock: 0, saferadius: 500, distanceradius: 500,
        cleanupradius: 2500,
        flags: { deletable: 0, init_random: 0, remove_damaged: 1 },
        position: "fixed", limit: "custom", active: 1,
        children: [{ type, min: minV, max: maxV }],
      };
      const plans = [
        {
          path: mission("db/events.xml"),
          summary: ["Event „" + eventName + "“: " + VEHICLES[type].label +
                    ", nominal " + nominal + " (min " + minV + ", max " + maxV + ")."],
          transform: (current) => {
            if (current === null) throw new Error("db/events.xml wurde auf dem Server nicht gefunden.");
            return upsertEvent(current, def);
          },
        },
        {
          path: await missionPath("cfgeventspawns.xml"),
          summary: [positions.length + " Spawnposition(en) für " + eventName +
                    (posMode === "append" ? " (zusätzlich zu vorhandenen)."
                                          : " (ersetzt vorhandene).")],
          transform: (current) => {
            if (current === null) throw new Error("cfgeventspawns.xml wurde auf dem Server nicht gefunden.");
            return upsertEventspawns(current, eventName, positions, posMode).text;
          },
        },
      ];
      if ($("#vh-fit").checked) {
        const parts = this.parts.values();
        const baseline = type === this._loadedVehicleType
          ? this._loadedVehicleSpawnable : null;
        const blocks = baseline
          ? applySpawnableItemCounts(baseline.blocks, parts)
          : parts.flatMap((part) => Array.from(
              { length: Math.max(1, Math.round(part.num)) },
              () => ({ kind: "attachments", chance: 1,
                       items: [{ name: part.item, chance: 1 }] })));
        if (blocks.length) {
          plans.push({
            path: await missionPath("cfgspawnabletypes.xml"),
            summary: [type + " spawnt fahrbereit mit: " +
                      parts.map((p) => p.num + "× " + p.item).join(", ")],
            transform: (current) => {
              const base = current ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<spawnabletypes>\n</spawnabletypes>\n';
              return updateSpawnableType(base, type, blocks, baseline);
            },
          });
        }
      }
      return plans;
    },
  });

  /* -------------------------------------- 6. Inhalte & Aufsätze (spawnable) */

  registry.push({
    id: "spawnable", icon: "🎒", title: "Inhalte & Aufsätze",
    desc: "Bestimmen, womit ein Item spawnt: Waffen mit Aufsätzen, Rucksäcke mit Inhalt, Zombies mit Loot in den Taschen – neu anlegen oder vorhandene Einträge bearbeiten. (cfgspawnabletypes.xml)",
    async render(form) {
      this._doc = await readXmlOrNull(await missionPath("cfgspawnabletypes.xml"));
      this._loadedSpawnable = null;
      this._loadedSpawnableName = null;
      const names = this._doc
        ? Array.from(this._doc.querySelectorAll("spawnabletypes > type"))
            .map((t) => t.getAttribute("name")).filter(Boolean)
        : [];
      form.append(loadPicker("– Neuen Eintrag erstellen –", names, (name) => {
        const node = this._doc && findElementByName(this._doc, "spawnabletypes > type", name);
        if (!node) return;
        $("#sp-target").value = name;
        this._loadedSpawnable = spawnableDefinitionFromElement(node);
        this._loadedSpawnableName = name;
        const freshAtt = spawnableBlockList("attachments",
          this._loadedSpawnable.blocks.filter((block) => block.kind === "attachments"));
        this.att.replaceWith(freshAtt);
        this.att = freshAtt;
        const freshCargo = spawnableBlockList("cargo",
          this._loadedSpawnable.blocks.filter((block) => block.kind === "cargo"));
        this.cargo.replaceWith(freshCargo);
        this.cargo = freshCargo;
        toast("Eintrag „" + name + "“ geladen – anpassen und Vorschau öffnen.");
      }));
      form.append(field("Ziel (Waffe / Tasche / Zombie / Container)",
        textInput("sp-target", "", "z.B. AKM, ZmbM_SoldierNormal…", "dl-items")));
      const att = h("div", { class: "grp" }, h("h4", {}, "Aufsätze / Anbauteile (attachments)"));
      this.att = spawnableBlockList("attachments", []);
      att.append(this.att);
      form.append(att);
      const cargo = h("div", { class: "grp" }, h("h4", {}, "Inhalt (cargo)"));
      this.cargo = spawnableBlockList("cargo", []);
      cargo.append(this.cargo);
      form.append(cargo);
      form.append(h("p", { class: "hint" },
        "Jeder Block hat eine eigene Spawn-Chance; die Items darin haben " +
        "zusätzliche Einzelchancen. Beim Laden bleiben alle Blöcke und Items erhalten."));
    },
    async generate() {
      const target = $("#sp-target").value.trim();
      if (!target) throw new Error("Bitte einen Ziel-Typ angeben.");
      const baseline = target === this._loadedSpawnableName ? this._loadedSpawnable : null;
      const blocks = mergeSpawnableBlockKinds(
        this.att.values(), this.cargo.values(), baseline);
      const items = blocks.flatMap((block) => block.items);
      if (!items.length) throw new Error("Bitte mindestens einen Aufsatz oder Inhalt angeben.");
      return [{
        path: await missionPath("cfgspawnabletypes.xml"),
        summary: ["„" + target + "“: " + blocks.length + " Block/Blöcke mit " +
                  items.length + " Item(s): " + items.map((item) => item.name).join(", ")],
        transform: (current) => {
          const base = current ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<spawnabletypes>\n</spawnabletypes>\n';
          return updateSpawnableType(base, target, blocks, baseline);
        },
      }];
    },
  });

  /* ------------------------------------------------ 7. Event-Vorlagen */

  registry.push({
    id: "event", icon: "📅", title: "Event-Vorlagen",
    desc: "Eigene Events komplett konfigurieren oder vorhandene Events anpassen (db/events.xml).",
    async render(form) {
      this._loadedEvent = null;
      this._loadedEventName = null;
      const loadSel = h("select", { id: "ev-load" },
        h("option", { value: "" }, "– Neues Event –"));
      form.append(field("Vorhandenes Event laden", loadSel));
      form.append(field("Event-Name", textInput("ev-name", "StaticMeinEvent")));
      form.append(h("div", { class: "row" },
        "nominal:", numInput("ev-nominal", 1), "min:", numInput("ev-min", 1),
        "max:", numInput("ev-max", 1)));
      form.append(h("div", { class: "row" },
        "lifetime:", numInput("ev-lifetime", 1800),
        "restock:", numInput("ev-restock", 0)));
      form.append(h("div", { class: "row" },
        "saferadius:", numInput("ev-safe", 500),
        "distanceradius:", numInput("ev-dist", 500),
        "cleanupradius:", numInput("ev-cleanup", 1000)));
      form.append(h("div", { class: "row" },
        h("label", {}, h("input", { type: "checkbox", id: "ev-deletable" }), " deletable"),
        h("label", {}, h("input", { type: "checkbox", id: "ev-initrandom" }), " init_random"),
        h("label", {}, h("input", { type: "checkbox", id: "ev-removedmg", checked: "" }), " remove_damaged"),
        h("label", {}, h("input", { type: "checkbox", id: "ev-active", checked: "" }), " aktiv")));
      form.append(h("div", { class: "row" },
        "position:", h("select", { id: "ev-position" },
          h("option", { value: "fixed" }, "fixed (feste Orte)"),
          h("option", { value: "player" }, "player (nahe Spielern)")),
        "limit:", h("select", { id: "ev-limit" },
          h("option", { value: "custom" }, "custom"),
          h("option", { value: "mixed" }, "mixed"),
          h("option", { value: "child" }, "child"),
          h("option", { value: "parent" }, "parent"))));
      const kids = h("div", { class: "grp" }, h("h4", {}, "Kinder (was spawnt)"));
      this.children = eventChildrenList([]);
      kids.append(this.children);
      form.append(kids);
      this.pos = posList({ angle: true, startEmpty: true });
      form.append(h("div", { class: "grp" },
        h("h4", {}, "Feste Positionen (optional, ersetzt vorhandene)"), this.pos));

      // Vorhandene Events zum Laden anbieten
      this._eventsDoc = await readXmlOrNull(mission("db/events.xml"));
      this._spawnsDoc = await readXmlOrNull(await missionPath("cfgeventspawns.xml"));
      if (this._eventsDoc) {
        this._eventsDoc.querySelectorAll("events > event").forEach((ev) => {
          loadSel.append(h("option", { value: ev.getAttribute("name") },
            ev.getAttribute("name")));
        });
        loadSel.addEventListener("change", () => this.fillFrom(loadSel.value));
      }
    },
    fillFrom(name) {
      if (!name || !this._eventsDoc) return;
      const ev = findElementByName(this._eventsDoc, "events > event", name);
      if (!ev) return;
      const loaded = eventDefinitionFromElement(ev);
      this._loadedEvent = loaded;
      this._loadedEventName = name;
      $("#ev-name").value = name;
      $("#ev-nominal").value = loaded.nominal;
      $("#ev-min").value = loaded.min;
      $("#ev-max").value = loaded.max;
      $("#ev-lifetime").value = loaded.lifetime;
      $("#ev-restock").value = loaded.restock;
      $("#ev-safe").value = loaded.saferadius;
      $("#ev-dist").value = loaded.distanceradius;
      $("#ev-cleanup").value = loaded.cleanupradius;
      $("#ev-position").value = loaded.position;
      $("#ev-limit").value = loaded.limit;
      $("#ev-active").checked = Number(loaded.active) === 1;
      $("#ev-deletable").checked = Number(loaded.flags.deletable) === 1;
      $("#ev-initrandom").checked = Number(loaded.flags.init_random) === 1;
      $("#ev-removedmg").checked = Number(loaded.flags.remove_damaged) === 1;
      const fresh = eventChildrenList(loaded.children);
      this.children.replaceWith(fresh);
      this.children = fresh;
      // Vorhandene Positionen aus cfgeventspawns.xml übernehmen
      if (this._spawnsDoc) {
        const spawnEvent = findElementByName(this._spawnsDoc, "eventposdef > event", name);
        this.pos.setValues(Array.from(spawnEvent ? spawnEvent.children : [])
          .filter((node) => node.localName === "pos").map((p) => ({
            x: Number(p.getAttribute("x")) || 0,
            z: Number(p.getAttribute("z")) || 0,
            a: Number(p.getAttribute("a")) || 0,
          })));
      }
      toast("Event „" + name + "“ geladen – Werte anpassen und Vorschau öffnen.");
    },
    async generate() {
      const name = $("#ev-name").value.trim();
      if (!name) throw new Error("Bitte einen Event-Namen angeben.");
      const children = this.children.values();
      if (!children.length) throw new Error("Bitte mindestens ein Kind (Spawn-Typ) angeben.");
      const def = {
        name,
        nominal: num($("#ev-nominal").value, 1),
        min: num($("#ev-min").value, 1),
        max: num($("#ev-max").value, 1),
        lifetime: num($("#ev-lifetime").value, 1800),
        restock: num($("#ev-restock").value, 0),
        saferadius: num($("#ev-safe").value, 500),
        distanceradius: num($("#ev-dist").value, 500),
        cleanupradius: num($("#ev-cleanup").value, 1000),
        flags: {
          deletable: $("#ev-deletable").checked ? 1 : 0,
          init_random: $("#ev-initrandom").checked ? 1 : 0,
          remove_damaged: $("#ev-removedmg").checked ? 1 : 0,
        },
        position: $("#ev-position").value,
        limit: $("#ev-limit").value,
        active: $("#ev-active").checked ? 1 : 0,
        children,
      };
      const loadedName = this._loadedEventName;
      const baseline = this._loadedEvent;
      const positions = this.pos.values();
      const plans = [{
        path: mission("db/events.xml"),
        summary: ["Event „" + name + "“ (nominal " + def.nominal + ", " +
                  children.map((c) => c.min + "–" + c.max + "× " + c.type)
                    .join(", ") + ")."],
        transform: (current) => {
          if (current === null) throw new Error("db/events.xml wurde auf dem Server nicht gefunden.");
          return updateEventTemplate(current, loadedName, def, baseline);
        },
      }];
      if (positions.length) {
        plans.push({
          path: await missionPath("cfgeventspawns.xml"),
          summary: [positions.length + " feste Position(en) für „" + name + "“."],
          transform: (current) => {
            if (current === null) throw new Error("cfgeventspawns.xml wurde auf dem Server nicht gefunden.");
            return upsertEventspawns(current, name, positions, "replace").text;
          },
        });
      }
      return plans;
    },
  });

  /* ======================================================== UI-Aufbau */

  let initialized = false;

  /* Nach einem Kartenwechsel hängen alle Daten am neuen Missionsordner:
     Caches leeren, Vormerkungen verwerfen, offenes Formular schließen. */
  function resetScopedState(previousLabel) {
    itemCache = null;
    missionFiles = null;
    ["dl-items", "dl-zmb"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    if (staged.length) {
      staged.length = 0;
      updateStagingBar();
      toast("Vorgemerkte Änderungen verworfen – sie gehörten zum vorherigen " +
            previousLabel + ".", "warn");
    }
    if (initialized && currentTool) {
      $("#tool-panel").classList.add("hidden");
      $("#tools-home").classList.remove("hidden");
      currentTool = null;
    }
    if (initialized) ensureDatalists();
  }

  function onMissionChanged() { resetScopedState("Missionsordner"); }
  function onServerChanged() { resetScopedState("Server"); }

  function init() {
    if (initialized) return;
    initialized = true;
    const grid = $("#tools-grid");
    for (const tool of registry) {
      grid.append(h("div", { class: "tool-card", onclick: () => openTool(tool) },
        h("span", { class: "tool-icon" }, tool.icon),
        h("div", {}, h("b", {}, tool.title), h("small", {}, tool.desc))));
    }
    $("#btn-tool-back").addEventListener("click", () => {
      $("#tool-panel").classList.add("hidden");
      $("#tools-home").classList.remove("hidden");
      currentTool = null;
    });
    $("#btn-tool-preview").addEventListener("click", () => {
      if (currentTool) showPreview(currentTool);
    });
    $("#btn-preview-cancel").addEventListener("click", () => {
      $("#preview-overlay").classList.add("hidden");
      pendingPlans = null;
    });
    $("#btn-preview-apply").addEventListener("click", () => {
      if (pendingPlans) staged.push(...pendingPlans);
      pendingPlans = null;
      $("#preview-overlay").classList.add("hidden");
      updateStagingBar();
      toast("Änderung vorgemerkt. Unten auf „💾 Speichern“ tippen, um sie hochzuladen.");
    });
    $("#btn-staging-save").addEventListener("click", saveStaged);
    $("#btn-staging-clear").addEventListener("click", () => {
      staged.length = 0;
      updateStagingBar();
    });
    bindPickerButtons();
    ensureDatalists();
  }

  async function openTool(tool) {
    currentTool = tool;
    $("#tools-home").classList.add("hidden");
    $("#tool-panel").classList.remove("hidden");
    $("#tool-title").textContent = tool.icon + " " + tool.title;
    $("#tool-desc").textContent = tool.desc;
    const form = $("#tool-form");
    form.innerHTML = "";
    await ensureDatalists();
    try {
      await tool.render(form);
    } catch (err) {
      toast("Tool konnte nicht geladen werden: " + err.message, "error");
    }
  }

  return { init, registry, onMissionChanged, onServerChanged,
           hasStaged: () => staged.length > 0,
           _test: { upsertEvent, upsertEventspawns,
                    upsertSpawnableType, upsertSpawnableTypeBlocks,
                    updateSpawnableType, parseSpawnableType,
                    parseEventDefinition, updateEventTemplate,
                    applySpawnableItemCounts, mergeSpawnableBlockKinds,
                    loadoutVisibleState, updateLoadoutPreset,
                    buildNewLoadoutPreset, clampPickerPoint,
                    updateEventCounts,
                    lineDiff } };
})();

window.Tools = Tools;
