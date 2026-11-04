import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { connectDatabase, type DatabaseConnection } from "./client";
import { AgentStore } from "./agent-store";
import { ReplayStore } from "./replay-store";
import { agentRuns, fundingRecords, ledgerEntries, proposals } from "./schema";

describe("persisted agent runs and replay isolation (mocked Meta only)", () => {
  let connection: DatabaseConnection;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Use pnpm test");
    const directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "agent-"));
    connection = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    const now = Date.now(); const replay = new ReplayStore(connection);
    await replay.state(now - 200_000, 2000); await replay.state(now - 200_000, "play");
    await replay.state(now - 100_000); await replay.state(now - 100_000, "play"); await replay.state(now);
  });
  afterEach(() => connection?.client.close());
  async function fund() {
    const now = Date.now();
    await connection.db.insert(fundingRecords).values({ id: "active", evidence: { smokePassed: true, runtimeApproved: true, evidence: {
      userApproved: true, grantVerifiedAt: new Date(now).toISOString(), grantExpiresAt: new Date(now + 86_400_000).toISOString(), remainingGrantMicrousd: 150_000_000,
      externalSpentMicrousd: { museBuild: 0, runtimeDev: 0, heldoutEval: 0, publicDemo: 0 }, sharedUsageReconciled: true, pricingVerifiedAt: new Date(now).toISOString(),
    } } });
  }
  const liveEnv = { META_LIVE_ENABLED: "true", MODEL_API_KEY: "unit-test-placeholder" };
  it("runs the same validated rules baseline offline and stages CM work", async () => {
    const fetcher = vi.fn<typeof fetch>(); const store = new AgentStore(connection, {}, fetcher);
    const run = await store.start("E-201", "md-hospitalist", "RULES BASELINE");
    expect(run.mode).toBe("RULES BASELINE"); expect(run.status).toBe("staged"); expect(run.proposalId).toBeTruthy();
    expect(run.costMicrousd).toBe(0); expect(fetcher).not.toHaveBeenCalled();
    const [proposal] = await connection.db.select().from(proposals).where(eq(proposals.id, run.proposalId!));
    expect(proposal.body.actions.some((action) => action.type === "create_task" && action.task.ownerRole === "case_management")).toBe(true);
  });
  it("never silently substitutes baseline or fabricated recordings for live mode", async () => {
    const fetcher = vi.fn<typeof fetch>(); const store = new AgentStore(connection, {}, fetcher);
    const live = await store.start("E-201", "md-hospitalist", "LIVE META");
    expect(live.mode).toBe("UNAVAILABLE"); expect(live.errorCode).toBe("LIVE_DISABLED");
    const recorded = await store.start("E-201", "md-hospitalist", "RECORDED META");
    expect(recorded.mode).toBe("UNAVAILABLE"); expect(recorded.errorCode).toBe("NO_MATCHING_REAL_RECORDING");
    expect(fetcher).not.toHaveBeenCalled(); expect(await connection.db.select().from(ledgerEntries)).toHaveLength(0);
  });
  it("persists one request per step and prevents duplicate polling calls", async () => {
    await fund();
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>(async () => { await wait; return Response.json({ id: "resp_mock", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "No supported changes." }] }], usage: { input_tokens: 80, output_tokens: 10 } }); });
    const store = new AgentStore(connection, liveEnv, fetcher); const run = await store.start("E-201", "md-hospitalist", "LIVE META");
    const first = store.step(run.id);
    while (!fetcher.mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 1));
    const duplicate = await store.step(run.id); expect(duplicate.status).toBe("calling"); release();
    const done = await first; expect(done.status).toBe("complete"); expect(done.requests).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(done)).not.toContain("unit-test-placeholder"); expect(done).not.toHaveProperty("input");
  });
  it("blocks clock mutation while a live run is active and expires abandoned work", async () => {
    await fund(); const store = new AgentStore(connection, liveEnv, vi.fn<typeof fetch>());
    const run = await store.start("E-201", "md-hospitalist", "LIVE META");
    await expect(new ReplayStore(connection).state(Date.now(), "step")).rejects.toThrow("CLOCK_LOCKED_DURING_AGENT_RUN");
    await connection.db.update(agentRuns).set({ createdAt: Date.now() - 180_000 }).where(eq(agentRuns.id, run.id));
    await new ReplayStore(connection).state(Date.now(), "pause");
    expect((await store.get(run.id)).errorCode).toBe("RUN_EXPIRED");
    await expect(new ReplayStore(connection).state(Date.now(), "step")).resolves.toBeTruthy();
  });
  it("does not resume a manually paused clock after offline work", async () => {
    const replay = new ReplayStore(connection); await replay.state(Date.now(), "pause");
    await new AgentStore(connection, {}).start("E-201", "md-hospitalist", "RULES BASELINE");
    expect((await replay.state(Date.now())).clock.playing).toBe(false);
  });
  it("records failed provider attempts and preserves the reservation", async () => {
    await fund(); const fetcher = vi.fn<typeof fetch>(async () => new Response("sensitive error body", { status: 402 }));
    const store = new AgentStore(connection, liveEnv, fetcher); const run = await store.start("E-201", "md-hospitalist", "LIVE META");
    const failed = await store.step(run.id);
    expect(failed).toMatchObject({ status: "failed", errorCode: "META_HTTP_402", requests: 1 });
    expect(JSON.stringify(failed)).not.toContain("sensitive error body");
    expect((await connection.db.select().from(ledgerEntries))[0].state).toBe("uncertain");
  });
  it("reserves local video inference in public-demo rather than development", async () => {
    await fund();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "resp_mock_video", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "No supported changes." }] }], usage: { input_tokens: 80, output_tokens: 10 } }));
    const store = new AgentStore(connection, { ...liveEnv, META_RUNTIME_BUCKET: "publicDemo" }, fetcher);
    const run = await store.start("E-201", "md-hospitalist", "LIVE META");
    expect((await store.step(run.id)).status).toBe("complete");
    expect(await connection.db.select().from(ledgerEntries)).toMatchObject([{ bucket: "publicDemo", state: "settled" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects public bucket redirection before a reservation or request", async () => {
    await fund(); const fetcher = vi.fn<typeof fetch>();
    const store = new AgentStore(connection, { ...liveEnv, VERCEL: "1", META_RUNTIME_BUCKET: "heldoutEval" }, fetcher);
    const run = await store.start("E-201", "md-hospitalist", "LIVE META");
    expect((await store.step(run.id)).errorCode).toBe("PUBLIC_DEPLOYMENT_BUCKET_LOCKED");
    expect(await connection.db.select().from(ledgerEntries)).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
