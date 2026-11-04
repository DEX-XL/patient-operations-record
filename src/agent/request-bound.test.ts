import { describe, expect, it } from "vitest";
import { MODEL_LIMITS } from "@/lib/config";
import { worstCaseMicrousd } from "@/lib/budget";
import { agentRequest, newAgentState } from "@/agent/protocol";

describe("bounded request envelope (32KiB-64KiB)", () => {
  it("serializes and prices a request between 32KiB and 64KiB, refuses above 64KiB", () => {
    expect(MODEL_LIMITS.requestBodyBytes).toBe(65_536);
    const base = newAgentState({ encounter: "PLACEHOLDER_ENCOUNTER" });
    const mid = structuredClone(base);
    mid.input.push({ type: "reasoning", encrypted_content: "S".repeat(40_000) });
    const { body } = agentRequest(mid);
    const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
    expect(bytes).toBeGreaterThan(32_768);
    expect(bytes).toBeLessThanOrEqual(65_536);
    expect(worstCaseMicrousd(bytes)).toBeGreaterThan(0);
    const tooBig = structuredClone(base);
    tooBig.input.push({ type: "reasoning", encrypted_content: "L".repeat(70_000) });
    expect(() => agentRequest(tooBig)).toThrow("REQUEST_CONTEXT_BOUND_EXCEEDED");
    const tooBigBytes = Buffer.byteLength(JSON.stringify({ model: "muse-spark-1.3", filler: "L".repeat(70_000) }), "utf8");
    expect(tooBigBytes).toBeGreaterThan(65_536);
    expect(() => worstCaseMicrousd(tooBigBytes)).toThrow("REQUEST_SIZE_BOUND");
    expect(() => worstCaseMicrousd(65_537)).toThrow("REQUEST_SIZE_BOUND");
  });
});
