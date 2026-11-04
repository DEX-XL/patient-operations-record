import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase, type DatabaseConnection } from "@/db/client";
import { fundingRecords, ledgerEntries } from "@/db/schema";
import { MUSE_RUN_CAP_MICROUSD, reserveMuseRequest } from "@/lib/budget";
import { boundedMuseRequest, completedStreamResponse, forwardMuseRequest } from "./muse-gateway";

const runId = "00000000-0000-4000-8000-000000000002", now = Date.parse("2026-10-30T05:00:00Z");
const request = () => ({ model: "muse-spark-1.3", instructions: "Synthetic coding context only", input: [{ role: "user", content: [{ type: "input_text", text: "Return a small patch for a synthetic demonstration app." }] }], store: true, stream: true, max_output_tokens: 128000, reasoning: { effort: "high" }, include: ["reasoning.encrypted_content"] });
const funding = () => ({ smokePassed: true, runtimeApproved: true, evidence: { userApproved: true, grantVerifiedAt: new Date(now).toISOString(), grantExpiresAt: "2026-11-05T00:00:00Z", remainingGrantMicrousd: 150_000_000, externalSpentMicrousd: { museBuild: 0, runtimeDev: 0, heldoutEval: 0, publicDemo: 0 }, sharedUsageReconciled: true, pricingVerifiedAt: new Date(now).toISOString() } });
const completed = () => ({ id: "resp_mock_muse", status: "completed", output: [{ type: "reasoning", encrypted_content: "unit-test-reasoning" }, { type: "message", content: [{ type: "output_text", text: "Synthetic patch output" }] }], usage: { input_tokens: 500, output_tokens: 80 } });
const sse = (response = completed()) => `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`;
describe("native Muse Code spending gate (mocked inference only)", () => {
  let connection: DatabaseConnection;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Use pnpm test");
    const directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "muse-"));
    connection = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  afterEach(() => connection?.client.close());
  const proof = () => connection.db.insert(fundingRecords).values({ id: "active", evidence: funding() });
  const send = (fetcher: typeof fetch, changes: Partial<Parameters<typeof forwardMuseRequest>[0]> = {}) => forwardMuseRequest({ connection, runId, step: 0, body: request(), credential: "unit-test-placeholder", fetcher, now, ...changes });
  it("clamps the observed128k default, disables storage and fixes the approved model effort", () => {
    expect(JSON.parse(boundedMuseRequest(request()))).toMatchObject({ model: "muse-spark-1.3", max_output_tokens: 4096, reasoning: { effort: "low" }, store: false });
    expect(() => boundedMuseRequest({ ...request(), tools: [{ type: "web_search" }] })).toThrow("UNSUPPORTED_NATIVE_MUSE_REQUEST");
    expect(() => boundedMuseRequest({ ...request(), input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.invalid/" }] }] })).toThrow("UNSUPPORTED_NATIVE_MUSE_REQUEST");
  });
  it("refuses absent funding before fetch or reservation", async () => {
    const fetcher = vi.fn<typeof fetch>(); await expect(send(fetcher)).rejects.toMatchObject({ code: "VERIFIED_FUNDING_AND_SMOKE_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled(); expect(await connection.db.select().from(ledgerEntries)).toHaveLength(0);
  });
  it("reserves in Muse75, settles actual usage and retains only final output text", async () => {
    await proof();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.meta.ai/v1/responses"); expect(JSON.parse(String(init?.body)).max_output_tokens).toBe(4096);
      expect((await connection.db.select().from(ledgerEntries))[0]).toMatchObject({ bucket: "museBuild", state: "reserved" });
      return new Response(sse(), { headers: { "Content-Type": "text/event-stream" } });
    });
    const result = await send(fetcher); expect(result.outputText).toBe("Synthetic patch output"); expect(result.actualMicrousd).toBe(965);
    expect((await connection.db.select().from(ledgerEntries))[0]).toMatchObject({ state: "settled", actualMicrousd: 965 });
    await expect(send(fetcher)).rejects.toMatchObject({ code: "REQUEST_ALREADY_RESERVED" }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 402, 429, 500])("never retries provider%s or releases a possibly charged reservation", async (status) => {
    await proof(); const fetcher = vi.fn<typeof fetch>(async () => new Response("private provider details", { status }));
    await expect(send(fetcher)).rejects.toMatchObject({ code: `MUSE_HTTP_${status}` });
    expect(fetcher).toHaveBeenCalledTimes(1); expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("blocks a second call after an incomplete stream with unknown cost", async () => {
    await proof(); const fetcher = vi.fn<typeof fetch>(async () => new Response('data: {"type":"response.created"}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    await expect(send(fetcher)).rejects.toMatchObject({ code: "MUSE_COMPLETION_OR_USAGE_MISSING" });
    await expect(send(fetcher, { step: 1 })).rejects.toMatchObject({ code: "UNCERTAIN_USAGE_REQUIRES_RECONCILIATION" }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("enforces the build bucket independently of available runtime credits", async () => {
    const data = funding(); data.evidence.externalSpentMicrousd.museBuild = 75_000_000;
    await connection.db.insert(fundingRecords).values({ id: "active", evidence: data });
    await expect(send(vi.fn<typeof fetch>())).rejects.toMatchObject({ code: "BUCKET_CAP_REACHED" });
  });
  it("limits each coding contribution to$1 even inside the$75 allocation", async () => {
    await proof();
    await connection.db.insert(ledgerEntries).values({ id: `muse:${runId}:previous`, bucket: "museBuild", reservedMicrousd: MUSE_RUN_CAP_MICROUSD - 1, actualMicrousd: MUSE_RUN_CAP_MICROUSD - 1, state: "settled", createdAt: new Date(now).toISOString() });
    await expect(reserveMuseRequest(connection, { id: `muse:${runId}:1`, runId, bodyBytes: 100, now })).rejects.toMatchObject({ code: "MUSE_RUN_CAP_REACHED" });
  });
  it("rejects malformed completion events and oversized or credential-bearing contexts", () => {
    expect(() => completedStreamResponse("data: not-json\n\n")).toThrow("MALFORMED_MUSE_EVENT");
    expect(() => completedStreamResponse(sse() + sse())).toThrow("DUPLICATE_MUSE_COMPLETION");
    expect(() => boundedMuseRequest({ ...request(), instructions: "x".repeat(196609) })).toThrow();
    expect(() => boundedMuseRequest({ ...request(), instructions: `LLM_${"x".repeat(30)}` })).toThrow("NATIVE_MUSE_CONTEXT_REFUSED");
  });
});
