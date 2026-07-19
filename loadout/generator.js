// generator.js - DayZ Player Loadout Generator (cfgPlayerSpawnGearPresets builder)
// Rebuilt to match the original dayzboosterz loadout generator as closely as possible,
// but fully client-side: dataset ships in data.js, loadouts are stored in localStorage.

window.UIManager = {
  showNotification(msg, type = 'info') {
    if (window.Swal) {
      Swal.fire({
        title: type.charAt(0).toUpperCase() + type.slice(1), text: msg, icon: type,
        toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
        timerProgressBar: true, background: '#2a2a2a', color: '#f0f0f0'
      });
    } else alert(msg);
  }
};

const CATEGORY_ICONS = {
  weapon: 'ti-crosshair', pistol: 'ti-crosshair', tool: 'ti-tool', top: 'ti-shirt',
  pants: 'ti-shirt', clothing: 'ti-shirt', headwear: 'ti-shirt', helmet: 'ti-shield',
  footwear: 'ti-shoe', gloves: 'ti-hand-stop', mask: 'ti-mask', bag: 'ti-backpack',
  vest: 'ti-shield', armband: 'ti-tag', belt: 'ti-line-dashed', food: 'ti-apple',
  ammo: 'ti-box', magazine: 'ti-box', optic: 'ti-zoom-in', suppressor: 'ti-volume-3',
  bayonet: 'ti-sword', electronics: 'ti-cpu', explosive: 'ti-bomb', container: 'ti-package',
  pouch: 'ti-package', holster: 'ti-package', sheath: 'ti-package', misc: 'ti-box',
  weapon_part: 'ti-settings', weapon_stock: 'ti-settings', weapon_handguard: 'ti-settings'
};

const CHARACTERS = {
  Male: ['SurvivorM_Mirek','SurvivorM_Denis','SurvivorM_Boris','SurvivorM_Cyril','SurvivorM_Elias',
    'SurvivorM_Francis','SurvivorM_Guo','SurvivorM_Hassan','SurvivorM_Indar','SurvivorM_Jose',
    'SurvivorM_Kaito','SurvivorM_Lewis','SurvivorM_Manua','SurvivorM_Niki','SurvivorM_Oliver',
    'SurvivorM_Peter','SurvivorM_Quinn','SurvivorM_Rolf','SurvivorM_Seth','SurvivorM_Taiki'],
  Female: ['SurvivorF_Baty','SurvivorF_Eva','SurvivorF_Frida','SurvivorF_Gabi','SurvivorF_Helga',
    'SurvivorF_Irena','SurvivorF_Judy','SurvivorF_Keiko','SurvivorF_Linda',
    'SurvivorF_Maria','SurvivorF_Naomi']
};

const SLOT_ITEMS = window.DAYZ_SLOT_ITEMS || {};
const SLOT_ITEM_SETS = Object.fromEntries(
  Object.entries(SLOT_ITEMS).map(([slotName, names]) => [slotName, new Set(names)])
);

const ORIGINAL_ITEMS = window.DAYZ_ITEMS || [];
const ORIGINAL_ITEM_NAMES = new Set(ORIGINAL_ITEMS.map(item => item.n));
const ITEMS = ORIGINAL_ITEMS.map(item => ({
  ...item,
  sa: Array.isArray(item.sa) ? item.sa.slice() : [],
  ca: Array.isArray(item.ca)
    ? item.ca.map(([type, children]) => [type, Array.isArray(children) ? children.slice() : []])
    : []
}));
const ITEM_BY_NAME = Object.create(null);
ITEMS.forEach(item => { ITEM_BY_NAME[item.n] = item; });

const SLOT_DEFAULT_CATEGORY = {
  Armband: 'armband', Back: 'bag', Body: 'top', Cargo: 'misc', Eyewear: 'clothing',
  Feet: 'footwear', Gloves: 'gloves', Hands: 'tool', Headgear: 'headwear', Hips: 'belt',
  Legs: 'pants', Mask: 'mask', shoulderL: 'weapon', shoulderR: 'weapon', Vest: 'vest'
};

function ensureCatalogItem(name, category = 'misc') {
  if (!name) return null;
  if (!ITEM_BY_NAME[name]) {
    const item = { n: name, c: category, sa: [], ca: [] };
    ITEMS.push(item);
    ITEM_BY_NAME[name] = item;
  }
  return ITEM_BY_NAME[name];
}

Object.entries(SLOT_ITEMS).forEach(([slotName, names]) => {
  names.forEach(name => {
    const item = ensureCatalogItem(name, SLOT_DEFAULT_CATEGORY[slotName] || 'misc');
    if ((slotName === 'shoulderL' || slotName === 'shoulderR') &&
        (!ORIGINAL_ITEM_NAMES.has(name) || item.c === 'weapon_part')) item.c = 'weapon';
  });
});

function normalizedNames(values) {
  return [...new Set((values || [])
    .flatMap(value => String(value || '').split('|'))
    .map(value => value.trim())
    .filter(Boolean))];
}

const KNOWN_COMPLEX_CHILDREN = new Map();
ITEMS.forEach(item => (item.ca || []).forEach(([type, children]) => {
  KNOWN_COMPLEX_CHILDREN.set(type, normalizedNames([
    ...(KNOWN_COMPLEX_CHILDREN.get(type) || []),
    ...(children || [])
  ]));
}));

Object.entries(window.DAYZ_WEAPON_COMPATIBILITY || {}).forEach(([itemName, compatibility]) => {
  const item = ensureCatalogItem(itemName, 'weapon');
  if (item.c === 'weapon_part') item.c = 'weapon';

  const complexByType = new Map();
  (item.ca || []).forEach(([type, children]) => {
    complexByType.set(type, normalizedNames(children));
  });
  (compatibility.simple || []).forEach(type => {
    if (KNOWN_COMPLEX_CHILDREN.has(type) && !complexByType.has(type)) {
      complexByType.set(type, KNOWN_COMPLEX_CHILDREN.get(type).slice());
    }
  });
  (compatibility.complex || []).forEach(([type, children]) => {
    complexByType.set(type, normalizedNames([...(complexByType.get(type) || []), ...(children || [])]));
  });

  const complexNames = new Set(complexByType.keys());
  item.sa = normalizedNames([...(item.sa || []), ...(compatibility.simple || [])])
    .filter(type => !complexNames.has(type))
    .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));
  item.ca = [...complexByType]
    .sort((left, right) => left[0].localeCompare(right[0], 'en', { sensitivity: 'base' }));

  item.sa.forEach(type => ensureCatalogItem(type));
  item.ca.forEach(([type, children]) => {
    ensureCatalogItem(type);
    children.forEach(child => ensureCatalogItem(child));
  });
});

ITEMS.sort((left, right) => left.n.localeCompare(right.n, 'en', { sensitivity: 'base' }));

function slotFilter(slotName, fallback) {
  const allowed = SLOT_ITEM_SETS[slotName];
  return allowed && allowed.size ? item => allowed.has(item.n) : fallback;
}

const SLOTS = [
  { key: 'shoulderL', label: 'Left shoulder', icon: 'ti-crosshair', hint: 'Weapon or tool carried on the left shoulder.',
    filter: slotFilter('shoulderL', i => i.c === 'weapon') },
  { key: 'shoulderR', label: 'Right shoulder', icon: 'ti-axe', hint: 'Weapon or tool carried on the right shoulder.',
    filter: slotFilter('shoulderR', i => i.c === 'weapon' || i.c === 'tool') },
  { key: 'Hands', label: 'Hands', icon: 'ti-hand-grab', hint: 'Item spawned directly in the character\'s hands.',
    filter: slotFilter('Hands', i => i.c === 'weapon' || i.c === 'pistol' || i.c === 'tool') },
  { key: 'Headgear', label: 'Headgear', icon: 'ti-shield', hint: 'Hats, caps and helmets.',
    filter: slotFilter('Headgear', i => i.c === 'headwear' || i.c === 'helmet') },
  { key: 'Mask', label: 'Mask', icon: 'ti-mask', hint: 'Face masks and respirators.',
    filter: slotFilter('Mask', i => i.c === 'mask') },
  { key: 'Eyewear', label: 'Eyewear', icon: 'ti-eyeglass', hint: 'Glasses, goggles and eye patches.',
    filter: slotFilter('Eyewear', i => /Glasses|EyePatch|Goggles/.test(i.n)) },
  { key: 'Gloves', label: 'Gloves', icon: 'ti-hand-stop', hint: 'Gloves.',
    filter: slotFilter('Gloves', i => i.c === 'gloves') },
  { key: 'Armband', label: 'Armband', icon: 'ti-tag', hint: 'Faction / clan armbands.',
    filter: slotFilter('Armband', i => i.c === 'armband') },
  { key: 'Body', label: 'Body', icon: 'ti-shirt', hint: 'Jackets, shirts, coats.',
    filter: slotFilter('Body', i => i.c === 'top') },
  { key: 'Vest', label: 'Vest', icon: 'ti-shield-check', hint: 'Vests, plate carriers and chest holsters.',
    filter: slotFilter('Vest', i => i.c === 'vest' || i.c === 'holster') },
  { key: 'Back', label: 'Back', icon: 'ti-backpack', hint: 'Backpacks.',
    filter: slotFilter('Back', i => i.c === 'bag') },
  { key: 'Hips', label: 'Hips', icon: 'ti-line-dashed', hint: 'Belts (knife sheaths and holsters attach to them).',
    filter: slotFilter('Hips', i => i.c === 'belt') },
  { key: 'Legs', label: 'Legs', icon: 'ti-hanger', hint: 'Pants.',
    filter: slotFilter('Legs', i => i.c === 'pants') },
  { key: 'Feet', label: 'Feet', icon: 'ti-shoe', hint: 'Boots and shoes.',
    filter: slotFilter('Feet', i => i.c === 'footwear') },
  { key: 'Cargo', label: 'Cargo', icon: 'ti-package', hint: 'Extra items distributed into the spawned clothing (discreteUnsortedItemSets). Add food, medical items, ammo…',
    filter: slotFilter('Cargo', () => true) }
];

const IMPORT_LIMITS = Object.freeze({
  fileBytes: 2 * 1024 * 1024,
  nameLength: 120,
  classLength: 160,
  slotSets: 64,
  entries: 2000,
  children: 1000,
  characters: 64
});
const CHARACTER_TYPES = new Set(Object.values(CHARACTERS).flat());

function defaultEntry(type) {
  return {
    type, spawnWeight: 1, quickBarSlot: -1,
    healthMin: 0.5, healthMax: 1, quantityMin: -1, quantityMax: -1,
    count: 1,
    simple: [],           // simple attachments / children (strings)
    complex: [],          // complex attachments: mags etc. [{type, children:[...] }]
    extra: []             // extra cargo items placed inside this item
  };
}

const state = {
  name: 'My Loadout',
  spawnWeight: 1,
  characterTypes: [],
  slots: {},              // slotKey -> [entry, ...]
  cargo: []               // entries for the unsorted set
};
SLOTS.forEach(s => { if (s.key !== 'Cargo') state.slots[s.key] = []; });

let activeSlot = 'shoulderL';
let configTarget = null;  // entry currently edited in the modal

// ---------------------------------------------------------------- helpers
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function importedArray(value, max = IMPORT_LIMITS.children) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}
function importedNumber(value, fallback, min, max, integer = false) {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  let number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (integer) number = Math.trunc(number);
  return Math.min(max, Math.max(min, number));
}
function importedText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().slice(0, maxLength);
  return text || fallback;
}
function importedClass(value) {
  const name = importedText(value, '', IMPORT_LIMITS.classLength);
  return /^[A-Za-z0-9_.:-]+$/.test(name) ? name : '';
}
function importedClasses(value, max = IMPORT_LIMITS.children, unique = false) {
  const result = [];
  const seen = new Set();
  importedArray(value, max).forEach(item => {
    const name = importedClass(item);
    if (name && (!unique || !seen.has(name))) {
      seen.add(name);
      result.push(name);
    }
  });
  return result;
}
function iconFor(name) {
  const it = Object.prototype.hasOwnProperty.call(ITEM_BY_NAME, name) ? ITEM_BY_NAME[name] : null;
  return CATEGORY_ICONS[(it && it.c) || 'misc'] || 'ti-box';
}
function prettyName(t) {
  if (!t) return 'Unknown';
  return t.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}
function slotDef(key) { return SLOTS.find(s => s.key === key); }
function entriesFor(key) { return key === 'Cargo' ? state.cargo : state.slots[key]; }

// ---------------------------------------------------------------- rendering
function renderTabs() {
  const ul = document.getElementById('slotTabs');
  ul.innerHTML = SLOTS.map(s => {
    const n = entriesFor(s.key).length;
    return `<li class="nav-item"><a class="nav-link ${s.key === activeSlot ? 'active' : ''}" href="#" data-slot="${s.key}">
      <i class="ti ${s.icon}"></i> ${s.label}${n ? ` <span class="badge bg-secondary">${n}</span>` : ''}</a></li>`;
  }).join('');
  ul.querySelectorAll('a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    activeSlot = a.dataset.slot;
    document.getElementById('item-search').value = '';
    renderAll();
  }));
}

function renderSelected() {
  const box = document.getElementById('selected-items');
  const entries = entriesFor(activeSlot);
  if (!entries.length) {
    box.innerHTML = '<span class="text-muted">Nothing selected yet</span>';
    return;
  }
  box.innerHTML = entries.map((en, idx) => {
    const extras = [];
    if (en.simple.length) extras.push(en.simple.map(prettyName).join(', '));
    if (en.complex.length) extras.push(en.complex.map(c => prettyName(c.type)).join(', '));
    if (en.extra.length) extras.push('+' + en.extra.length + ' cargo');
    const sub = extras.length ? `<small>${esc(extras.join(' · '))}</small>` : '';
    return `<div class="selected-item-badge">
      <span class="item-label"><i class="ti ${iconFor(en.type)}"></i>${esc(en.type)}
        ${activeSlot === 'Cargo' && en.count > 1 ? `<span class="text-muted small"> ×${esc(en.count)}</span>` : ''}
        ${activeSlot !== 'Cargo' && entries.length > 1 ? `<span class="text-muted small"> (w:${esc(en.spawnWeight)})</span>` : ''}${sub}</span>
      <span class="item-actions">
        <button class="btn btn-sm btn-outline-secondary action-btn configure-btn" data-idx="${idx}" title="Configure"><i class="ti ti-adjustments"></i></button>
        <button class="btn btn-sm btn-outline-secondary action-btn remove-btn" data-idx="${idx}" title="Remove"><i class="ti ti-x"></i></button>
      </span>
    </div>`;
  }).join('');
  box.querySelectorAll('.configure-btn').forEach(b => b.addEventListener('click', () => openConfig(entries[+b.dataset.idx])));
  box.querySelectorAll('.remove-btn').forEach(b => b.addEventListener('click', () => {
    entries.splice(+b.dataset.idx, 1);
    renderAll();
  }));
}

function renderGrid() {
  const def = slotDef(activeSlot);
  document.getElementById('slot-title').innerHTML = `<i class="ti ${def.icon}"></i> ${def.label}`;
  document.getElementById('slot-hint').textContent = def.hint;
  const q = document.getElementById('item-search').value.trim().toLowerCase();
  const entries = entriesFor(activeSlot);
  const selected = new Set(entries.map(e => e.type));
  let list = ITEMS.filter(def.filter);
  if (q) list = list.filter(i => i.n.toLowerCase().includes(q) || i.c.toLowerCase().includes(q));
  const total = list.length;
  list = list.slice(0, 120);
  const grid = document.getElementById('item-grid');
  grid.innerHTML = list.map(i => `
    <div class="col">
      <div class="card item-card ${selected.has(i.n) ? 'selected' : ''}" data-item="${esc(i.n)}">
        <div class="item-img"><i class="ti ${CATEGORY_ICONS[i.c] || 'ti-box'}"></i></div>
        <div class="card-body"><div class="card-title mb-0">${esc(i.n)}</div>
          <div class="small text-muted">${esc(i.c)}</div></div>
      </div>
    </div>`).join('') +
    (total > 120 ? `<div class="col-12 text-muted small p-2">Showing 120 of ${total} items – refine your search.</div>` : '') +
    (!total ? '<div class="col-12 text-muted small p-2">No items match.</div>' : '');
  grid.querySelectorAll('.item-card').forEach(card => card.addEventListener('click', () => toggleItem(card.dataset.item)));
}

function toggleItem(type) {
  const entries = entriesFor(activeSlot);
  const idx = entries.findIndex(e => e.type === type);
  if (idx >= 0) entries.splice(idx, 1);
  else {
    const en = defaultEntry(type);
    entries.push(en);
    const it = ITEM_BY_NAME[type];
    if (it && ((it.sa && it.sa.length) || (it.ca && it.ca.length))) openConfig(en);
  }
  renderAll();
}

function renderSummary() {
  document.getElementById('preview-name').textContent = state.name || 'Loadout';
  const rows = SLOTS.map(s => {
    const entries = entriesFor(s.key);
    const val = entries.length ? entries.map(e => e.type).join(', ') : '—';
    return `<div class="slot-line"><span class="slot-name">${s.label}</span>
      <span class="slot-val ${entries.length ? '' : 'empty'}" title="${esc(val)}">${esc(val)}</span></div>`;
  }).join('');
  document.getElementById('slot-summary').innerHTML = rows;
  const n = SLOTS.reduce((sum, slot) => sum + entriesFor(slot.key)
    .reduce((slotSum, entry) => slotSum + (slot.key === 'Cargo' ? Math.max(1, entry.count || 1) : 1), 0), 0);
  document.getElementById('item-count').textContent = n + ' item' + (n === 1 ? '' : 's');
}

function renderJson() {
  document.getElementById('json-output').textContent = JSON.stringify(buildJson(), null, 2);
}

function renderAll() {
  renderTabs();
  renderSelected();
  renderGrid();
  renderSummary();
  renderJson();
}

// ---------------------------------------------------------------- config modal
function openConfig(entry) {
  configTarget = entry;
  const it = ITEM_BY_NAME[entry.type] || { sa: [], ca: [] };
  const isCargoEntry = state.cargo.includes(entry);
  document.getElementById('config-title').textContent = entry.type;
  const body = document.getElementById('config-body');

  const saHtml = (it.sa || []).map(a => `
    <div class="form-check">
      <input class="form-check-input cfg-simple" type="checkbox" value="${esc(a)}" id="sa-${esc(a)}" ${entry.simple.includes(a) ? 'checked' : ''}>
      <label class="form-check-label" for="sa-${esc(a)}"><i class="ti ${iconFor(a)}"></i> ${esc(a)}</label>
    </div>`).join('');

  const caHtml = (it.ca || []).map(([parentType, rawChildren]) => {
    const children = normalizedNames(rawChildren);
    const selected = entry.complex.find(complex => complex.type === parentType);
    const childHtml = children.length ? `
      <div class="complex-child-options ms-4 mb-2" data-parent="${esc(parentType)}">
        <div class="small text-muted">Contents (optional):</div>
        ${children.map(child => `<div class="form-check form-check-inline">
          <input class="form-check-input cfg-complex-child" type="checkbox"
            data-parent="${esc(parentType)}" value="${esc(child)}"
            id="ca-${esc(parentType)}-${esc(child)}"
            ${selected && selected.children.includes(child) ? 'checked' : ''}
            ${selected ? '' : 'disabled'}>
          <label class="form-check-label" for="ca-${esc(parentType)}-${esc(child)}">${esc(child)}</label>
        </div>`).join('')}
      </div>` : '';
    return `<div class="form-check">
      <input class="form-check-input cfg-complex" type="checkbox" value="${esc(parentType)}"
        id="ca-${esc(parentType)}" ${selected ? 'checked' : ''}>
      <label class="form-check-label" for="ca-${esc(parentType)}"><i class="ti ${iconFor(parentType)}"></i> ${esc(parentType)}</label>
    </div>${childHtml}`;
  }).join('');

  body.innerHTML = `
    <div class="row g-3 mb-3">
      ${isCargoEntry ? `<div class="col-6 col-md-3"><label class="form-label small text-muted">Number of copies</label>
        <input type="number" class="form-control form-control-sm" id="cfg-count" min="1" step="1" value="${esc(Math.max(1, entry.count || 1))}"></div>`
        : `<div class="col-6 col-md-3"><label class="form-label small text-muted">Spawn weight</label>
        <input type="number" class="form-control form-control-sm" id="cfg-weight" min="1" step="1" value="${esc(entry.spawnWeight)}"></div>`}
      <div class="col-6 col-md-3"><label class="form-label small text-muted">Quickbar slot</label>
        <select class="form-select form-select-sm" id="cfg-quickbar">
          <option value="-1">none</option>
          ${[0,1,2,3,4,5,6,7,8,9].map(i => `<option value="${i}" ${entry.quickBarSlot === i ? 'selected' : ''}>${i + 1}</option>`).join('')}
        </select></div>
      <div class="col-6 col-md-3"><label class="form-label small text-muted">Health min (0–1)</label>
        <input type="number" class="form-control form-control-sm" id="cfg-hmin" min="0" max="1" step="0.05" value="${esc(entry.healthMin)}"></div>
      <div class="col-6 col-md-3"><label class="form-label small text-muted">Health max (0–1)</label>
        <input type="number" class="form-control form-control-sm" id="cfg-hmax" min="0" max="1" step="0.05" value="${esc(entry.healthMax)}"></div>
      <div class="col-6 col-md-3"><label class="form-label small text-muted">Quantity min</label>
        <input type="number" class="form-control form-control-sm" id="cfg-qmin" min="-1" max="1" step="0.05" value="${esc(entry.quantityMin)}"></div>
      <div class="col-6 col-md-3"><label class="form-label small text-muted">Quantity max</label>
        <input type="number" class="form-control form-control-sm" id="cfg-qmax" min="-1" max="1" step="0.05" value="${esc(entry.quantityMax)}"></div>
      <div class="col-12"><div class="small text-muted">Quantity −1 = default/full (ammo, liquids, stacks).</div></div>
    </div>
    ${saHtml ? `<div class="slot-section"><div class="slot-title">Attachments</div>${saHtml}</div>` : ''}
    ${caHtml ? `<div class="slot-section"><div class="slot-title">Magazines &amp; complex attachments</div>${caHtml}
      <div class="small text-muted complex-children">Select the nested ammo, battery or item that should be spawned inside the attachment.</div></div>` : ''}
    <div class="slot-section">
      <div class="slot-title">Items inside (cargo)</div>
      <div class="selected-attachments" id="cfg-extra-list"></div>
      <div class="input-group input-group-sm">
        <span class="input-group-text bg-dark text-light border-secondary"><i class="ti ti-search"></i></span>
        <input class="form-control" id="cfg-extra-search" placeholder="Search any item to put inside...">
      </div>
      <div id="cfg-extra-results" class="mt-2"></div>
    </div>`;

  body.querySelectorAll('.cfg-simple').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) { if (!entry.simple.includes(cb.value)) entry.simple.push(cb.value); }
    else entry.simple = entry.simple.filter(x => x !== cb.value);
    renderAll();
  }));
  body.querySelectorAll('.cfg-complex').forEach(cb => cb.addEventListener('change', () => {
    const def = (it.ca || []).find(([p]) => p === cb.value);
    const candidates = def ? normalizedNames(def[1]) : [];
    if (cb.checked) {
      if (!entry.complex.some(c => c.type === cb.value)) {
        entry.complex.push({ type: cb.value, children: candidates.length === 1 ? candidates.slice() : [] });
      }
    }
    else entry.complex = entry.complex.filter(c => c.type !== cb.value);
    body.querySelectorAll('.cfg-complex-child').forEach(child => {
      if (child.dataset.parent !== cb.value) return;
      child.disabled = !cb.checked;
      child.checked = cb.checked && entry.complex.some(complex =>
        complex.type === cb.value && complex.children.includes(child.value));
    });
    renderAll();
  }));
  body.querySelectorAll('.cfg-complex-child').forEach(cb => cb.addEventListener('change', () => {
    const complex = entry.complex.find(candidate => candidate.type === cb.dataset.parent);
    if (!complex) return;
    if (cb.checked && !complex.children.includes(cb.value)) complex.children.push(cb.value);
    else if (!cb.checked) complex.children = complex.children.filter(child => child !== cb.value);
    renderAll();
  }));
  ['cfg-count','cfg-weight','cfg-quickbar','cfg-hmin','cfg-hmax','cfg-qmin','cfg-qmax'].forEach(id => {
    const input = body.querySelector('#' + id);
    if (!input) return;
    input.addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (id === 'cfg-count') entry.count = Math.max(1, Math.round(isNaN(v) ? 1 : v));
      if (id === 'cfg-weight') entry.spawnWeight = Math.max(1, Math.round(isNaN(v) ? 1 : v));
      if (id === 'cfg-quickbar') entry.quickBarSlot = parseInt(e.target.value, 10);
      if (id === 'cfg-hmin') entry.healthMin = isNaN(v) ? 0.5 : v;
      if (id === 'cfg-hmax') entry.healthMax = isNaN(v) ? 1 : v;
      if (id === 'cfg-qmin') entry.quantityMin = isNaN(v) ? -1 : v;
      if (id === 'cfg-qmax') entry.quantityMax = isNaN(v) ? -1 : v;
      renderAll();
    });
  });

  const renderExtra = () => {
    const list = body.querySelector('#cfg-extra-list');
    list.innerHTML = entry.extra.length
      ? entry.extra.map((t, i) => `<span class="loadout-badge">${esc(t)}
          <a href="#" class="text-danger text-decoration-none ms-1" data-i="${i}">✕</a></span>`).join(' ')
      : '<span class="text-muted small">No extra items inside.</span>';
    list.querySelectorAll('a').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      entry.extra.splice(+a.dataset.i, 1);
      renderExtra(); renderAll();
    }));
  };
  renderExtra();

  const search = body.querySelector('#cfg-extra-search');
  const results = body.querySelector('#cfg-extra-results');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (q.length < 2) { results.innerHTML = ''; return; }
    const found = ITEMS.filter(i => i.n.toLowerCase().includes(q)).slice(0, 12);
    results.innerHTML = found.map(i => `<button type="button" class="btn btn-sm btn-outline-secondary text-light me-1 mb-1" data-add="${esc(i.n)}">
      <i class="ti ${CATEGORY_ICONS[i.c] || 'ti-box'}"></i> ${esc(i.n)}</button>`).join('');
    results.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      entry.extra.push(b.dataset.add);
      renderExtra(); renderAll();
    }));
  });

  bootstrap.Modal.getOrCreateInstance(document.getElementById('configModal')).show();
}

// ---------------------------------------------------------------- JSON build / load
function attributesOf(en) {
  return { healthMin: en.healthMin, healthMax: en.healthMax, quantityMin: en.quantityMin, quantityMax: en.quantityMax };
}

function complexChildSet(complex) {
  return {
    itemType: complex.type,
    attributes: { healthMin: 0.5, healthMax: 1, quantityMin: -1, quantityMax: -1 },
    quickBarSlot: -1,
    simpleChildrenUseDefaultAttributes: false,
    simpleChildrenTypes: normalizedNames(complex.children)
  };
}

function discreteItemSet(en) {
  return {
    itemType: en.type,
    spawnWeight: en.spawnWeight,
    attributes: attributesOf(en),
    quickBarSlot: en.quickBarSlot,
    simpleChildrenUseDefaultAttributes: false,
    simpleChildrenTypes: en.simple.concat(en.extra),
    complexChildrenTypes: en.complex.map(complexChildSet)
  };
}

function usesDefaultCargoAttributes(en) {
  return en.healthMin === 0.5 && en.healthMax === 1 &&
    en.quantityMin === -1 && en.quantityMax === -1 && en.quickBarSlot === -1;
}

function cargoComplexSet(en) {
  return {
    itemType: en.type,
    attributes: attributesOf(en),
    quickBarSlot: en.quickBarSlot,
    simpleChildrenUseDefaultAttributes: false,
    // Complex children cannot be nested again in the documented DayZ schema.
    // Add selected complex attachments themselves as simple children here.
    simpleChildrenTypes: [
      ...normalizedNames([...en.simple, ...en.complex.map(complex => complex.type)]),
      ...en.extra
    ]
  };
}

function buildJson() {
  const attachmentSlotItemSets = SLOTS
    .filter(s => s.key !== 'Cargo' && state.slots[s.key].length)
    .map(s => ({ slotName: s.key, discreteItemSets: state.slots[s.key].map(discreteItemSet) }));

  const discreteUnsortedItemSets = [];
  if (state.cargo.length) {
    const simpleChildrenTypes = [];
    const complexChildrenTypes = [];
    state.cargo.forEach(en => {
      const count = Math.max(1, Math.round(en.count || 1));
      const needsComplex = en.simple.length || en.complex.length || en.extra.length || !usesDefaultCargoAttributes(en);
      for (let index = 0; index < count; index += 1) {
        if (needsComplex) complexChildrenTypes.push(cargoComplexSet(en));
        else simpleChildrenTypes.push(en.type);
      }
    });
    discreteUnsortedItemSets.push({
      name: 'Extra items',
      spawnWeight: 1,
      attributes: { healthMin: 0.5, healthMax: 1, quantityMin: -1, quantityMax: -1 },
      simpleChildrenUseDefaultAttributes: false,
      simpleChildrenTypes,
      complexChildrenTypes
    });
  }

  return {
    name: state.name || 'Loadout',
    spawnWeight: state.spawnWeight,
    characterTypes: state.characterTypes,
    attachmentSlotItemSets,
    discreteUnsortedItemSets
  };
}

function entryFromSet(set) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return null;
  const type = importedClass(set.itemType) || importedClass(set.type);
  if (!type) return null;
  const en = defaultEntry(type);
  en.spawnWeight = importedNumber(set.spawnWeight, 1, 1, 1000000, true);
  en.quickBarSlot = importedNumber(set.quickBarSlot, -1, -1, 9, true);
  const a = set.attributes && typeof set.attributes === 'object' && !Array.isArray(set.attributes)
    ? set.attributes : {};
  en.healthMin = importedNumber(a.healthMin, 0.5, 0, 1);
  en.healthMax = importedNumber(a.healthMax, 1, 0, 1);
  en.quantityMin = importedNumber(a.quantityMin, -1, -1, 1);
  en.quantityMax = importedNumber(a.quantityMax, -1, -1, 1);
  if (en.healthMin > en.healthMax) [en.healthMin, en.healthMax] = [en.healthMax, en.healthMin];
  if (en.quantityMin > en.quantityMax) [en.quantityMin, en.quantityMax] = [en.quantityMax, en.quantityMin];
  const it = Object.prototype.hasOwnProperty.call(ITEM_BY_NAME, en.type) ? ITEM_BY_NAME[en.type] : null;
  const known = new Set(it ? [
    ...(it.sa || []),
    ...(it.ca || []).map(([childType]) => childType)
  ] : []);
  importedClasses(set.simpleChildrenTypes).forEach(t => (known.has(t) ? en.simple : en.extra).push(t));
  const complex = Array.isArray(set.complexChildrenTypes)
    ? set.complexChildrenTypes : set.complexChildrenSets;
  importedArray(complex).forEach(c => {
    if (typeof c === 'string') {
      const childType = importedClass(c);
      if (childType) en.complex.push({ type: childType, children: [] });
      return;
    }
    if (!c || typeof c !== 'object' || Array.isArray(c)) return;
    const childType = importedClass(c.itemType) || importedClass(c.type);
    if (childType) en.complex.push({ type: childType, children: importedClasses(c.simpleChildrenTypes) });
  });
  return en;
}

const SLOT_ALIASES = {
  Shoulder: 'shoulderL', Melee: 'shoulderR', Bow: 'shoulderR',
  shoulderL: 'shoulderL', shoulderR: 'shoulderR'
};

function addSimpleCargo(type, target = state.cargo) {
  const safeType = importedClass(type);
  if (!safeType) return false;
  const existing = target.find(entry => entry.type === safeType &&
    !entry.simple.length && !entry.complex.length && !entry.extra.length && usesDefaultCargoAttributes(entry));
  if (existing) existing.count = Math.max(1, existing.count || 1) + 1;
  else target.push(defaultEntry(safeType));
  return true;
}

function loadFromJson(data) {
  try {
    if (typeof data === 'string') {
      if (data.length > IMPORT_LIMITS.fileBytes) throw new Error('Loadout data is too large');
      data = JSON.parse(data);
    }
    if (Array.isArray(data)) data = data[0];
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid data');

    const nextSlots = {};
    SLOTS.forEach(s => { if (s.key !== 'Cargo') nextSlots[s.key] = []; });
    const nextCargo = [];
    let importedEntries = 0;
    const append = (target, set) => {
      if (importedEntries >= IMPORT_LIMITS.entries) return;
      const entry = entryFromSet(set);
      if (!entry) return;
      target.push(entry);
      importedEntries += 1;
    };

    importedArray(data.attachmentSlotItemSets, IMPORT_LIMITS.slotSets).forEach(slotSet => {
      if (!slotSet || typeof slotSet !== 'object' || Array.isArray(slotSet)) return;
      const rawKey = importedClass(slotSet.slotName);
      const key = SLOT_ALIASES[rawKey] || rawKey;
      const target = Object.prototype.hasOwnProperty.call(nextSlots, key) ? nextSlots[key] : nextCargo;
      if (target === nextCargo) {
        console.warn('Unknown slot in imported loadout, putting items into cargo:', key);
      }
      importedArray(slotSet.discreteItemSets, IMPORT_LIMITS.entries)
        .forEach(set => append(target, set));
    });
    importedArray(data.discreteUnsortedItemSets, IMPORT_LIMITS.slotSets).forEach(us => {
      if (!us || typeof us !== 'object' || Array.isArray(us)) return;
      importedClasses(us.simpleChildrenTypes).forEach(type => {
        if (importedEntries >= IMPORT_LIMITS.entries) return;
        if (addSimpleCargo(type, nextCargo)) importedEntries += 1;
      });
      const complex = Array.isArray(us.complexChildrenTypes)
        ? us.complexChildrenTypes : us.complexChildrenSets;
      importedArray(complex).forEach(c => {
        if (typeof c === 'string') {
          const type = importedClass(c);
          if (type && importedEntries < IMPORT_LIMITS.entries && addSimpleCargo(type, nextCargo)) {
            importedEntries += 1;
          }
          return;
        }
        append(nextCargo, c);
      });
    });

    state.name = importedText(data.name, 'Imported Loadout', IMPORT_LIMITS.nameLength);
    state.spawnWeight = importedNumber(data.spawnWeight, 1, 1, 1000000, true);
    state.characterTypes = importedClasses(data.characterTypes, IMPORT_LIMITS.characters, true)
      .filter(type => CHARACTER_TYPES.has(type));
    state.slots = nextSlots;
    state.cargo = nextCargo;
    const nameInput = document.getElementById('loadout-name');
    const weightInput = document.getElementById('loadout-weight');
    if (nameInput) nameInput.value = state.name;
    if (weightInput) weightInput.value = state.spawnWeight;
    if (document.getElementById('characterList')) syncCharacterChecks();
    if (document.getElementById('slotTabs')) renderAll();
    return true;
  } catch (e) {
    console.error('Failed to load loadout:', e);
    UIManager.showNotification('Could not read this loadout file', 'error');
    return false;
  }
}

// ---------------------------------------------------------------- characters
function renderCharacters() {
  const box = document.getElementById('characterList');
  box.innerHTML = Object.entries(CHARACTERS).map(([group, names]) =>
    `<div class="col-12"><b class="small text-primary">${group}</b></div>` +
    names.map(n => `<div class="col"><div class="form-check">
      <input class="form-check-input char-check" type="checkbox" value="${n}" id="ch-${n}">
      <label class="form-check-label" for="ch-${n}">${n.replace(/^Survivor[MF]_/, '')}</label>
    </div></div>`).join('')
  ).join('');
  box.querySelectorAll('.char-check').forEach(cb => cb.addEventListener('change', () => {
    state.characterTypes = [...box.querySelectorAll('.char-check:checked')].map(c => c.value);
    document.getElementById('charCount').textContent = state.characterTypes.length ? state.characterTypes.length : 'all';
    renderJson();
  }));
}
function syncCharacterChecks() {
  document.querySelectorAll('.char-check').forEach(cb => { cb.checked = state.characterTypes.includes(cb.value); });
  document.getElementById('charCount').textContent = state.characterTypes.length ? state.characterTypes.length : 'all';
}

function validateState() {
  const errors = [];
  if (!String(state.name || '').trim()) errors.push('Enter a loadout name.');
  if (!Number.isInteger(state.spawnWeight) || state.spawnWeight < 1) {
    errors.push('The loadout spawn weight must be a whole number of at least 1.');
  }

  const allEntries = [];
  SLOTS.forEach(slot => entriesFor(slot.key).forEach(entry => allEntries.push([slot, entry])));
  if (!allEntries.length) errors.push('Select at least one equipment or cargo item.');

  allEntries.forEach(([slot, entry]) => {
    const label = `${slot.label}: ${entry.type || 'unnamed item'}`;
    if (!entry.type) errors.push(`${label} has no item type.`);
    if (slot.key !== 'Cargo' && (!Number.isInteger(entry.spawnWeight) || entry.spawnWeight < 1)) {
      errors.push(`${label} needs a whole-number spawn weight of at least 1.`);
    }
    if (slot.key === 'Cargo' && (!Number.isInteger(entry.count) || entry.count < 1)) {
      errors.push(`${label} needs at least one copy.`);
    }
    if (!Number.isInteger(entry.quickBarSlot) || entry.quickBarSlot < -1 || entry.quickBarSlot > 9) {
      errors.push(`${label} has an invalid quickbar slot.`);
    }
    if (![entry.healthMin, entry.healthMax].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      errors.push(`${label} health values must be between 0 and 1.`);
    } else if (entry.healthMin > entry.healthMax) {
      errors.push(`${label} health minimum cannot exceed its maximum.`);
    }
    if (![entry.quantityMin, entry.quantityMax].every(value => Number.isFinite(value) && value >= -1 && value <= 1)) {
      errors.push(`${label} quantity values must be between -1 and 1.`);
    } else if (entry.quantityMin > entry.quantityMax) {
      errors.push(`${label} quantity minimum cannot exceed its maximum.`);
    }
  });
  return errors;
}

function validateAndNotify() {
  const errors = validateState();
  if (!errors.length) return true;
  UIManager.showNotification(errors.slice(0, 3).join('\n'), 'error');
  return false;
}

// ---------------------------------------------------------------- actions
function downloadJson() {
  if (!validateAndNotify()) return;
  const blob = new Blob([JSON.stringify(buildJson(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  a.href = objectUrl;
  const safeName = (state.name || 'loadout').replace(/[^a-z0-9_-]/gi, '_').replace(/^_+|_+$/g, '') || 'loadout';
  a.download = safeName.toLowerCase() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  UIManager.showNotification('Loadout downloaded', 'success');
}

async function copyJson() {
  if (!validateAndNotify()) return;
  const text = JSON.stringify(buildJson(), null, 2);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      if (!document.execCommand('copy')) throw new Error('Copy command failed');
      textarea.remove();
    }
    UIManager.showNotification('JSON copied to clipboard', 'success');
  } catch (error) {
    console.error('Copy failed:', error);
    UIManager.showNotification('Copy failed', 'error');
  }
}

function saveToBrowser() {
  if (!validateAndNotify()) return;
  try {
    const list = JSON.parse(localStorage.getItem('dayzLoadouts') || '[]');
    if (!Array.isArray(list)) throw new Error('Saved loadout data is not an array');
    const data = buildJson();
    const existing = list.findIndex(l => l.name === data.name);
    const rec = {
      id: existing >= 0 ? list[existing].id : 'lo_' + Date.now(),
      name: data.name, username: 'You',
      created_at: existing >= 0 ? list[existing].created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
      downloads: existing >= 0 ? (list[existing].downloads || 0) : 0,
      data
    };
    if (existing >= 0) list[existing] = rec; else list.push(rec);
    localStorage.setItem('dayzLoadouts', JSON.stringify(list));
    UIManager.showNotification(existing >= 0 ? 'Loadout updated in browser storage' : 'Loadout saved – see Browse Loadouts', 'success');
  } catch (error) {
    console.error('Could not save loadout:', error);
    UIManager.showNotification('Could not save this loadout in browser storage', 'error');
  }
}

function resetAll() {
  Swal.fire({
    title: 'Reset loadout?', text: 'All selected items will be removed.', icon: 'warning',
    showCancelButton: true, confirmButtonText: 'Reset', background: '#2a2a2a', color: '#f0f0f0'
  }).then(r => {
    if (!r.isConfirmed) return;
    state.name = 'My Loadout'; state.spawnWeight = 1; state.characterTypes = [];
    SLOTS.forEach(s => { if (s.key !== 'Cargo') state.slots[s.key] = []; });
    state.cargo = [];
    document.getElementById('loadout-name').value = state.name;
    document.getElementById('loadout-weight').value = 1;
    syncCharacterChecks();
    renderAll();
  });
}

window.LoadoutGenerator = {
  buildJson,
  characters: CHARACTERS,
  defaultEntry,
  items: ITEMS,
  loadFromJson,
  slots: SLOTS,
  state,
  validateState
};

// ---------------------------------------------------------------- init
document.addEventListener('DOMContentLoaded', () => {
  renderCharacters();
  renderAll();

  const badge = document.getElementById('gameVersionBadge');
  if (badge) {
    const version = window.DAYZ_SLOT_DATABASE_VERSION ? `DayZ ${window.DAYZ_SLOT_DATABASE_VERSION} · ` : '';
    badge.innerHTML = `<i class="ti ti-versions me-1"></i>${version}${ITEMS.length} items`;
  }

  document.getElementById('item-search').addEventListener('input', renderGrid);
  document.getElementById('loadout-name').addEventListener('input', e => { state.name = e.target.value; renderSummary(); renderJson(); });
  document.getElementById('loadout-weight').addEventListener('change', e => {
    state.spawnWeight = Math.max(1, Math.round(Number(e.target.value) || 1));
    e.target.value = state.spawnWeight;
    renderJson();
  });
  document.getElementById('btn-download').addEventListener('click', downloadJson);
  document.getElementById('btn-copy').addEventListener('click', copyJson);
  document.getElementById('btn-save').addEventListener('click', saveToBrowser);
  document.getElementById('btn-reset').addEventListener('click', resetAll);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > IMPORT_LIMITS.fileBytes) {
      UIManager.showNotification('Loadout file is too large (maximum 2 MB)', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (loadFromJson(reader.result)) UIManager.showNotification('Loadout imported', 'success'); };
    reader.readAsText(f);
    e.target.value = '';
  });

  // Loadout handed over from the browse page
  if (new URLSearchParams(location.search).get('load') === 'true') {
    const pending = localStorage.getItem('pendingLoadout');
    if (pending) {
      localStorage.removeItem('pendingLoadout');
      if (loadFromJson(pending)) UIManager.showNotification('Loadout loaded into the generator', 'success');
    }
  }
});
