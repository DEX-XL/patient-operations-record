import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  for (const key of ["DATABASE_URL", "DATABASE_AUTH_TOKEN", "DATABASE_TURSO_DATABASE_URL", "DATABASE_TURSO_AUTH_TOKEN"]) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("server-only deployment environment adapter", () => {
  it("preserves absent local settings instead of stringifying undefined", () => {
    register();
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.DATABASE_AUTH_TOKEN).toBeUndefined();
  });
  it("maps provisioned marketplace settings before database startup", () => {
    vi.stubEnv("DATABASE_TURSO_DATABASE_URL", "libsql://synthetic-test.invalid");
    vi.stubEnv("DATABASE_TURSO_AUTH_TOKEN", "synthetic-test-token");
    register();
    expect(process.env.DATABASE_URL).toBe("libsql://synthetic-test.invalid");
    expect(process.env.DATABASE_AUTH_TOKEN).toBe("synthetic-test-token");
  });
  it("retains explicit operator settings", () => {
    vi.stubEnv("DATABASE_URL", "file:data/operator-test.db");
    vi.stubEnv("DATABASE_AUTH_TOKEN", "explicit-test-token");
    vi.stubEnv("DATABASE_TURSO_DATABASE_URL", "libsql://synthetic-test.invalid");
    vi.stubEnv("DATABASE_TURSO_AUTH_TOKEN", "marketplace-test-token");
    register();
    expect(process.env.DATABASE_URL).toBe("file:data/operator-test.db");
    expect(process.env.DATABASE_AUTH_TOKEN).toBe("explicit-test-token");
  });
  it("does not invent an absent token when only a URL exists", () => {
    vi.stubEnv("DATABASE_TURSO_DATABASE_URL", "libsql://synthetic-test.invalid");
    register();
    expect(process.env.DATABASE_AUTH_TOKEN).toBeUndefined();
  });
  it("does not copy secrets into an edge runtime", () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("DATABASE_TURSO_AUTH_TOKEN", "synthetic-test-token");
    register();
    expect(process.env.DATABASE_AUTH_TOKEN).toBeUndefined();
  });
});
