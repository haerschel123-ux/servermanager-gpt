"use strict";

(() => {
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
  const report = {
    passed: true,
    exportedParsers: Object.keys(testApi).sort(),
    types: {
      parsed: testApi.parseTypes(original).length,
      byteExactExceptChanges: result.text === expected,
      missing: result.missing,
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
  };
  report.passed = report.types.parsed === 5001 &&
    report.types.byteExactExceptChanges && report.types.missing.length === 0 &&
    report.players.fresh[0].x === 12.5 && report.events[0].positions[0].a === 45 &&
    report.objects[0].yaw === 90;
  document.querySelector("#result").textContent = JSON.stringify(report, null, 2);
  document.body.dataset.passed = String(report.passed);
})();
