import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase, type DatabaseConnection } from "./client";
import { ReplayStore } from "./replay-store";
import { OperationsStore } from "./operations";
import { DEMO_ROSTER } from "@/domain/roster";
import { encounters, ledgerEntries, replayEvents } from "./schema";
import { criticalPath } from "@/domain/graph";

describe("shared persistent replay", () => {
  let connection: DatabaseConnection;
  let store: ReplayStore;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Use pnpm test");
    const directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "replay-"));
    connection = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    store = new ReplayStore(connection);
  });
  afterEach(() => connection?.client.close());
  it("all four scoped panes come from the same transaction/tick", async () => {
    const state = await store.state(0);
    expect(Object.keys(state.panes)).toEqual(["charge_rn", "hospitalist", "lab", "case_management"]);
    expect(state.tick).toBe(0); expect(state.mode).toBe("SIMULATED EVENT");
    expect(state.panes.charge_rn).toHaveLength(2);
  });
  it("persists events exactly once and pauses before the OR-change event", async () => {
    await store.state(0, 2000); await store.state(0, "play");
    const triggered = await store.state(100_000);
    expect(triggered.clock.pauseReason).toBe("trigger");
    expect(triggered.timeline.at(-1)?.id).toBe("a-proposal-trigger");
    const count = (await connection.db.select().from(replayEvents)).length;
    await store.state(120_000); await store.state(140_000);
    expect(await connection.db.select().from(replayEvents)).toHaveLength(count);
  });
  it("OR rescheduling changes the version/path and rejects an earlier proposal", async () => {
    await store.state(0, 2000); await store.state(0, "play");
    const before = await store.state(100_000);
    const graph = before.panes.charge_rn.find((item) => item.encounterId === "E-101")!;
    const operations = new OperationsStore(connection, DEMO_ROSTER);
    await operations.stage({ id: "before-or-change", encounterId: "E-101", baseVersion: graph.version, origin: "model", actorId: "rn-charge", actions: [{ type: "transition_task", taskId: "a-or:documents", state: "in_progress" }] }, { origin: "model", actorId: "rn-charge" });
    const oldPath = criticalPath(graph.tasks, graph.dependencies).plannedMinutes;
    const after = await store.state(100_001, "step");
    expect(after.timeline.at(-1)?.id).toBe("a-or-moved");
    const updated = after.panes.charge_rn.find((item) => item.encounterId === "E-101")!;
    expect(updated.version).toBeGreaterThan(graph.version);
    expect(criticalPath(updated.tasks, updated.dependencies).plannedMinutes).toBeGreaterThan(oldPath);
    await expect(operations.accept("before-or-change", "rn-charge")).rejects.toMatchObject({ code: "INVALID_PROPOSAL", details: ["STALE_VERSION"] });
  });
  it("reset advances versions and never resets the budget ledger", async () => {
    await store.state(0, "step");
    const previous = await connection.db.select().from(encounters);
    await connection.db.insert(ledgerEntries).values({ id: "keep-budget", bucket: "runtimeDev", reservedMicrousd: 100, state: "uncertain", createdAt: new Date(0).toISOString() });
    const reset = await store.state(100, "reset");
    expect(reset.epoch).toBe(2); expect(reset.clock.cursor).toBe(0);
    expect(reset.panes.charge_rn[0].version).toBeGreaterThan(previous[0].version);
    expect(await connection.db.select().from(ledgerEntries)).toHaveLength(1);
  });
  it("records evidence without inferring final results or silently finishing missing work", async () => {
    await store.state(0, 2000); await store.state(0, "play"); await store.state(100_000);
    await store.state(100_000, "play");
    const state = await store.state(200_000);
    const medical = state.panes.charge_rn.find((item) => item.encounterId === "E-201")!;
    expect(medical.sources.find((source) => source.id === "p-bcx-pre")?.status).toBe("preliminary");
    expect(medical.tasks.find((task) => task.id === "p-bcx:final")?.state).not.toBe("done");
    expect(medical.tasks.some((task) => task.templateStep === "discharge:home_oxygen")).toBe(false);
    expect(state.panes.lab.flatMap((item) => item.sources).some((source) => source.kind === "note_span")).toBe(false);
  });
});
