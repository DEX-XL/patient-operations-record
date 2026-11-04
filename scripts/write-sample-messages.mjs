// Author-time synthetic fixtures only; never a hospital feed or parser generator.
import { mkdir, writeFile } from "node:fs/promises";
const base = (kind, id) => [
  ["MSH", "^~\\&", "SYNTHETIC_DEMO", "DEMO", "REPLAY", "DEMO", "20261029070000", "", kind, id, "T", "2.5.1"],
  ["PID", "1", "", "P-101^^^SYNTHETIC"],
  Array.from({ length: 20 }, (_, i) => ({ 0: "PV1", 2: "I", 3: "UNIT-A^101", 19: "E-101" })[i] ?? ""),
];
const samples = [
  ["adt-a01.hl7", base("ADT^A01", "sample-admit")],
  ["oru-r01.hl7", [...base("ORU^R01", "sample-preliminary"), ["OBR", "1", "", "existing-order"], ["OBX", "1", "TX", "BCX^Synthetic blood culture", "", "Preliminary status; final report pending", "", "", "", "", "", "P"]]],
  ["siu-s13.hl7", [...base("SIU^S13", "sample-reschedule"), ["SCH", "existing-or-slot"]]],
];
await mkdir("fixtures/hl7", { recursive: true });
for (const [name, segments] of samples) await writeFile(`fixtures/hl7/${name}`, segments.map((row) => row.join("|")).join("\r\n") + "\r\n");
console.log("Wrote three synthetic sample messages.");
