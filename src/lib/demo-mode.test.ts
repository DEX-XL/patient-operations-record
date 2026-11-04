import { describe, expect, it } from "vitest";
import { defaultExecutionMode, keylessDemoEnvironment } from "./demo-mode";

describe("defaultExecutionMode", () => {
  it("returns RECORDED META only when demo mode is recorded", () => {
    expect(defaultExecutionMode({ PATIENT_OPS_DEMO_MODE: "recorded" })).toBe("RECORDED META");
  });

  it("never defaults to LIVE META", () => {
    const cases: Array<Record<string, string | undefined>> = [
      {},
      { PATIENT_OPS_DEMO_MODE: undefined },
      { PATIENT_OPS_DEMO_MODE: "" },
      { PATIENT_OPS_DEMO_MODE: "live" },
      { PATIENT_OPS_DEMO_MODE: "LIVE" },
      { PATIENT_OPS_DEMO_MODE: "record" },
      { PATIENT_OPS_DEMO_MODE: "RECORDED" },
    ];
    for (const env of cases) {
      const mode = defaultExecutionMode(env);
      expect(mode).toBe("RULES BASELINE");
      expect(mode).not.toContain("LIVE");
    }
  });
});

describe("keylessDemoEnvironment", () => {
  it("removes inherited keys and forces recorded, keyless flags", () => {
    const input: Record<string, string | undefined> = {
      PATIENT_OPS_DEMO_MODE: "live",
      META_LIVE_ENABLED: "true",
      META_USE_MUSE_LOGIN: "true",
      MODEL_API_KEY: "placeholder-model-key",
      META_API_KEY: "placeholder-meta-key",
    };
    const next = keylessDemoEnvironment(input);
    expect(next.PATIENT_OPS_DEMO_MODE).toBe("recorded");
    expect(next.META_LIVE_ENABLED).toBe("false");
    expect(next.META_USE_MUSE_LOGIN).toBe("false");
    expect("MODEL_API_KEY" in next).toBe(false);
    expect("META_API_KEY" in next).toBe(false);
    expect(next.MODEL_API_KEY).toBeUndefined();
    expect(next.META_API_KEY).toBeUndefined();
  });

  it("does not mutate the caller environment", () => {
    const input: Record<string, string | undefined> = {
      PATIENT_OPS_DEMO_MODE: "placeholder-prior-mode",
      MODEL_API_KEY: "placeholder-model-key",
      META_API_KEY: "placeholder-meta-key",
    };
    const snapshot = { ...input };
    keylessDemoEnvironment(input);
    expect(input).toEqual(snapshot);
  });

  it("retains database settings", () => {
    const input: Record<string, string | undefined> = {
      DATABASE_URL: "placeholder-database-url",
      DB_FILENAME: "placeholder-db-file",
      MODEL_API_KEY: "placeholder-model-key",
    };
    const next = keylessDemoEnvironment(input);
    expect(next.DATABASE_URL).toBe("placeholder-database-url");
    expect(next.DB_FILENAME).toBe("placeholder-db-file");
  });
});
