"use strict";

window.LoadoutExamples = [
  {
    title: "Sanitäter",
    description: "Warme Kleidung, Verbände, Bluttest und Kochsalzlösung.",
    slots: { Body: "ParamedicJacket_Blue", Legs: "ParamedicPants_Blue", Feet: "AthleticShoes_Black", Back: "TaloonBag_Blue" },
    cargo: [["BandageDressing", 4], ["BloodTestKit", 1], ["SalineBagIV", 1], ["TetracyclineAntibiotics", 1]]
  },
  {
    title: "Küsten-Überlebender",
    description: "Solider Start mit Messer, Wasser, Essen und Licht.",
    slots: { Body: "Hoodie_Grey", Legs: "CargoPants_Green", Feet: "HikingBootsLow_Beige", Back: "DryBag_Green" },
    cargo: [["StoneKnife", 1], ["WaterBottle", 1], ["TacticalBaconCan", 2], ["RoadFlare", 1], ["BandageDressing", 2]]
  },
  {
    title: "Patrouille",
    description: "Bewaffnetes Beispiel mit M4A1, Magazin und Optik.",
    slots: { Body: "BDUJacket", Vest: "PlateCarrierVest", Legs: "BDUPants", Feet: "MilitaryBoots_Black", Back: "AssaultBag_Green", Shoulder: "M4A1" },
    slotExtras: { Shoulder: { attachments: ["M4_RISHndgrd", "M4_OEBttstck", "ACOGOptic"], magazine: "Mag_STANAG_30Rnd" } },
    cargo: [["Mag_STANAG_30Rnd", 2], ["BandageDressing", 2], ["Canteen", 1]]
  }
];
