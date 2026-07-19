#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = {
  alert() {},
  clearTimeout,
  console,
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; }
  },
  navigator: {},
  setTimeout
};
context.window = context;
context.globalThis = context;
vm.createContext(context);

for (const file of ['loadout/data.js', 'loadout/slot-data.js', 'loadout/generator.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const api = context.LoadoutGenerator;
assert.ok(api, 'generator test API was not exported');

function reset() {
  api.state.name = 'Schema test';
  api.state.spawnWeight = 1;
  api.state.characterTypes = [];
  for (const slot of api.slots) {
    if (slot.key !== 'Cargo') api.state.slots[slot.key] = [];
  }
  api.state.cargo = [];
}

const slotKeys = api.slots.map(slot => slot.key);
assert.ok(slotKeys.includes('shoulderL'), 'canonical left shoulder slot is missing');
assert.ok(slotKeys.includes('shoulderR'), 'canonical right shoulder slot is missing');
assert.ok(slotKeys.includes('Hands'), 'hands slot is missing');
assert.ok(api.items.some(item => item.n === 'FAL' && item.c === 'weapon'), 'FAL is not classified as a weapon');
assert.ok(api.items.some(item => item.n === 'SVD' && item.c === 'weapon'), 'SVD is not classified as a weapon');
const testbed = api.items.find(item => item.n === 'AKM_TESTBED');
assert.ok(testbed && testbed.ca.some(([type, children]) =>
  type === 'Mag_AKM_30Rnd' && children.includes('Ammo_762x39')),
  'new weapon variants should inherit known magazine contents');
assert.ok(api.characters.Male.includes('SurvivorM_Peter'));
assert.ok(api.characters.Male.includes('SurvivorM_Rolf'));
assert.ok(!api.characters.Male.includes('SurvivorM_Petr'));

reset();
const rifle = api.defaultEntry('M4A1');
rifle.simple.push('M4_Suppressor');
rifle.complex.push({ type: 'Mag_STANAG_30Rnd', children: ['Ammo_556x45'] });
api.state.slots.shoulderL.push(rifle);
const riflePreset = api.buildJson();
assert.equal(riflePreset.version, undefined, 'unsupported top-level version field was emitted');
assert.equal(riflePreset.attachmentSlotItemSets[0].slotName, 'shoulderL');
const rifleSet = riflePreset.attachmentSlotItemSets[0].discreteItemSets[0];
assert.ok(Array.isArray(rifleSet.complexChildrenTypes));
assert.equal(rifleSet.complexChildrenSets, undefined);
assert.equal(rifleSet.complexChildrenTypes[0].spawnWeight, undefined);
assert.equal(rifleSet.complexChildrenTypes[0].simpleChildrenTypes.join(','), 'Ammo_556x45');
assert.equal(api.validateState().length, 0);

reset();
const rag = api.defaultEntry('Rag');
rag.count = 3;
api.state.cargo.push(rag);
const container = api.defaultEntry('FirstAidKit');
container.extra.push('BandageDressing', 'BandageDressing');
api.state.cargo.push(container);
const cargoSet = api.buildJson().discreteUnsortedItemSets[0];
assert.equal(cargoSet.simpleChildrenTypes.filter(type => type === 'Rag').length, 3);
assert.equal(cargoSet.complexChildrenTypes.length, 1);
assert.equal(
  cargoSet.complexChildrenTypes[0].simpleChildrenTypes.filter(type => type === 'BandageDressing').length,
  2,
  'duplicate contained cargo must retain its requested count'
);

reset();
assert.equal(api.loadFromJson({
  name: 'Legacy preset',
  spawnWeight: 0,
  attachmentSlotItemSets: [{
    slotName: 'Shoulder',
    discreteItemSets: [{
      itemType: 'FAL', spawnWeight: 1,
      attributes: { healthMin: 0.5, healthMax: 1, quantityMin: -1, quantityMax: -1 },
      complexChildrenSets: [{ itemType: 'Mag_FAL_20Rnd', simpleChildrenTypes: ['Ammo_308Win'] }]
    }]
  }],
  discreteUnsortedItemSets: []
}), true);
assert.equal(api.state.spawnWeight, 1, 'legacy invalid weight should be normalized');
assert.equal(api.state.slots.shoulderL[0].type, 'FAL');
assert.equal(api.state.slots.shoulderL[0].complex[0].type, 'Mag_FAL_20Rnd');

reset();
assert.ok(api.validateState().some(error => error.includes('at least one')));
api.state.spawnWeight = 0;
assert.ok(api.validateState().some(error => error.includes('spawn weight')));

console.log('Loadout generator tests passed.');
