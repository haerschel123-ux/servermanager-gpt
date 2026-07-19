#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/build-loadout-slot-data.js <dzbloadouts.sql> <slot-data.js>");
  process.exit(1);
}

const TABLE_TO_SLOT = {
  armband: "Armband",
  back: "Back",
  body: "Body",
  discrete_items: "Cargo",
  eyewear: "Eyewear",
  feet: "Feet",
  gloves: "Gloves",
  hands: "Hands",
  headgear: "Headgear",
  hips: "Hips",
  legs: "Legs",
  mask: "Mask",
  shoulderl: "shoulderL",
  shoulderr: "shoulderR",
  vest: "Vest",
};

function splitRows(valueBlock) {
  const rows = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = -1;

  for (let index = 0; index < valueBlock.length; index += 1) {
    const char = valueBlock[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") quoted = true;
    else if (char === "(" && depth++ === 0) start = index + 1;
    else if (char === ")" && --depth === 0 && start >= 0) {
      rows.push(valueBlock.slice(start, index));
      start = -1;
    }
  }
  return rows;
}

function splitFields(row) {
  const fields = [];
  let quoted = false;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") quoted = true;
    else if (char === ",") {
      fields.push(row.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(row.slice(start).trim());
  return fields;
}

function decodeSqlValue(raw) {
  if (raw === "NULL") return null;
  if (!raw.startsWith("'") || !raw.endsWith("'")) return raw;
  return raw
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

function parseDatabase(sql) {
  const tables = {};
  const insertPattern = /INSERT INTO `([^`]+)`[^;]*? VALUES\s*([\s\S]*?);/g;
  let match;

  while ((match = insertPattern.exec(sql))) {
    const table = match[1];
    if (!TABLE_TO_SLOT[table]) continue;
    if (!tables[table]) tables[table] = [];

    for (const rawRow of splitRows(match[2])) {
      const fields = splitFields(rawRow).map(decodeSqlValue);
      if (fields.length !== 12) {
        throw new Error(`Unexpected ${table} row with ${fields.length} fields`);
      }
      tables[table].push({
        itemType: fields[1],
        simpleChildrenTypes: JSON.parse(fields[2] || "[]"),
        complexChildrenTypes: JSON.parse(fields[3] || "[]"),
        gameVersion: fields[10] || "0",
      });
    }
  }
  return tables;
}

function latestRows(rows) {
  const latest = new Map();
  for (const row of rows || []) {
    const previous = latest.get(row.itemType);
    if (!previous || compareVersions(row.gameVersion, previous.gameVersion) >= 0) {
      latest.set(row.itemType, row);
    }
  }
  return latest;
}

function compareVersions(left, right) {
  const leftParts = String(left || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function sortNames(names) {
  return [...new Set(names.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }));
}

const sql = fs.readFileSync(path.resolve(inputPath), "utf8");
const tables = parseDatabase(sql);
const slotItems = {};
let databaseVersion = "0";

for (const [table, slotName] of Object.entries(TABLE_TO_SLOT)) {
  const rows = latestRows(tables[table]);
  slotItems[slotName] = sortNames([...rows.keys()]);
  for (const row of rows.values()) {
    if (compareVersions(row.gameVersion, databaseVersion) > 0) databaseVersion = row.gameVersion;
  }
}

const weaponCompatibility = {};
for (const [itemType, row] of latestRows(tables.shoulderl)) {
  weaponCompatibility[itemType] = {
    simple: sortNames(row.simpleChildrenTypes || []),
    complex: (row.complexChildrenTypes || [])
      .filter((entry) => entry && entry.itemType)
      .map((entry) => [entry.itemType, sortNames(entry.complexChildrenFurther || [])])
      .sort((left, right) => left[0].localeCompare(right[0], "en", { sensitivity: "base" })),
  };
}

const generated = `// Auto-generated from the supplied dzbloadouts.sql slot database.\n` +
  `// Contains canonical CfgSlots membership and compatible weapon attachments.\n` +
  `window.DAYZ_SLOT_DATABASE_VERSION = ${JSON.stringify(databaseVersion)};\n` +
  `window.DAYZ_SLOT_ITEMS = ${JSON.stringify(slotItems)};\n` +
  `window.DAYZ_WEAPON_COMPATIBILITY = ${JSON.stringify(weaponCompatibility)};\n`;

fs.writeFileSync(path.resolve(outputPath), generated, "utf8");
console.log(`Wrote ${outputPath} (${Object.values(slotItems).reduce((sum, items) => sum + items.length, 0)} slot rows)`);
