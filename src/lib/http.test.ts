import { describe, expect, it } from "vitest";
import { z } from "zod";
import { commandBody } from "./http";
const schema = z.object({ action: z.literal("pause") }).strict();
function request(origin: string, host = "127.0.0.1:4391", extra: Record<string, string> = {}) {
  return new Request("http://localhost:4391/api/replay/state", { method: "POST", headers: { origin, host, ...extra }, body: JSON.stringify({ action: "pause" }) });
}
describe("browser command boundary", () => {
  it("accepts the browser authority when Next uses an internal hostname", async () => {
    await expect(commandBody(request("http://127.0.0.1:4391"), schema)).resolves.toEqual({ action: "pause" });
  });
  it.each(["https://attacker.example", "null", "http://127.0.0.1:9999", "http://127.0.0.1:4391/path"])("rejects unrelated or malformed origins: %s", async (origin) => {
    await expect(commandBody(request(origin), schema)).rejects.toThrow("ORIGIN_DENIED");
  });
  it("does not accept an attacker-controlled forwarded host", async () => {
    await expect(commandBody(request("https://attacker.example", "127.0.0.1:4391", { "x-forwarded-host": "attacker.example" }), schema)).rejects.toThrow("ORIGIN_DENIED");
  });
  it("bounds streamed bytes even without content-length", async () => {
    await expect(commandBody(request("http://127.0.0.1:4391"), schema, 2)).rejects.toThrow("BODY_TOO_LARGE");
  });
});
