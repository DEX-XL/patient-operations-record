import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Only B7's exact frozen dataset can become a source candidate after its gate.
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const allowedHeldout = new Set(["heldout/README.md", "heldout/inputs.json", "heldout/gold.json"]);
for (const file of files) if (/^eval\/heldout\/(?:CONTRACT_AUDIT|TRIALS|H-[AP][12]__baseline|b7-H-[AP][12]-[123])\.json$/.test(file)) allowedHeldout.add(file);
if (files.some(file => file.startsWith("heldout/"))) {
  const freeze = JSON.parse(readFileSync("eval/FROZEN_CONFIG.json", "utf8"));
  if (Date.parse(freeze.frozenAt) < Date.parse("2026-11-02T02:00:00Z") || !Number.isFinite(Date.parse(freeze.frozenAt)) || Date.parse(freeze.frozenAt) > Date.now()) throw new Error("B7 freeze gate missing");
  for (const [file, expected] of Object.entries({ "inputs.json": "99793b06a23bf8e09e90be14cbd61c75462d883486a6a5b057d77821e13868a8", "gold.json": "3d0fa3333e7e6c25be27447768ace2b84e7cec774248d69410b9c2a1495c8983" })) {
    if (createHash("sha256").update(readFileSync(`heldout/${file}`)).digest("hex") !== expected) throw new Error("B7 raw dataset hash mismatch");
  }
}
const forbidden = files.filter((file) => /(^|\/)(heldout|private)(\/|$)|(^|\/)\.env(\.|$)/.test(file) && file !== ".env.example" && !allowedHeldout.has(file));
if (forbidden.length) throw new Error("Forbidden file present in Git candidates; inspect names locally.");
for (const file of files.filter((file) => /\.(ts|tsx|js|mjs|json|md|ya?ml)$/.test(file) && !file.endsWith("lock.yaml"))) {
  const content = readFileSync(file, "utf8");
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:sk-|mmk-|LLM_)[A-Za-z0-9_-]{24,}/.test(content)) throw new Error(`Possible credential in source: ${file}`);
}
execFileSync("git", ["check-ignore", ".env.local"], { stdio: "ignore" });
console.log("Boundary check passed: secret path ignored; no forbidden Git candidates. B7 exposure is recorded separately in the freeze/hash evidence.");
