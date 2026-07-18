"use strict";

const STORAGE_KEY = "dayz-loadouts-v1";
const SLOTS = [
  ["Headgear", "Kopf", "Helm, Mütze oder Hut"],
  ["Mask", "Gesicht", "Maske oder Atemschutz"],
  ["Eyewear", "Brille", "Brille oder Nachtsicht"],
  ["Body", "Oberkörper", "Jacke, Shirt oder Pullover"],
  ["Vest", "Weste", "Schutz- oder Trageweste"],
  ["Gloves", "Hände", "Handschuhe"],
  ["Armband", "Armband", "Team-Kennzeichnung"],
  ["Legs", "Beine", "Hose"],
  ["Feet", "Füße", "Schuhe oder Stiefel"],
  ["Back", "Rücken", "Rucksack"],
  ["Shoulder", "Schulter", "Langwaffe"],
  ["Melee", "Nahkampf", "Werkzeug oder Nahkampfwaffe"],
  ["Hips", "Hüfte", "Gürtel oder Holster"],
  ["Hands", "In den Händen", "Startgegenstand in der Hand"]
];

const data = window.LoadoutData || { items: [], compatibility: {} };
const state = { slots: {}, extras: {}, cargo: [], currentId: null };
const $ = (selector, root = document) => root.querySelector(selector);

function attributes() {
  const [healthMin, healthMax] = $("#health").value.split(",").map(Number);
  return { healthMin, healthMax, quantityMin: -1, quantityMax: -1 };
}

function compatibilityFor(item) {
  if (!item) return null;
  if (data.compatibility[item]) return data.compatibility[item];
  const key = Object.keys(data.compatibility).find((name) => name.toLowerCase() === item.toLowerCase());
  return key ? data.compatibility[key] : null;
}

function fillDatabase() {
  const list = $("#item-database");
  const fragment = document.createDocumentFragment();
  for (const item of data.items) {
    const option = document.createElement("option");
    option.value = item.name;
    option.label = item.category || "DayZ Item";
    fragment.appendChild(option);
  }
  list.appendChild(fragment);
}

function renderSlots() {
  const wrap = $("#slots");
  wrap.innerHTML = "";
  for (const [slot, label, help] of SLOTS) {
    const card = document.createElement("article");
    card.className = "slot-card";
    card.innerHTML = `<div class="slot-title"><b>${label}</b><span>${slot}</span></div>` +
      `<label>${help}<div class="slot-input-row"><input list="item-database" autocomplete="off" placeholder="DayZ-Klassenname"><button class="button subtle clear" title="Platz leeren">×</button></div></label>` +
      `<div class="extras hidden"></div>`;
    const input = $("input", card);
    input.value = state.slots[slot] || "";
    input.addEventListener("change", () => {
      const before = state.slots[slot] || "";
      state.slots[slot] = input.value.trim();
      if (before !== state.slots[slot]) delete state.extras[slot];
      renderExtras(card, slot);
      updatePreview();
    });
    input.addEventListener("input", () => {
      state.slots[slot] = input.value.trim();
      renderExtras(card, slot);
      updatePreview();
    });
    $(".clear", card).addEventListener("click", () => {
      input.value = "";
      delete state.slots[slot];
      delete state.extras[slot];
      renderExtras(card, slot);
      updatePreview();
    });
    wrap.appendChild(card);
    renderExtras(card, slot);
  }
}

function renderExtras(card, slot) {
  const box = $(".extras", card);
  const compat = compatibilityFor(state.slots[slot]);
  box.innerHTML = "";
  box.classList.toggle("hidden", !compat);
  if (!compat) return;
  const chosen = state.extras[slot] || { attachments: [], magazine: "" };
  state.extras[slot] = chosen;

  if ((compat.attachments || []).length) {
    const title = document.createElement("label");
    title.textContent = "Passende Aufsätze";
    box.appendChild(title);
    const choices = document.createElement("div");
    choices.className = "attachment-list";
    for (const name of compat.attachments) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = chosen.attachments.includes(name);
      input.addEventListener("change", () => {
        chosen.attachments = input.checked
          ? Array.from(new Set([...chosen.attachments, name]))
          : chosen.attachments.filter((entry) => entry !== name);
        updatePreview();
      });
      label.append(input, document.createTextNode(name));
      choices.appendChild(label);
    }
    box.appendChild(choices);
  }
  if ((compat.magazines || []).length) {
    const label = document.createElement("label");
    label.textContent = "Eingesetztes Magazin";
    const select = document.createElement("select");
    select.appendChild(new Option("– kein Magazin –", ""));
    for (const name of compat.magazines) select.appendChild(new Option(name, name));
    select.value = chosen.magazine || "";
    select.addEventListener("change", () => { chosen.magazine = select.value; updatePreview(); });
    label.appendChild(select);
    box.appendChild(label);
  }
}

function addCargo(item = "", count = 1) {
  const entry = { item, count };
  state.cargo.push(entry);
  const row = document.createElement("div");
  row.className = "cargo-row";
  const input = document.createElement("input");
  input.setAttribute("list", "item-database");
  input.placeholder = "z. B. BandageDressing";
  input.value = item;
  const number = document.createElement("input");
  number.type = "number"; number.min = "1"; number.max = "99"; number.value = count;
  const remove = document.createElement("button");
  remove.className = "button subtle danger"; remove.textContent = "×"; remove.title = "Item entfernen";
  input.addEventListener("input", () => { entry.item = input.value.trim(); updatePreview(); });
  number.addEventListener("input", () => { entry.count = Math.max(1, Math.round(Number(number.value) || 1)); updatePreview(); });
  remove.addEventListener("click", () => { state.cargo.splice(state.cargo.indexOf(entry), 1); row.remove(); updatePreview(); });
  row.append(input, number, remove);
  $("#cargo-list").appendChild(row);
}

function buildPreset() {
  const slotSets = [];
  for (const [slot] of SLOTS) {
    const item = (state.slots[slot] || "").trim();
    if (!item) continue;
    const extras = state.extras[slot] || { attachments: [], magazine: "" };
    const children = [...(extras.attachments || [])];
    if (extras.magazine) children.push(extras.magazine);
    slotSets.push({
      slotName: slot,
      discreteItemSets: [{
        itemType: item,
        spawnWeight: 1,
        attributes: attributes(),
        simpleChildrenTypes: children,
        complexChildrenTypes: []
      }]
    });
  }
  const cargo = [];
  for (const entry of state.cargo) {
    if (!entry.item) continue;
    for (let i = 0; i < Math.max(1, entry.count); i += 1) cargo.push(entry.item);
  }
  return {
    name: $("#preset-name").value.trim() || "Mein Loadout",
    spawnWeight: Math.max(0.01, Number($("#spawn-weight").value) || 1),
    characterTypes: [],
    attachmentSlotItemSets: slotSets,
    discreteUnsortedItemSets: cargo.length ? [{
      name: "Cargo", spawnWeight: 1, attributes: attributes(),
      simpleChildrenTypes: cargo, complexChildrenTypes: []
    }] : []
  };
}

function updatePreview() {
  $("#preview").textContent = JSON.stringify(buildPreset(), null, 4);
}

function loadPreset(preset) {
  $("#preset-name").value = preset.name || "Mein Loadout";
  $("#spawn-weight").value = preset.spawnWeight || 1;
  state.slots = {};
  state.extras = {};
  for (const set of preset.attachmentSlotItemSets || []) {
    const itemSet = (set.discreteItemSets || [])[0];
    if (!itemSet) continue;
    state.slots[set.slotName] = itemSet.itemType || "";
    const compat = compatibilityFor(itemSet.itemType);
    const children = itemSet.simpleChildrenTypes || [];
    if (compat) {
      state.extras[set.slotName] = {
        attachments: children.filter((item) => (compat.attachments || []).includes(item)),
        magazine: children.find((item) => (compat.magazines || []).includes(item)) || ""
      };
    }
    const attrs = itemSet.attributes;
    if (attrs && attrs.healthMin !== undefined) $("#health").value = `${attrs.healthMin},${attrs.healthMax}`;
  }
  state.cargo = [];
  $("#cargo-list").innerHTML = "";
  const counts = new Map();
  for (const set of preset.discreteUnsortedItemSets || []) {
    for (const item of set.simpleChildrenTypes || []) counts.set(item, (counts.get(item) || 0) + 1);
  }
  for (const [item, count] of counts) addCargo(item, count);
  if (!counts.size) addCargo("BandageDressing", 2);
  renderSlots();
  updatePreview();
}

function exampleToPreset(example) {
  const preset = {
    name: example.title, spawnWeight: 1, characterTypes: [],
    attachmentSlotItemSets: [], discreteUnsortedItemSets: []
  };
  for (const [slot, item] of Object.entries(example.slots || {})) {
    const extras = (example.slotExtras || {})[slot] || {};
    preset.attachmentSlotItemSets.push({ slotName: slot, discreteItemSets: [{
      itemType: item, spawnWeight: 1,
      attributes: { healthMin: .7, healthMax: 1, quantityMin: -1, quantityMax: -1 },
      simpleChildrenTypes: [...(extras.attachments || []), ...(extras.magazine ? [extras.magazine] : [])],
      complexChildrenTypes: []
    }] });
  }
  const cargo = [];
  for (const [item, count] of example.cargo || []) for (let i = 0; i < count; i += 1) cargo.push(item);
  if (cargo.length) preset.discreteUnsortedItemSets.push({ name: "Cargo", spawnWeight: 1,
    attributes: { healthMin: .7, healthMax: 1, quantityMin: -1, quantityMax: -1 },
    simpleChildrenTypes: cargo, complexChildrenTypes: [] });
  return preset;
}

function message(text) {
  $("#message").textContent = text;
  setTimeout(() => { if ($("#message").textContent === text) $("#message").textContent = ""; }, 4500);
}

function downloadPreset(preset) {
  const safe = (preset.name || "loadout").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "loadout";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 4) + "\n"], { type: "application/json" }));
  link.download = `custom_${safe}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

fillDatabase();
renderSlots();
addCargo("BandageDressing", 2);

const draftRaw = sessionStorage.getItem("dayz-loadout-draft");
if (draftRaw) {
  try {
    const draft = JSON.parse(draftRaw);
    state.currentId = draft.id || null;
    loadPreset(draft.preset || exampleToPreset(draft.example));
  } catch (_) { updatePreview(); }
  sessionStorage.removeItem("dayz-loadout-draft");
} else {
  updatePreview();
}

for (const selector of ["#preset-name", "#spawn-weight", "#health"]) {
  $(selector).addEventListener("input", updatePreview);
}
$("#add-cargo").addEventListener("click", () => { addCargo(); updatePreview(); });
$("#clear-slots").addEventListener("click", () => { state.slots = {}; state.extras = {}; renderSlots(); updatePreview(); });
$("#download").addEventListener("click", () => downloadPreset(buildPreset()));
$("#copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(buildPreset(), null, 4)); message("JSON wurde kopiert."); }
  catch (_) { message("Kopieren wurde vom Browser blockiert. Bitte den Text in der Vorschau markieren."); }
});
$("#save-local").addEventListener("click", () => {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch (_) { saved = []; }
  const preset = buildPreset();
  const id = state.currentId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const record = { id, updated: Date.now(), preset };
  const index = saved.findIndex((entry) => entry.id === id);
  if (index === -1) saved.unshift(record); else saved[index] = record;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  state.currentId = id;
  message("✓ Loadout wurde nur auf diesem Gerät gespeichert.");
});
