import { describe, expect, it } from "vitest";
import { runtimeBucket } from "./runtime-purpose";

describe("operator-owned runtime purpose", () => {
  it("uses development locally and public-demo on Vercel by default", () => {
    expect(runtimeBucket({})).toBe("runtimeDev");
    expect(runtimeBucket({ VERCEL: "1" })).toBe("publicDemo");
  });
  it("attributes local video and evaluation runs to their own capped buckets", () => {
    expect(runtimeBucket({ META_RUNTIME_BUCKET: "publicDemo" })).toBe("publicDemo");
    expect(runtimeBucket({ META_RUNTIME_BUCKET: "heldoutEval" })).toBe("heldoutEval");
  });
  it.each(["reserve", "museBuild", "unknown", ""])("rejects an invalid bucket: %s", (selected) => {
    expect(() => runtimeBucket({ META_RUNTIME_BUCKET: selected })).toThrow("INVALID_RUNTIME_BUCKET");
  });
  it.each(["runtimeDev", "heldoutEval"])("cannot redirect a public deployment into %s", (selected) => {
    expect(() => runtimeBucket({ VERCEL: "1", META_RUNTIME_BUCKET: selected })).toThrow("PUBLIC_DEPLOYMENT_BUCKET_LOCKED");
  });
});
