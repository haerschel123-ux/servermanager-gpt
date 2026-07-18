import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2] || path.join(here, "..", "types.xml"));
const target = path.join(here, "data.js");
const xml = fs.readFileSync(source, "utf8");

const decode = (value) => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const items = [];
const seen = new Set();
for (const match of xml.matchAll(/<type\b[^>]*\bname\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/type\s*>/gi)) {
  const name = decode(match[2]);
  if (!name || seen.has(name)) continue;
  seen.add(name);
  const category = /<category\b[^>]*\bname\s*=\s*(["'])(.*?)\1/i.exec(match[3]);
  items.push({ name, category: category ? decode(category[2]) : "" });
}
items.sort((a, b) => a.name.localeCompare(b.name, "en"));

// Häufige Vanilla-Waffen. Unbekannte oder gemoddete Klassen lassen sich
// weiterhin frei eintippen; diese Liste liefert nur die bequemen Auswahlen.
const compatibility = {
  AKM: { attachments: ["AK_WoodHndgrd", "AK_PlasticHndgrd", "AK_RailHndgrd", "AK_WoodBttstck", "AK_PlasticBttstck", "AK_FoldingBttstck", "PSO1Optic", "KobraOptic", "AK_Suppressor", "UniversalLight"], magazines: ["Mag_AKM_30Rnd", "Mag_AKM_Drum75Rnd", "Mag_AKM_Palm30Rnd"] },
  AK74: { attachments: ["AK74_Hndgrd", "AK74_WoodBttstck", "AK_FoldingBttstck", "PSO1Optic", "KobraOptic", "AK_Suppressor", "UniversalLight"], magazines: ["Mag_AK74_30Rnd"] },
  AK101: { attachments: ["AK_PlasticHndgrd", "AK_RailHndgrd", "AK_PlasticBttstck", "AK_FoldingBttstck", "PSO1Optic", "KobraOptic", "AK_Suppressor", "UniversalLight"], magazines: ["Mag_AK101_30Rnd"] },
  M4A1: { attachments: ["M4_PlasticHndgrd", "M4_RISHndgrd", "M4_MPHndgrd", "M4_OEBttstck", "M4_MPBttstck", "M4_CQBBttstck", "ACOGOptic", "M68Optic", "ReflexOptic", "M4_Suppressor", "UniversalLight"], magazines: ["Mag_STANAG_30Rnd", "Mag_STANAGCoupled_30Rnd", "Mag_CMAG_10Rnd", "Mag_CMAG_20Rnd", "Mag_CMAG_30Rnd", "Mag_CMAG_40Rnd"] },
  M16A2: { attachments: ["UniversalLight"], magazines: ["Mag_STANAG_30Rnd", "Mag_STANAGCoupled_30Rnd", "Mag_CMAG_10Rnd", "Mag_CMAG_20Rnd", "Mag_CMAG_30Rnd", "Mag_CMAG_40Rnd"] },
  FAL: { attachments: ["Fal_OeBttstck", "Fal_FoldingBttstck", "ACOGOptic", "M68Optic", "ReflexOptic", "UniversalLight"], magazines: ["Mag_FAL_20Rnd"] },
  SVD: { attachments: ["PSO1Optic", "PSO11Optic", "AK_Suppressor", "ImprovisedSuppressor"], magazines: ["Mag_SVD_10Rnd"] },
  VSS: { attachments: ["PSO1Optic", "PSO11Optic", "KobraOptic", "UniversalLight"], magazines: ["Mag_VSS_10Rnd", "Mag_VAL_20Rnd"] },
  ASVAL: { attachments: ["ACOGOptic", "M68Optic", "ReflexOptic", "UniversalLight"], magazines: ["Mag_VSS_10Rnd", "Mag_VAL_20Rnd"] },
  AUG: { attachments: ["ACOGOptic", "M68Optic", "ReflexOptic", "M4_Suppressor", "UniversalLight"], magazines: ["Mag_STANAG_30Rnd", "Mag_CMAG_30Rnd", "Mag_CMAG_40Rnd"] },
  FAMAS: { attachments: ["FAMAS_Bttstck", "UniversalLight"], magazines: ["Mag_FAMAS_25Rnd"] },
  CZ61: { attachments: ["PistolSuppressor"], magazines: ["Mag_CZ61_20Rnd"] },
  UMP45: { attachments: ["M68Optic", "ReflexOptic", "PistolSuppressor", "UniversalLight"], magazines: ["Mag_UMP_25Rnd"] },
  MP5K: { attachments: ["MP5_PlasticHndgrd", "MP5_RailHndgrd", "MP5k_StockBttstck", "M68Optic", "ReflexOptic", "PistolSuppressor", "UniversalLight"], magazines: ["Mag_MP5_15Rnd", "Mag_MP5_30Rnd"] },
  CZ75: { attachments: ["PistolOptic", "PistolSuppressor", "TLRLight"], magazines: ["Mag_CZ75_15Rnd"] },
  Glock19: { attachments: ["PistolOptic", "PistolSuppressor", "TLRLight"], magazines: ["Mag_Glock_15Rnd"] },
  FNX45: { attachments: ["FNP45_MRDSOptic", "PistolSuppressor", "TLRLight"], magazines: ["Mag_FNX45_15Rnd"] },
  Deagle: { attachments: ["PistolOptic", "TLRLight"], magazines: ["Mag_Deagle_9Rnd"] },
  Colt1911: { attachments: ["PistolSuppressor"], magazines: ["Mag_1911_7Rnd"] },
  MakarovIJ70: { attachments: ["PistolSuppressor"], magazines: ["Mag_IJ70_8Rnd"] },
  MKII: { attachments: [], magazines: ["Mag_MKII_10Rnd"] },
  Mosin9130: { attachments: ["PUScopeOptic", "Mosin_Compensator", "Mosin_Bayonet", "ImprovisedSuppressor"], magazines: [] },
  SKS: { attachments: ["PUScopeOptic", "SKS_Bayonet", "ImprovisedSuppressor"], magazines: [] },
  Winchester70: { attachments: ["HuntingOptic", "ImprovisedSuppressor"], magazines: [] },
  CZ527: { attachments: ["HuntingOptic", "ImprovisedSuppressor"], magazines: ["Mag_CZ527_5rnd"] },
  CZ550: { attachments: ["HuntingOptic", "ImprovisedSuppressor"], magazines: ["Mag_CZ550_4rnd", "Mag_CZ550_10rnd"] },
  Scout: { attachments: ["ACOGOptic", "M68Optic", "ReflexOptic", "ImprovisedSuppressor"], magazines: ["Mag_Scout_5Rnd"] },
  Saiga: { attachments: ["KobraOptic", "UniversalLight"], magazines: ["Mag_Saiga_5Rnd", "Mag_Saiga_8Rnd", "Mag_Saiga_Drum20Rnd"] }
};

const output = `/* Automatisch aus ${path.basename(source)} erzeugt: ${items.length} Items. */\n` +
  `"use strict";\nwindow.LoadoutData = ${JSON.stringify({ items, compatibility })};\n`;
fs.writeFileSync(target, output, "utf8");
console.log(`Loadout-Datenbank geschrieben: ${items.length} Items -> ${target}`);
