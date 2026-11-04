import { describe, expect, it } from "vitest";
import { assertFreezeTime, FREEZE_NOT_BEFORE, hashConfigurationEntries, verifyFrozenConfiguration } from "./freeze";

const when = Date.parse(FREEZE_NOT_BEFORE);
const initial = hashConfigurationEntries([["src/example.ts", "const example = 1;\n"]]);
const manifest = { version: 1, frozenAt: FREEZE_NOT_BEFORE, notBefore: FREEZE_NOT_BEFORE, encoding: "UTF-8 with CRLF normalized to LF; NOT the held-out file hash procedure", ...initial };
describe("pre-exposure algorithm freeze", () => {
  it("refuses early freezing and uses the correct post-DST instant", () => {
    expect(() => assertFreezeTime(Date.parse("2026-11-02T01:59:59Z"))).toThrow("FEATURE_FREEZE_NOT_REACHED");
    expect(() => assertFreezeTime(when)).not.toThrow();
  });
  it("is independent of entry order and Git checkout line endings", () => {
    expect(hashConfigurationEntries([["b", "two\r\n"], ["a", "one\n"]])).toEqual(hashConfigurationEntries([["a", "one\r\n"], ["b", "two\n"]]));
  });
  it("accepts the unchanged configuration and rejects duplicate paths", () => {
    expect(verifyFrozenConfiguration(initial, manifest, when)).toEqual(manifest);
    expect(() => hashConfigurationEntries([["a", "one"], ["a", "two"]])).toThrow("DUPLICATE_CONFIG_PATH");
  });
  it.each([
    { entries: [["src/example.ts", "const example = 2;\n"]] },
    { entries: [["src/example.ts", "const example = 1;\n"], ["src/added.ts", "new algorithm"]] },
    { entries: [] },
  ])("rejects changed, added or removed frozen source", ({ entries }) => {
    expect(() => verifyFrozenConfiguration(hashConfigurationEntries(entries as [string, string][]), manifest, when)).toThrow("FROZEN_CONFIGURATION_CHANGED");
  });
});
