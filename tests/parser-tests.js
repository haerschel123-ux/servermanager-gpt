"use strict";

(async () => {
  const testApi = DirectMode._test;
  const rows = [];
  for (let i = 0; i < 5001; i += 1) {
    rows.push(`    <!-- Item ${i} -->\r\n    <type name="Item_${i}">\r\n` +
      `        <nominal>${i}</nominal>\r\n        <min>1</min>\r\n` +
      `        <lifetime>3600</lifetime>\r\n        <restock>0</restock>\r\n` +
      `        <quantmin>-1</quantmin>\r\n        <quantmax>-1</quantmax>\r\n` +
      `        <category name="tools"/>\r\n    </type>`);
  }
  const original = `<?xml version="1.0" encoding="UTF-8"?>\r\n<types>\r\n` +
    rows.join("\r\n") + "\r\n</types>\r\n";
  const result = testApi.updateTypes(original, { Item_2500: { nominal: 9999, min: 3 } });
  const expected = original
    .replace("<nominal>2500</nominal>", "<nominal>9999</nominal>")
    .replace(/(<type name="Item_2500">[\s\S]*?)<min>1<\/min>/, "$1<min>3</min>");

  const tricky = `<?xml version="1.0"?>\r\n<types>\r\n` +
    `<!-- <type name="Active"><nominal>111</nominal></type> -->\r\n` +
    `<?audit fake="<type name='Active'><nominal>222</nominal></type>"?>\r\n` +
    `<type name="Active">\r\n` +
    `    <!-- <nominal>333</nominal> -->\r\n` +
    `    <nominal><![CDATA[  7  ]]></nominal>\r\n` +
    `    <min><?old value?><![CDATA[-1]]></min>\r\n` +
    `</type>\r\n` +
    `<![CDATA[<type name="Ghost"><nominal>444</nominal></type>]]>\r\n` +
    `</types>\r\n`;
  const trickyResult = testApi.updateTypes(tricky, {
    Active: { nominal: 9, min: 3 },
    Ghost: { nominal: 8 },
  });
  const trickyExpected = tricky
    .replace("<![CDATA[  7  ]]>", "<![CDATA[  9  ]]>")
    .replace("<![CDATA[-1]]>", "<![CDATA[3]]>");

  const missingSource = `<types><type name="OnlyNominal">` +
    `<wrapper><min>77</min></wrapper><nominal>1</nominal></type></types>`;
  const missingResult = testApi.updateTypes(missingSource, {
    OnlyNominal: { nominal: 4, min: 2 },
  });
  let duplicateRejected = false;
  try {
    testApi.updateTypes(`<types><type name="Twin"><nominal>1</nominal></type>` +
      `<type name="Twin"><nominal>2</nominal></type></types>`,
    { Twin: { nominal: 3 } });
  } catch (error) {
    duplicateRejected = /mehrfach/.test(error.message);
  }

  const objectInput = JSON.stringify({
    Objects: [{
      name: "Land_Custom", pos: [1.2345, 2, 3], ypr: [90, 12.5, -7, 999],
      scale: 0.42, enableCEPersistency: 1, customFlag: true,
      nested: { untouched: [1, 2, 3] }, x: "unknown-source-field",
    }],
  });
  const editableObjects = testApi.parseObjects(objectInput);
  editableObjects[0].x = 9.8765;
  editableObjects[0].yaw = 180.16;
  const objectRoundtrip = JSON.parse(testApi.writeObjects(editableObjects)).Objects[0];

  const missionTree = {
    "/root": [
      { type: "dir", name: "A", path: "/root/A" },
      { type: "dir", name: "B", path: "/root/B" },
    ],
    "/root/A": [{ type: "dir", name: "missions", path: "/root/A/missions" }],
    "/root/B": [{ type: "dir", name: "missions", path: "/root/B/missions" }],
    "/root/A/missions": [
      { type: "dir", name: "dayzOffline.chernarusplus", path: "/missions/chernarus" },
      { type: "dir", name: "dayzOffline.sakhal", path: "/missions/sakhal" },
      { type: "dir", name: "deeper", path: "/root/A/missions/deeper" },
    ],
    "/root/B/missions": [
      { type: "dir", name: "dayzOffline.chernarusplus", path: "/missions/chernarus" },
      { type: "dir", name: "dayzOffline.enoch", path: "/missions/enoch" },
    ],
    "/root/A/missions/deeper": [
      { type: "dir", name: "dayzOffline.too_deep", path: "/missions/too-deep" },
    ],
  };
  const visitedMissionDirs = [];
  const missionDirs = await testApi.collectMissionDirs("/root", 2, async (dir) => {
    visitedMissionDirs.push(dir);
    return missionTree[dir] || [];
  });

  const toolsApi = Tools._test;
  const eventXml = '<?xml version="1.0"?>\r\n<events>\r\n' +
    '    <!-- davor bleibt exakt -->\r\n    <event name="AuditEvent" audit="keep">\r\n' +
    '        <nominal>2</nominal>\r\n        <min>1</min>\r\n        <max>3</max>\r\n' +
    '        <lifetime>1800</lifetime>\r\n        <restock>0</restock>\r\n' +
    '        <saferadius>500</saferadius>\r\n        <distanceradius>500</distanceradius>\r\n' +
    '        <cleanupradius>1000</cleanupradius>\r\n' +
    '        <flags deletable="0" init_random="1" remove_damaged="1" extra="keep"/>\r\n' +
    '        <position>fixed</position>\r\n        <limit>custom</limit>\r\n' +
    '        <active>1</active>\r\n        <secondary>untouched</secondary>\r\n' +
    '        <children>\r\n' +
    '            <child lootmax="4" lootmin="2" max="7" min="3" type="First"/>\r\n' +
    '            <child lootmax="0" lootmin="0" max="1" min="0" type="Second"/>\r\n' +
    '        </children>\r\n    </event>\r\n</events>\r\n';
  const eventDef = toolsApi.parseEventDefinition(eventXml, "AuditEvent");
  const unchangedEvent = toolsApi.updateEventTemplate(
    eventXml, "AuditEvent", eventDef, eventDef);
  const changedEventDef = JSON.parse(JSON.stringify(eventDef));
  changedEventDef.nominal = 9;
  changedEventDef.flags.remove_damaged = 0;
  const changedEvent = toolsApi.updateEventTemplate(
    eventXml, "AuditEvent", changedEventDef, eventDef);
  const changedEventParsed = toolsApi.parseEventDefinition(changedEvent, "AuditEvent");
  const childChangedEventDef = JSON.parse(JSON.stringify(eventDef));
  childChangedEventDef.children[1].max = 5;
  const childChangedEvent = toolsApi.updateEventTemplate(
    eventXml, "AuditEvent", childChangedEventDef, eventDef);
  const childChangedEventParsed = toolsApi.parseEventDefinition(
    childChangedEvent, "AuditEvent");

  const spawnableXml = '<?xml version="1.0"?>\r\n<spawnabletypes>\r\n' +
    '    <type name="AuditBag">\r\n' +
    '        <attachments chance="0.75">\r\n' +
    '            <item name="OpticA" chance="0.25"/>\r\n' +
    '            <item name="OpticB" chance="0.50"/>\r\n' +
    '        </attachments>\r\n' +
    '        <cargo chance="0.40">\r\n' +
    '            <item name="FoodA" chance="0.80"/>\r\n' +
    '            <item name="FoodB" chance="0.20"/>\r\n' +
    '        </cargo>\r\n' +
    '        <attachments chance="0.10">\r\n' +
    '            <item name="OpticC" chance="1.00"/>\r\n' +
    '        </attachments>\r\n' +
    '    </type>\r\n    <!-- anderer Eintrag bleibt exakt -->\r\n' +
    '    <type name="Other"><cargo chance="1"><item name="Keep" chance="1"/></cargo></type>\r\n' +
    '</spawnabletypes>\r\n';
  const spawnableDef = toolsApi.parseSpawnableType(spawnableXml, "AuditBag");
  const unchangedSpawnable = toolsApi.updateSpawnableType(
    spawnableXml, "AuditBag", spawnableDef.blocks, spawnableDef);
  const changedBlocks = JSON.parse(JSON.stringify(spawnableDef.blocks));
  changedBlocks[1].items[1].chance = 0.33;
  const changedSpawnable = toolsApi.updateSpawnableType(
    spawnableXml, "AuditBag", changedBlocks, spawnableDef);
  const changedSpawnableParsed = toolsApi.parseSpawnableType(changedSpawnable, "AuditBag");
  const mergedSpawnableBlocks = toolsApi.mergeSpawnableBlockKinds(
    spawnableDef.blocks.filter((block) => block.kind === "attachments"),
    spawnableDef.blocks.filter((block) => block.kind === "cargo"), spawnableDef);

  const richLoadout = {
    version: 2,
    name: "Rich preset",
    spawnWeight: 7,
    characterTypes: ["SurvivorM_Mirek"],
    customTopLevel: { keep: [1, 2, 3] },
    attachmentSlotItemSets: [
      {
        slotName: "Shoulder", customSlotField: "keep",
        discreteItemSets: [
          {
            itemType: "M4A1", spawnWeight: 0.4,
            attributes: { healthMin: 0.7, healthMax: 1, quantityMin: 0.2,
                          quantityMax: 0.8, customAttribute: true },
            quickBarSlot: 2, simpleChildrenTypes: ["ACOGOptic"],
            complexChildrenSets: [{ itemType: "Mag_STANAG_30Rnd",
              simpleChildrenTypes: ["Ammo_556x45"], unknownComplex: "keep" }],
            unknownItemField: "keep",
          },
          { itemType: "Mosin9130", spawnWeight: 3, quickBarSlot: 8,
            attributes: { healthMin: 0.1, healthMax: 0.2 }, alternative: true },
        ],
      },
      {
        slotName: "Body",
        discreteItemSets: [
          { itemType: "TShirt_Red", spawnWeight: 5, quickBarSlot: 4,
            attributes: { healthMin: 0.7, healthMax: 1, quantityMin: -1,
                          quantityMax: -1, dye: "red" },
            simpleChildrenTypes: ["Rag"],
            complexChildrenSets: [{ itemType: "BandageDressing", nested: true }] },
          { itemType: "Hoodie_Blue", spawnWeight: 2, alternative: "keep" },
        ],
      },
      { slotName: "ModdedExtraSlot", unknownSlot: 99,
        discreteItemSets: [{ itemType: "ModdedItem", quickBarSlot: 6 }] },
    ],
    discreteUnsortedItemSets: [
      {
        name: "First cargo", spawnWeight: 4, unknownCargo: "keep-a",
        attributes: { healthMin: 0.7, healthMax: 1, quantityMin: -1, quantityMax: -1 },
        simpleChildrenTypes: ["Apple", "BandageDressing"],
        complexChildrenSets: [{ itemType: "Canteen", quickBarSlot: 1,
          simpleChildrenTypes: ["WaterBottle"], unknown: "complex-a" }],
      },
      {
        name: "Second cargo", spawnWeight: 8, unknownCargo: "keep-b",
        simpleChildrenTypes: ["Apple"],
        complexChildrenSets: [{ itemType: "AmmoBox", unknown: "complex-b" }],
      },
    ],
  };
  const richLoadoutText = JSON.stringify(richLoadout);
  const richVisible = toolsApi.loadoutVisibleState(richLoadout, "fallback");
  const richNoop = toolsApi.updateLoadoutPreset(
    richLoadoutText, richVisible, JSON.parse(JSON.stringify(richVisible)), richLoadout);
  const richNoopParsed = JSON.parse(richNoop);
  const richDesired = JSON.parse(JSON.stringify(richVisible));
  richDesired.name = "Edited rich preset";
  richDesired.slots.Body = "Hoodie_Green";
  richDesired.health = "0.3,0.7";
  richDesired.cargo = [
    { item: "Apple", num: 1 }, { item: "BandageDressing", num: 1 },
    { item: "HuntingKnife", num: 2 },
  ];
  const richUpdated = JSON.parse(toolsApi.updateLoadoutPreset(
    richLoadoutText, richVisible, richDesired, richLoadout));
  const richCargo = richUpdated.discreteUnsortedItemSets
    .flatMap((set) => set.simpleChildrenTypes || []);
  const newVisible = {
    name: "New preset", health: "0.7,1.0", cargo: [{ item: "BandageDressing", num: 2 }],
    slots: Object.fromEntries(Object.keys(richVisible.slots).map((slot) => [slot, ""])),
  };
  newVisible.slots.Hands = "M4A1";
  const newLoadout = toolsApi.buildNewLoadoutPreset(newVisible);
  const newLoadoutText = JSON.stringify(newLoadout);
  const newLoadoutVisible = toolsApi.loadoutVisibleState(newLoadout, "fallback");
  const newLoadoutNoop = toolsApi.updateLoadoutPreset(
    newLoadoutText, newLoadoutVisible,
    JSON.parse(JSON.stringify(newLoadoutVisible)), newLoadout);
  const clampedPicker = toolsApi.clampPickerPoint({ x: -50.04, z: 16000 }, 15360);

  const report = {
    passed: true,
    exportedParsers: Object.keys(testApi).sort(),
    types: {
      parsed: testApi.parseTypes(original).length,
      byteExactExceptChanges: result.text === expected,
      missing: result.missing,
      ignoresCommentsCdataPi: trickyResult.text === trickyExpected,
      ignoredNameReported: trickyResult.missing,
      directChildOnly: missingResult.text === missingSource.replace(
        "<nominal>1</nominal>", "<nominal>4</nominal>"),
      missingFields: missingResult.missing,
      duplicateRejected,
    },
    players: testApi.parsePlayerspawns(
      '<?xml version="1.0"?><playerspawnpoints><fresh><generator_posbubbles>' +
      '<pos x="12.5" z="33"/></generator_posbubbles></fresh><hop/><travel/></playerspawnpoints>'),
    events: testApi.parseEventspawns(
      '<?xml version="1.0"?><eventposdef><event name="Crash">' +
      '<pos x="10" z="20" a="45"/></event></eventposdef>'),
    objects: testApi.parseObjects(JSON.stringify({
      Objects: [{ name: "Land_Test", pos: [1, 2, 3], ypr: [90, 0, 0] }],
    })),
    objectRoundtrip,
    missionDirs,
    missionSearchStayedBounded: !visitedMissionDirs.includes("/root/A/missions/deeper"),
    tools: {
      eventChildren: eventDef.children,
      eventUnchangedByteExact: unchangedEvent === eventXml,
      eventChangedPreservesUnknown: changedEvent.includes('<secondary>untouched</secondary>') &&
        changedEvent.includes('extra="keep"') && changedEventParsed.nominal === 9 &&
        changedEventParsed.flags.remove_damaged === 0 &&
        changedEventParsed.children[0].max === 7 &&
        changedEventParsed.children[0].min === 3 &&
        changedEventParsed.children[0].lootmax === 4 &&
        changedEventParsed.children[0].lootmin === 2,
      eventChildEditPreservesFullData: childChangedEventParsed.children.length === 2 &&
        childChangedEventParsed.children[0].type === "First" &&
        childChangedEventParsed.children[0].max === 7 &&
        childChangedEventParsed.children[0].min === 3 &&
        childChangedEventParsed.children[0].lootmax === 4 &&
        childChangedEventParsed.children[0].lootmin === 2 &&
        childChangedEventParsed.children[1].max === 5 &&
        childChangedEventParsed.children[1].min === 0 &&
        childChangedEvent.includes('<secondary>untouched</secondary>'),
      spawnableBlockCount: spawnableDef.blocks.length,
      spawnableItemCount: spawnableDef.blocks.reduce(
        (count, block) => count + block.items.length, 0),
      spawnableUnchangedByteExact: unchangedSpawnable === spawnableXml,
      spawnableChangedPreservesStructure: changedSpawnableParsed.blocks.length === 3 &&
        changedSpawnableParsed.blocks[0].items.length === 2 &&
        changedSpawnableParsed.blocks[1].items.length === 2 &&
        changedSpawnableParsed.blocks[2].items.length === 1 &&
        changedSpawnableParsed.blocks[0].chance === 0.75 &&
        changedSpawnableParsed.blocks[0].items[0].chance === 0.25 &&
        changedSpawnableParsed.blocks[1].items[1].chance === 0.33 &&
        mergedSpawnableBlocks.map((block) => block.kind).join(",") ===
          "attachments,cargo,attachments" &&
        changedSpawnable.includes('<!-- anderer Eintrag bleibt exakt -->') &&
        changedSpawnable.includes('<type name="Other"><cargo chance="1"><item name="Keep" chance="1"/></cargo></type>'),
      loadoutLegacySchemaMigrated: richNoop !== richLoadoutText &&
        richNoopParsed.version === undefined &&
        richNoopParsed.attachmentSlotItemSets[0].slotName === "shoulderL" &&
        Array.isArray(richNoopParsed.attachmentSlotItemSets[0]
          .discreteItemSets[0].complexChildrenTypes) &&
        !JSON.stringify(richNoopParsed).includes('"complexChildrenSets"'),
      loadoutValidNoopByteExact: newLoadoutNoop === newLoadoutText,
      loadoutTargetedMergePreservesRichData:
        richUpdated.name === "Edited rich preset" &&
        richUpdated.version === undefined && richUpdated.spawnWeight === 7 &&
        richUpdated.characterTypes.join(",") === "SurvivorM_Mirek" &&
        richUpdated.customTopLevel.keep.join(",") === "1,2,3" &&
        richUpdated.attachmentSlotItemSets[0].slotName === "shoulderL" &&
        richUpdated.attachmentSlotItemSets[0].discreteItemSets.length === 2 &&
        richUpdated.attachmentSlotItemSets[0].discreteItemSets[0].quickBarSlot === 2 &&
        richUpdated.attachmentSlotItemSets[0].discreteItemSets[0]
          .simpleChildrenTypes.join(",") === "ACOGOptic" &&
        richUpdated.attachmentSlotItemSets[0].discreteItemSets[0]
          .complexChildrenTypes[0].unknownComplex === "keep" &&
        richUpdated.attachmentSlotItemSets[0].discreteItemSets[0]
          .attributes.customAttribute === true &&
        richUpdated.attachmentSlotItemSets[0].discreteItemSets[0]
          .attributes.quantityMin === 0.2 &&
        richUpdated.attachmentSlotItemSets[0].discreteItemSets[0]
          .attributes.healthMin === 0.3 &&
        JSON.stringify(richUpdated.attachmentSlotItemSets[0].discreteItemSets[1]) ===
          JSON.stringify(richLoadout.attachmentSlotItemSets[0].discreteItemSets[1]) &&
        richUpdated.attachmentSlotItemSets[1].discreteItemSets[0].itemType ===
          "Hoodie_Green" &&
        richUpdated.attachmentSlotItemSets[1].discreteItemSets[0].quickBarSlot === 4 &&
        richUpdated.attachmentSlotItemSets[1].discreteItemSets[0]
          .complexChildrenTypes[0].nested === true &&
        JSON.stringify(richUpdated.attachmentSlotItemSets[1].discreteItemSets[1]) ===
          JSON.stringify(richLoadout.attachmentSlotItemSets[1].discreteItemSets[1]) &&
        JSON.stringify(richUpdated.attachmentSlotItemSets[2]) ===
          JSON.stringify(richLoadout.attachmentSlotItemSets[2]) &&
        richUpdated.discreteUnsortedItemSets.length === 2 &&
        richUpdated.discreteUnsortedItemSets[0].unknownCargo === "keep-a" &&
        richUpdated.discreteUnsortedItemSets[1].unknownCargo === "keep-b" &&
        richUpdated.discreteUnsortedItemSets[0].complexChildrenTypes[0].unknown ===
          "complex-a" &&
        richUpdated.discreteUnsortedItemSets[1].complexChildrenTypes[0].unknown ===
          "complex-b" &&
        richCargo.filter((item) => item === "Apple").length === 1 &&
        richCargo.filter((item) => item === "BandageDressing").length === 1 &&
        richCargo.filter((item) => item === "HuntingKnife").length === 2,
      newLoadoutValid: newLoadout.version === undefined &&
        newLoadout.attachmentSlotItemSets.length === 1 &&
        newLoadout.attachmentSlotItemSets[0].slotName === "Hands" &&
        newLoadout.attachmentSlotItemSets[0].discreteItemSets[0].quickBarSlot === -1 &&
        Array.isArray(newLoadout.attachmentSlotItemSets[0]
          .discreteItemSets[0].complexChildrenTypes) &&
        newLoadout.discreteUnsortedItemSets[0].simpleChildrenTypes.length === 2,
      pickerClampAndResetTarget: clampedPicker.x === 0 && clampedPicker.z === 15360,
    },
  };
  report.passed = report.types.parsed === 5001 &&
    report.types.byteExactExceptChanges && report.types.missing.length === 0 &&
    report.types.ignoresCommentsCdataPi &&
    report.types.ignoredNameReported.join(",") === "Ghost" &&
    report.types.directChildOnly &&
    report.types.missingFields.join(",") === "OnlyNominal.min" &&
    report.types.duplicateRejected &&
    report.players.fresh[0].x === 12.5 && report.events[0].positions[0].a === 45 &&
    report.objects[0].yaw === 90 &&
    report.objectRoundtrip.pos.join(",") === "9.877,2,3" &&
    report.objectRoundtrip.ypr.join(",") === "180.2,12.5,-7,999" &&
    report.objectRoundtrip.scale === 0.42 && report.objectRoundtrip.enableCEPersistency === 1 &&
    report.objectRoundtrip.customFlag === true &&
    report.objectRoundtrip.nested.untouched.join(",") === "1,2,3" &&
    report.objectRoundtrip.x === "unknown-source-field" &&
    report.missionDirs.join(",") === "/missions/chernarus,/missions/sakhal,/missions/enoch" &&
    report.missionSearchStayedBounded && report.tools.eventChildren.length === 2 &&
    report.tools.eventUnchangedByteExact && report.tools.eventChangedPreservesUnknown &&
    report.tools.eventChildEditPreservesFullData &&
    report.tools.spawnableBlockCount === 3 && report.tools.spawnableItemCount === 5 &&
    report.tools.spawnableUnchangedByteExact &&
    report.tools.spawnableChangedPreservesStructure &&
    report.tools.loadoutLegacySchemaMigrated &&
    report.tools.loadoutValidNoopByteExact &&
    report.tools.loadoutTargetedMergePreservesRichData &&
    report.tools.newLoadoutValid && report.tools.pickerClampAndResetTarget;
  document.querySelector("#result").textContent = JSON.stringify(report, null, 2);
  document.body.dataset.passed = String(report.passed);
})().catch((error) => {
  document.querySelector("#result").textContent = error.stack || error.message;
  document.body.dataset.passed = "false";
});
