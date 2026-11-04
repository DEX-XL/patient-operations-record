import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { findRecording } from "./recordings";
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
// In-memory test data only. This is never exported as a real Meta capture.
const hash = "a".repeat(64), file = `test__mock__${hash}.json`;
const capture = {
  capturedFrom: "LIVE META", model: "muse-spark-1.3", runId: "00000000-0000-4000-8000-000000000001",
  responseIds: ["resp_unit_test_only"], capturedAt: "2026-10-30T04:00:00.000Z", scenarioId: "test", eventId: "mock",
  encounterId: "E-201", actorId: "md-hospitalist", contextHash: hash, promptHash: hash,
  actions: [{ type: "stage_finding", finding: { id: "E-201:blood_culture_pending:pending_owner", key: "blood_culture_pending", encounterId: "E-201", kind: "pending_owner", ownerRole: "hospitalist", ownerId: "md-hospitalist", sourceIds: ["p-bcx-pre"], state: "open" } }],
  trace: [], originalCostMicrousd: 20, originalUsage: { inputTokens: 10, outputTokens: 1 },
};
describe("recording lookup (mock capture, no model or disk writes)", () => {
  beforeEach(() => { vi.mocked(readFile).mockReset(); });
  function load(candidate: unknown = capture) {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify([file])).mockResolvedValueOnce(JSON.stringify(candidate));
  }
  it("returns a matching capture with its original provenance", async () => {
    load(); const result = await findRecording(hash, "E-201", "md-hospitalist");
    expect(result?.responseIds).toEqual(["resp_unit_test_only"]); expect(result?.originalCostMicrousd).toBe(20);
  });
  it("will not substitute a different patient's context", async () => {
    load(); await expect(findRecording(hash, "E-101", "md-hospitalist")).resolves.toBeUndefined();
  });
  it("does not label deterministic data as a Meta capture", async () => {
    load({ ...capture, capturedFrom: "RULES BASELINE" });
    await expect(findRecording(hash, "E-201", "md-hospitalist")).resolves.toBeUndefined();
  });
  it("rejects a manifest path outside the approved recording directory", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(["../../private.json"]));
    await expect(findRecording(hash, "E-201", "md-hospitalist")).rejects.toThrow();
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
