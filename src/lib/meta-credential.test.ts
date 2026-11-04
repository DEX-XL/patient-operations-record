import { describe, expect, it } from "vitest";
import { credentialFromMuseObject, resolveMetaCredential } from "./meta-credential";

describe("explicit credential paths without dotenv", () => {
  it("prefers explicit process credentials and leaves native storage opt-in", async () => {
    expect(await resolveMetaCredential({ MODEL_API_KEY: "test-model-placeholder", META_API_KEY: "test-muse-placeholder" })).toBe("test-model-placeholder");
    expect(await resolveMetaCredential({ META_API_KEY: "test-muse-placeholder" })).toBe("test-muse-placeholder");
    expect(await resolveMetaCredential({})).toBeUndefined();
  });
  it("recognizes only an API credential for the official API destination", () => {
    expect(credentialFromMuseObject({ providers: { meta: { api_key: "test-placeholder", api_base_url: "https://api.meta.ai/v1" } } })).toBe("test-placeholder");
    expect(credentialFromMuseObject({ providers: { meta: { access_token: "test-placeholder", api_base_url: "https://api.meta.ai/v1" } } })).toBeUndefined();
    for (const api_base_url of ["https://elsewhere.example/v1", "https://api.meta.ai.evil.example/v1", "http://api.meta.ai/v1", "https://api.meta.ai/v1?forward=elsewhere", "https://name:password@api.meta.ai/v1"]) {
      expect(credentialFromMuseObject({ providers: { meta: { api_key: "test-placeholder", api_base_url } } })).toBeUndefined();
    }
  });
});
