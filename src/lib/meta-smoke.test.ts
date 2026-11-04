import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase, type DatabaseConnection } from "@/db/client";
import { ledgerEntries } from "@/db/schema";
import { executeSmoke, reserveSmoke, SMOKE_ID, SMOKE_REQUEST, type SmokeApproval } from "./meta-smoke";

const now = Date.parse("2026-10-29T20:00:00Z");
function approval(): SmokeApproval {
  return {
    userApproved: true, grantVerifiedAt: new Date(now).toISOString(), grantExpiresAt: "2026-11-05T00:00:00Z",
    remainingGrantMicrousd: 150_000_000,
    externalSpentMicrousd: { museBuild: 0, runtimeDev: 0, heldoutEval: 0, publicDemo: 0 },
    sharedUsageReconciled: true, pricingVerifiedAt: new Date(now).toISOString(),
  };
}
const responseBody = () => ({ id: "resp_unit_test", status: "completed", usage: { input_tokens: 40, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: "SYNTHETIC_CONNECTION_OK" }] }] });
describe("B2 one-call gate (all network mocked)", () => {
  let connection: DatabaseConnection;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Use pnpm test");
    const directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "smoke-"));
    connection = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  afterEach(() => connection?.client.close());
  const run = (fetcher: typeof fetch, changes: Partial<Parameters<typeof executeSmoke>[0]> = {}) => executeSmoke({ connection, approval: approval(), liveEnabled: true, apiKey: "unit-test-placeholder", fetcher, now, ...changes });

  it("reserves before fetch, fixes endpoint/request, and settles known token cost", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.meta.ai/v1/responses");
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(init?.body as string)).toEqual(SMOKE_REQUEST);
      expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("reserved");
      return Response.json(responseBody());
    });
    const report = await run(fetcher);
    expect(report.connectivityOk).toBe(true);
    expect(report.actualMicrousd).toBe(93); // ceil(40*1.25 + 10*4.25)
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [entry] = await connection.db.select().from(ledgerEntries);
    expect(entry).toMatchObject({ id: SMOKE_ID, state: "settled", actualMicrousd: 93 });
    expect(JSON.stringify(report)).not.toContain("unit-test-placeholder");
  });
  it("refuses disabled live mode, absent credentials or absent approval before reservation", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(run(fetcher, { liveEnabled: false })).rejects.toMatchObject({ code: "LIVE_DISABLED" });
    await expect(run(fetcher, { apiKey: undefined })).rejects.toMatchObject({ code: "PROCESS_CREDENTIAL_REQUIRED_NO_DOTENV" });
    await expect(run(fetcher, { approval: { ...approval(), userApproved: false } })).rejects.toMatchObject({ code: "SMOKE_APPROVAL_OR_GRANT_EVIDENCE_MISSING" });
    expect(fetcher).not.toHaveBeenCalled(); expect(await connection.db.select().from(ledgerEntries)).toHaveLength(0);
  });
  it("blocks stale balance, stale price, unknown expiry and unreconciled usage", async () => {
    await expect(reserveSmoke(connection, { ...approval(), grantVerifiedAt: "2026-10-28T20:00:00Z" }, now)).rejects.toMatchObject({ code: "STALE_GRANT_EVIDENCE" });
    await expect(reserveSmoke(connection, { ...approval(), pricingVerifiedAt: "2026-10-20T20:00:00Z" }, now)).rejects.toMatchObject({ code: "STALE_PRICING_EVIDENCE" });
    await expect(reserveSmoke(connection, { ...approval(), grantExpiresAt: undefined }, now)).rejects.toMatchObject({ code: "SMOKE_APPROVAL_OR_GRANT_EVIDENCE_MISSING" });
    await expect(reserveSmoke(connection, { ...approval(), sharedUsageReconciled: false }, now)).rejects.toMatchObject({ code: "SMOKE_APPROVAL_OR_GRANT_EVIDENCE_MISSING" });
  });
  it("protects expiry, the $30 reserve and the runtime-dev bucket", async () => {
    await expect(reserveSmoke(connection, { ...approval(), grantExpiresAt: new Date(now - 1).toISOString() }, now)).rejects.toMatchObject({ code: "GRANT_EXPIRED_OR_TOO_CLOSE" });
    await expect(reserveSmoke(connection, { ...approval(), remainingGrantMicrousd: 30_010_000 }, now)).rejects.toMatchObject({ code: "GRANT_RESERVE_PROTECTED" });
    const exhausted = approval(); exhausted.externalSpentMicrousd.runtimeDev = 14_990_000;
    await expect(reserveSmoke(connection, exhausted, now)).rejects.toMatchObject({ code: "RUNTIME_DEV_CAP_REACHED" });
  });
  it("accepts a fresh explicit user balance confirmation without fabricating an expiry", async () => {
    const proof = { ...approval(), grantExpiresAt: undefined, grantValidityBasis: "current_balance_confirmed_by_user" as const };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(responseBody()));
    expect((await run(fetcher, { approval: proof })).connectivityOk).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(reserveSmoke(connection, { ...proof, grantVerifiedAt: new Date(now - 121 * 60_000).toISOString() }, now)).rejects.toMatchObject({ code: "STALE_GRANT_EVIDENCE" });
    await expect(reserveSmoke(connection, { ...proof, grantExpiresAt: new Date(now - 1).toISOString() }, now)).rejects.toMatchObject({ code: "GRANT_EXPIRED_OR_TOO_CLOSE" });
  });
  it("counts other local uncertain requests against the remaining grant and dev cap", async () => {
    await connection.db.insert(ledgerEntries).values({ id: "prior-uncertain", bucket: "runtimeDev", state: "uncertain", reservedMicrousd: 14_990_000, createdAt: new Date(now).toISOString() });
    await expect(reserveSmoke(connection, approval(), now)).rejects.toMatchObject({ code: "RUNTIME_DEV_CAP_REACHED" });
  });
  it("one authorization cannot be used twice, including concurrent reservations", async () => {
    const results = await Promise.allSettled([reserveSmoke(connection, approval(), now), reserveSmoke(connection, approval(), now)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await connection.db.select().from(ledgerEntries)).toHaveLength(1);
  });
  it("allows one explicitly requested larger verification inside the combined two-cent bound", async () => {
    await expect(reserveSmoke(connection, approval(), now, true)).rejects.toMatchObject({ code: "SMOKE_FOLLOWUP_BOUND" });
    await run(vi.fn<typeof fetch>(async () => Response.json({ ...responseBody(), status: "incomplete" })));
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { expect(JSON.parse(String(init?.body)).max_output_tokens).toBe(1024); return Response.json(responseBody()); });
    const result = await run(fetcher, { followup: true }); expect(result.connectivityOk).toBe(true); expect(result.reservedMicrousd).toBe(10000);
    await expect(run(fetcher, { followup: true })).rejects.toMatchObject({ code: "SMOKE_AUTHORIZATION_ALREADY_USED" }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 402, 429, 500])("retains reservation and never retries HTTP %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("provider payload must not leak", { status }));
    await expect(run(fetcher)).rejects.toMatchObject({ code: `META_HTTP_${status}` });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
    await expect(run(fetcher)).rejects.toMatchObject({ code: "SMOKE_AUTHORIZATION_ALREADY_USED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains reservation after a timeout or malformed response without logging raw errors", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("unit-test-placeholder must not leak"); });
    await expect(run(fetcher)).rejects.toMatchObject({ code: "SMOKE_NETWORK_OR_RESPONSE_FAILURE_RESERVATION_RETAINED" });
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("requires usage, counts reasoning in total output, and refuses oversized output usage", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...responseBody(), usage: { input_tokens: 40, output_tokens: 500 } }));
    await expect(run(fetcher)).rejects.toMatchObject({ code: "UNRECONCILED_RESPONSE_USAGE" });
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("bounds the response body and keeps the reservation on overflow", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("x".repeat(65_537)));
    await expect(run(fetcher)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("does not call an incomplete response a successful smoke", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...responseBody(), status: "incomplete" }));
    expect((await run(fetcher)).connectivityOk).toBe(false);
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("settled");
  });
});
