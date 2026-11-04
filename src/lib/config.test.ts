import { describe, expect, it } from "vitest";
import { assertLiveCallAllowed, BUDGET_CAPS_USD, getConfig } from "./config";

describe("unfunded/default calls fail closed", () => {
  it("disables live by default, and only exact true enables the flag", () => {
    expect(getConfig({}).liveEnabled).toBe(false);
    expect(getConfig({ META_LIVE_ENABLED: "TRUE" }).liveEnabled).toBe(false);
    expect(getConfig({ META_LIVE_ENABLED: "true" }).liveEnabled).toBe(true);
    expect(getConfig({ META_LIVE_ENABLED: "true" }).mode).toBe("UNAVAILABLE");
  });
  it("cannot make a paid request even if flags are supplied in B1/B2", () => {
    expect(() => assertLiveCallAllowed({ userApproved: false, balanceVerified: true, reserved: true }, { META_LIVE_ENABLED: "true" })).toThrow("LIVE_CALL_BLOCKED");
    expect(() => assertLiveCallAllowed({ userApproved: true, balanceVerified: true, reserved: true }, { META_LIVE_ENABLED: "true" })).toThrow("not implemented");
  });
  it("locks spending to the approved buckets and leaves $30 unused", () => {
    expect(BUDGET_CAPS_USD).toEqual({ museBuild: 75, runtimeDev: 15, heldoutEval: 10, publicDemo: 20, reserve: 30 });
    expect(Object.values(BUDGET_CAPS_USD).reduce((sum, cap) => sum + cap, 0)).toBe(150);
    expect(Object.isFrozen(BUDGET_CAPS_USD)).toBe(true);
  });
});
