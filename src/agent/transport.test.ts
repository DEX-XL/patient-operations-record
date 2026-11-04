import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase, type DatabaseConnection } from "@/db/client";
import { fundingRecords, ledgerEntries } from "@/db/schema";
import { reserveModelRequest, settleModelRequest, worstCaseMicrousd } from "@/lib/budget";
import { agentRequest, newAgentState } from "./protocol";
import { callMeta } from "./transport";

const now = Date.parse("2026-10-30T04:00:00Z");
const funding = () => ({ smokePassed: true, runtimeApproved: true, evidence: {
  userApproved: true, grantVerifiedAt: new Date(now).toISOString(), grantExpiresAt: "2026-11-05T00:00:00Z", remainingGrantMicrousd: 150_000_000,
  externalSpentMicrousd: { museBuild: 0, runtimeDev: 0, heldoutEval: 0, publicDemo: 0 }, sharedUsageReconciled: true, pricingVerifiedAt: new Date(now).toISOString(),
} });
describe("persistent runtime reservations and mocked Meta transport", () => {
  let connection: DatabaseConnection;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Use pnpm test");
    const dir = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "transport-"));
    connection = connectDatabase(`file:${join(dir, "test.db").replaceAll("\\", "/")}`);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  afterEach(() => connection?.client.close());
  const proof = () => connection.db.insert(fundingRecords).values({ id: "active", evidence: funding() });
  const request = () => agentRequest(newAgentState({ synthetic: true }, now), now).body;
  const send = (fetcher: typeof fetch, changes: Partial<Parameters<typeof callMeta>[0]> = {}) => callMeta({ connection, requestId: "run-1:0", bucket: "runtimeDev", now, body: request(), env: { META_LIVE_ENABLED: "true", MODEL_API_KEY: "unit-test-placeholder" }, fetcher, ...changes });
  it("blocks before fetch when live is disabled or funding evidence is missing", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(send(fetcher, { env: {} })).rejects.toMatchObject({ code: "LIVE_DISABLED" });
    await expect(send(fetcher)).rejects.toMatchObject({ code: "VERIFIED_FUNDING_AND_SMOKE_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled(); expect(await connection.db.select().from(ledgerEntries)).toHaveLength(0);
  });
  it("reserves before calling the fixed endpoint, then settles actual total output cost", async () => {
    await proof();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.meta.ai/v1/responses"); expect(init?.redirect).toBe("error");
      expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("reserved");
      return Response.json({ id: "resp_mock", status: "completed", output: [], usage: { input_tokens: 80, output_tokens: 40, output_tokens_details: { reasoning_tokens: 30 } } });
    });
    const result = await send(fetcher);
    expect(result.actualMicrousd).toBe(270); // Includes reasoning in total output, once.
    expect((await connection.db.select().from(ledgerEntries))[0]).toMatchObject({ state: "settled", actualMicrousd: 270 });
    await expect(send(fetcher)).rejects.toMatchObject({ code: "REQUEST_ALREADY_RESERVED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 402, 429, 500, 503])("never retries HTTP %s and retains an uncertain reservation", async (status) => {
    await proof(); const fetcher = vi.fn<typeof fetch>(async () => new Response("private provider payload must not leak", { status }));
    await expect(send(fetcher)).rejects.toMatchObject({ code: `META_HTTP_${status}` });
    expect(fetcher).toHaveBeenCalledTimes(1); expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
    await expect(send(fetcher, { requestId: "run-2:0" })).rejects.toMatchObject({ code: "UNCERTAIN_USAGE_REQUIRES_RECONCILIATION" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains the reservation for network timeout, malformed JSON or absent usage", async () => {
    await proof();
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("unit-test-placeholder"); });
    await expect(send(fetcher)).rejects.toMatchObject({ code: "MODEL_REQUEST_FAILED_RECONCILIATION_REQUIRED" });
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("rejects malformed or missing usage without releasing a potentially charged request", async () => {
    await proof(); const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "resp_mock", output: [] }));
    await expect(send(fetcher)).rejects.toMatchObject({ code: "MODEL_REQUEST_FAILED_RECONCILIATION_REQUIRED" });
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("bounds response size", async () => {
    await proof(); const fetcher = vi.fn<typeof fetch>(async () => new Response("x".repeat(524_289)));
    await expect(send(fetcher)).rejects.toMatchObject({ code: "MODEL_RESPONSE_TOO_LARGE" });
  });
  it("protects bucket caps, the combined cap and unused reserve", async () => {
    const data = funding(); data.evidence.externalSpentMicrousd.runtimeDev = 15_000_000;
    await connection.db.insert(fundingRecords).values({ id: "active", evidence: data });
    await expect(reserveModelRequest(connection, { id: "cap", bucket: "runtimeDev", bodyBytes: 1000, now })).rejects.toMatchObject({ code: "BUCKET_CAP_REACHED" });
    await connection.db.delete(fundingRecords);
    data.evidence.externalSpentMicrousd.runtimeDev = 0; data.evidence.remainingGrantMicrousd = 30_001_000;
    await connection.db.insert(fundingRecords).values({ id: "active", evidence: data });
    await expect(reserveModelRequest(connection, { id: "reserve", bucket: "runtimeDev", bodyBytes: 1000, now })).rejects.toMatchObject({ code: "NEVER_SPENT_RESERVE_PROTECTED" });
  });
  it("rejects stale funding and preserves unknown cost instead of treating it as zero", async () => {
    await proof();
    await expect(reserveModelRequest(connection, { id: "stale", bucket: "runtimeDev", bodyBytes: 1000, now: now + 16 * 60_000 })).rejects.toMatchObject({ code: "FUNDING_EXPIRED_STALE_OR_UNRECONCILED" });
    await reserveModelRequest(connection, { id: "usage", bucket: "runtimeDev", bodyBytes: 1000, now });
    await expect(settleModelRequest(connection, "usage", { input_tokens: -1, output_tokens: 20 })).rejects.toMatchObject({ code: "MISSING_OR_INVALID_USAGE" });
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("serializes concurrent reservations at the bucket boundary", async () => {
    const reserve = worstCaseMicrousd(1000); const data = funding(); data.evidence.externalSpentMicrousd.runtimeDev = 15_000_000 - reserve;
    await connection.db.insert(fundingRecords).values({ id: "active", evidence: data });
    const results = await Promise.allSettled(["a", "b"].map((id) => reserveModelRequest(connection, { id, bucket: "runtimeDev", bodyBytes: 1000, now })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await connection.db.select().from(ledgerEntries)).toHaveLength(1);
  });
  it("cannot reserve against the protected reserve or an oversized/multimedia request", async () => {
    await proof();
    await expect(reserveModelRequest(connection, { id: "x", bucket: "reserve" as "runtimeDev", bodyBytes: 1000, now })).rejects.toMatchObject({ code: "INVALID_RESERVATION_SCOPE" });
    expect(() => worstCaseMicrousd(65_537)).toThrow("REQUEST_SIZE_BOUND");
    const fetcher = vi.fn<typeof fetch>();
    await expect(send(fetcher, { body: { ...request(), max_output_tokens: 100_000 } })).rejects.toMatchObject({ code: "INVALID_OR_UNBOUNDED_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
