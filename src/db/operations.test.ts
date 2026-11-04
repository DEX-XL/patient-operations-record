import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase, type DatabaseConnection } from "./client";
import { OperationsStore } from "./operations";
import { testGraph, testProposal, testRoster } from "@/domain/test-fixtures";
import { auditEntries, proposals } from "./schema";

describe("persistent, version-checked apply-once acceptance", () => {
  let directory: string;
  let connection: DatabaseConnection;
  let store: OperationsStore;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Run pnpm test so database cleanup follows worker exit.");
    directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "db-"));
    connection = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    store = new OperationsStore(connection, testRoster);
    await store.seedEncounter(testGraph());
  });
  afterEach(() => {
    connection?.client.close();
    // The Windows native libSQL module can keep handles until worker exit.
    // scripts/test.mjs validates and removes this directory after the child exits.
  });
  const context = { actorId: "md-hospitalist", origin: "model" as const };

  it("stages without changing state, then atomically accepts once", async () => {
    await store.stage(testProposal(), context);
    expect((await store.readEncounter("E-101", "rn-charge")).tasks[0].state).toBe("ready");
    expect(await store.accept("proposal-1", "rn-charge")).toEqual({ proposalId: "proposal-1", applied: true, version: 1 });
    const graph = await store.readEncounter("E-101", "rn-charge");
    expect(graph.version).toBe(1); expect(graph.tasks[0].state).toBe("in_progress");
    await expect(store.accept("proposal-1", "rn-charge")).rejects.toMatchObject({ code: "ALREADY_ACCEPTED" });
    const audit = await connection.db.select().from(auditEntries);
    expect(audit).toHaveLength(1); expect(audit[0].hash).toHaveLength(64); expect(audit[0].previousHash).toBe("GENESIS");
    expect((await store.readEncounter("E-101", "rn-charge")).version).toBe(1);
  });
  it("rejects stale proposals without applying part of a batch", async () => {
    await store.stage(testProposal(), context);
    await store.stage(testProposal({ id: "proposal-old" }), context);
    await store.accept("proposal-1", "rn-charge");
    await expect(store.accept("proposal-old", "rn-charge")).rejects.toMatchObject({ code: "INVALID_PROPOSAL", details: ["STALE_VERSION"] });
    const rows = await connection.db.select().from(proposals);
    expect(rows.find((row) => row.id === "proposal-old")?.status).toBe("staged");
    expect(await connection.db.select().from(auditEntries)).toHaveLength(1);
  });
  it("rejects a duplicate proposal ID and untrusted origin spoofing", async () => {
    await store.stage(testProposal(), context);
    await expect(store.stage(testProposal(), context)).rejects.toMatchObject({ code: "DUPLICATE_PROPOSAL" });
    await expect(store.stage(testProposal({ origin: "human" }), context)).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
    await expect(store.stage(testProposal({ actorId: "rn-charge" }), context)).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
  });
  it("rechecks acceptance role and denies reads outside assignment", async () => {
    await store.stage(testProposal(), context);
    await expect(store.accept("proposal-1", "cm-owner")).rejects.toMatchObject({ details: ["ACCEPT_SCOPE_DENIED"] });
    await expect(store.readEncounter("E-101", "nobody")).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    expect((await store.readEncounter("E-101", "lab-owner")).tasks.map((task) => task.id)).toEqual(["t2"]);
  });
  it("rolls back snapshot, proposal status and audit if the final write fails", async () => {
    await store.stage(testProposal(), context);
    await connection.client.execute("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
    await expect(store.accept("proposal-1", "rn-charge")).rejects.toThrow();
    expect((await store.readEncounter("E-101", "rn-charge")).version).toBe(0);
    expect((await connection.db.select().from(proposals))[0].status).toBe("staged");
    expect(await connection.db.select().from(auditEntries)).toHaveLength(0);
  });
  it("applies at most once under independent concurrent database clients", async () => {
    await store.stage(testProposal(), context);
    const other = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    try {
      const otherStore = new OperationsStore(other, testRoster);
      const results = await Promise.allSettled([store.accept("proposal-1", "rn-charge"), otherStore.accept("proposal-1", "rn-charge")]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((await store.readEncounter("E-101", "rn-charge")).version).toBe(1);
      expect(await connection.db.select().from(auditEntries)).toHaveLength(1);
    } finally { other.client.close(); }
  });
  it("reopens the SQLite store with accepted data intact", async () => {
    await store.stage(testProposal(), context); await store.accept("proposal-1", "rn-charge");
    const reopened = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    try { expect((await new OperationsStore(reopened, testRoster).readEncounter("E-101", "rn-charge")).version).toBe(1); }
    finally { reopened.client.close(); }
  });
  it("rejects non-synthetic initial data", async () => {
    await expect(store.seedEncounter({ ...testGraph(), synthetic: false } as unknown as ReturnType<typeof testGraph>)).rejects.toThrow();
  });
});
