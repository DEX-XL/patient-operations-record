import { readFile, writeFile } from "node:fs/promises";
import { assertFreezeTime, configurationSnapshot, FREEZE_NOT_BEFORE, verifyFrozenConfiguration } from "../src/eval/freeze";

async function main() {
  const mode = process.argv[2] ?? "--prepare";
  if (!["--prepare", "--freeze", "--verify"].includes(mode)) throw new Error("UNKNOWN_FREEZE_COMMAND");
  const current = await configurationSnapshot();
  if (mode === "--prepare") {
    console.log(JSON.stringify({ mode: "dry-run", notBefore: FREEZE_NOT_BEFORE, eligibleNow: Date.now() >= Date.parse(FREEZE_NOT_BEFORE), files: Object.keys(current.files).length, sourceDigest: current.sourceDigest, heldoutOpened: false, providerCalls: 0 }));
    return;
  }
  if (mode === "--freeze") {
    assertFreezeTime(Date.now());
    // Exclusive creation: an existing freeze is never silently replaced.
    await writeFile("eval/FROZEN_CONFIG.json", JSON.stringify({ version: 1, frozenAt: new Date().toISOString(), notBefore: FREEZE_NOT_BEFORE, encoding: "UTF-8 with CRLF normalized to LF; NOT the held-out file hash procedure", ...current }, null, 2) + "\n", { flag: "wx" });
  }
  verifyFrozenConfiguration(current, JSON.parse(await readFile("eval/FROZEN_CONFIG.json", "utf8")));
  console.log("Frozen configuration verified. Held-out input was not opened. No model request was sent.");
}
main().catch(error => { console.error(error instanceof Error && /^(?:FEATURE_FREEZE_NOT_REACHED|FROZEN_CONFIGURATION_CHANGED|DUPLICATE_CONFIG_PATH|CONFIG_SYMLINK_DENIED|UNKNOWN_FREEZE_COMMAND)$/.test(error.message) ? error.message : "FREEZE_MANIFEST_UNAVAILABLE_OR_INVALID; existing files preserved"); process.exitCode = 1; });
