"use strict";

const STORAGE_KEY = "dayz-loadouts-v1";
const $ = (selector) => document.querySelector(selector);

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch (_) { return []; }
}

function writeSaved(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  renderSaved();
}

function card(title, description, meta, actions) {
  const article = document.createElement("article");
  article.className = "preset-card";
  const heading = document.createElement("h3"); heading.textContent = title;
  const text = document.createElement("p"); text.textContent = description;
  const info = document.createElement("div"); info.className = "meta"; info.textContent = meta;
  const buttons = document.createElement("div"); buttons.className = "preset-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.className = "button " + (action.className || "");
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    buttons.appendChild(button);
  }
  article.append(heading, text, info, buttons);
  return article;
}

function openDraft(draft) {
  sessionStorage.setItem("dayz-loadout-draft", JSON.stringify(draft));
  location.href = "./";
}

function download(preset) {
  const safe = (preset.name || "loadout").toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "loadout";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 4) + "\n"], { type: "application/json" }));
  link.download = `custom_${safe}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function summary(preset) {
  const slots = (preset.attachmentSlotItemSets || []).length;
  const cargo = (preset.discreteUnsortedItemSets || []).reduce((sum, set) => sum + (set.simpleChildrenTypes || []).length, 0);
  return `${slots} Plätze · ${cargo} Cargo-Items`;
}

function renderSaved() {
  const wrap = $("#saved-list");
  const saved = readSaved().sort((a, b) => b.updated - a.updated);
  wrap.innerHTML = "";
  if (!saved.length) {
    const empty = document.createElement("div"); empty.className = "empty";
    empty.textContent = "Noch kein eigenes Loadout gespeichert. Starte mit einem Beispiel oder lege ein neues an.";
    wrap.appendChild(empty); return;
  }
  for (const record of saved) {
    const preset = record.preset || {};
    wrap.appendChild(card(preset.name || "Unbenannt", "Zuletzt gespeichert: " + new Date(record.updated).toLocaleString("de-DE"), summary(preset), [
      { label: "Bearbeiten", className: "primary", run: () => openDraft({ id: record.id, preset }) },
      { label: "JSON", run: () => download(preset) },
      { label: "Löschen", className: "danger subtle", run: () => {
        if (confirm(`„${preset.name || "Unbenannt"}“ wirklich löschen?`)) writeSaved(readSaved().filter((entry) => entry.id !== record.id));
      } }
    ]));
  }
}

function renderExamples() {
  const wrap = $("#example-list");
  for (const example of window.LoadoutExamples || []) {
    const count = Object.keys(example.slots || {}).length;
    const cargo = (example.cargo || []).reduce((sum, entry) => sum + entry[1], 0);
    wrap.appendChild(card(example.title, example.description, `${count} Plätze · ${cargo} Cargo-Items`, [
      { label: "Kopieren & anpassen", className: "primary", run: () => openDraft({ example }) }
    ]));
  }
}

renderSaved();
renderExamples();
