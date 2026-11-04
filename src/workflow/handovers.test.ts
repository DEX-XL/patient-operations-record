import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { newAgentState } from "@/agent/protocol";
import { connectDatabase, type DatabaseConnection } from "@/db/client";
import { agentRuns, auditEntries, encounters, ledgerEntries, replayEvents, replaySessions } from "@/db/schema";
import { ReplayStore } from "@/db/replay-store";
import { newClock } from "@/replay/clock";
import { persistSyntheticHandover } from "./handovers";

describe("persistent synthetic staff handovers", () => {
  let connection: DatabaseConnection;
  let databaseUrl: string;
  const now = Date.parse("2026-11-04T20:00:00.000Z");
  const input = (overrides: Record<string, unknown> = {}) => ({ synthetic: true, encounterId: "E-201", actorId: "rn-charge", expectedVersion: 0, commandId: randomUUID(), text: "Blood culture final pending. Confirm existing PCP follow-up arrangement.", ...overrides });
  const graph = async () => (await connection.db.select().from(encounters).where(eq(encounters.id, "E-201")))[0].snapshot;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Run pnpm test so database cleanup follows worker exit.");
    const directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "handover-"));
    databaseUrl = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
    connection = connectDatabase(databaseUrl);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    await new ReplayStore(connection).state(now);
  });
  afterEach(() => connection?.client.close());

  it("persists an unsigned note, timeline event, version and audit without creating work or trusted clinical facts", async () => {
    const before = await graph(), command = input();
    await connection.db.insert(ledgerEntries).values({ id: "budget-sentinel", bucket: "runtimeDev", reservedMicrousd: 123, actualMicrousd: 100, state: "settled", createdAt: new Date(now).toISOString() });
    const [beforeSession] = await connection.db.select().from(replaySessions).where(eq(replaySessions.id, "UNIT-A"));
    const result = await persistSyntheticHandover(connection, command, now);
    expect(result).toMatchObject({ synthetic: true, mode: "SIMULATED EVENT", version: 1, created: true });
    const after = await graph(), note = after.sources.find((source) => source.id === result.sourceId)!;
    expect(note).toMatchObject({ kind: "note_span", status: "unsigned", text: command.text, statements: [] });
    expect(after.tasks).toEqual(before.tasks); expect(after.dependencies).toEqual(before.dependencies); expect(after.drafts).toEqual(before.drafts);
    expect(after.findings).toEqual(before.findings); expect(after.projects).toEqual(before.projects);
    const events = await connection.db.select().from(replayEvents);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ epoch: beforeSession.epoch, encounterId: "E-201", body: { id: result.sourceId, type: "signout", trigger: false, status: "unsigned" } });
    expect((await connection.db.select().from(replaySessions).where(eq(replaySessions.id, "UNIT-A")))[0]).toEqual(beforeSession);
    expect(await connection.db.select().from(ledgerEntries)).toHaveLength(1);
    const audit = await connection.db.select().from(auditEntries);
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actorId: "rn-charge", action: "record_synthetic_handover", version: 1, previousHash: "GENESIS" });
    expect(JSON.stringify(audit)).not.toContain(command.text);
  });

  it("retries the same command idempotently even with its old expected version", async () => {
    const command = input();
    const first = await persistSyntheticHandover(connection, command, now);
    expect(await persistSyntheticHandover(connection, command, now + 1)).toEqual({ ...first, created: false });
    expect((await graph()).version).toBe(1);
    expect(await connection.db.select().from(replayEvents)).toHaveLength(1);
    expect(await connection.db.select().from(auditEntries)).toHaveLength(1);
  });

  it("rejects a changed payload using the same command identity", async () => {
    const command = input(); await persistSyntheticHandover(connection, command, now);
    await expect(persistSyntheticHandover(connection, { ...command, text: "Different synthetic handover." }, now)).rejects.toMatchObject({ code: "HANDOVER_COMMAND_CONFLICT" });
    expect((await graph()).version).toBe(1); expect(await connection.db.select().from(auditEntries)).toHaveLength(1);
  });

  it("rejects a stale new command without modifying the record", async () => {
    await persistSyntheticHandover(connection, input(), now);
    await expect(persistSyntheticHandover(connection, input(), now)).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect((await graph()).version).toBe(1); expect(await connection.db.select().from(replayEvents)).toHaveLength(1);
  });

  it("requires the exact unit session and never borrows an unrelated one", async () => {
    await connection.db.delete(replaySessions).where(eq(replaySessions.id, "UNIT-A"));
    await connection.db.insert(replaySessions).values({ id: "UNIT-B", epoch: 20, clock: newClock(2026, now) });
    await expect(persistSyntheticHandover(connection, input(), now)).rejects.toMatchObject({ code: "LOAD_PATIENT_FIRST" });
    expect((await graph()).version).toBe(0); expect(await connection.db.select().from(replayEvents)).toHaveLength(0);
  });

  it("blocks writes while the replay is playing, including idempotent repeats", async () => {
    const command = input(); await persistSyntheticHandover(connection, command, now);
    await connection.db.update(replaySessions).set({ clock: { ...newClock(2026, now), playing: true } }).where(eq(replaySessions.id, "UNIT-A"));
    await expect(persistSyntheticHandover(connection, command, now)).rejects.toMatchObject({ code: "PAUSE_REPLAY_FIRST" });
    expect((await graph()).version).toBe(1);
  });

  it.each(["ready", "calling"])("blocks input while a %s agent owns the unit", async (status) => {
    await connection.db.insert(agentRuns).values({ id: randomUUID(), encounterId: "E-201", actorId: "rn-charge", unitId: "UNIT-A", baseVersion: 0, mode: "LIVE META", status, state: newAgentState({ synthetic: true }, now), actions: [], createdAt: now });
    await expect(persistSyntheticHandover(connection, input(), now)).rejects.toMatchObject({ code: "CLOCK_LOCKED_DURING_AGENT_RUN" });
    expect((await graph()).version).toBe(0); expect(await connection.db.select().from(auditEntries)).toHaveLength(0);
  });

  it("does not let a mismatched encounter snapshot bypass assignment", async () => {
    const original = await graph();
    await connection.db.update(encounters).set({ snapshot: { ...original, unitId: "UNIT-B" } }).where(eq(encounters.id, "E-201"));
    await expect(persistSyntheticHandover(connection, input(), now)).rejects.toMatchObject({ code: "INVALID_ENCOUNTER" });
    expect(await connection.db.select().from(replayEvents)).toHaveLength(0);
  });

  it("rolls back the note and event if the required audit write fails", async () => {
    await connection.client.execute("CREATE TRIGGER fail_handover_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
    await expect(persistSyntheticHandover(connection, input(), now)).rejects.toThrow();
    expect((await graph()).version).toBe(0); expect((await graph()).sources).toHaveLength(0);
    expect(await connection.db.select().from(replayEvents)).toHaveLength(0);
  });

  it("preserves the hash chain across nurse and hospitalist handovers", async () => {
    await persistSyntheticHandover(connection, input(), now);
    await persistSyntheticHandover(connection, input({ actorId: "md-hospitalist", expectedVersion: 1 }), now + 1);
    const rows = (await connection.db.select().from(auditEntries)).sort((a, b) => a.sequence - b.sequence);
    expect(rows).toHaveLength(2); expect(rows[1].previousHash).toBe(rows[0].hash);
    for (const row of rows) {
      const entry = { id: row.id, encounterId: row.encounterId, sequence: row.sequence, proposalId: row.proposalId, actorId: row.actorId, action: row.action, version: row.version, createdAt: row.createdAt, previousHash: row.previousHash };
      expect(createHash("sha256").update(JSON.stringify(entry)).digest("hex")).toBe(row.hash);
    }
  });

  it("persists across a separate database connection", async () => {
    const result = await persistSyntheticHandover(connection, input(), now);
    const reopened = connectDatabase(databaseUrl);
    try { expect((await reopened.db.select().from(encounters).where(eq(encounters.id, "E-201")))[0].snapshot.sources[0].id).toBe(result.sourceId); }
    finally { reopened.client.close(); }
  });

  it("allows only one current-version write through independent concurrent clients", async () => {
    const other = connectDatabase(databaseUrl);
    try {
      const outcomes = await Promise.allSettled([
        persistSyntheticHandover(connection, input(), now),
        persistSyntheticHandover(other, input(), now),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect((await graph()).version).toBe(1);
      expect(await connection.db.select().from(replayEvents)).toHaveLength(1);
      expect(await connection.db.select().from(auditEntries)).toHaveLength(1);
    } finally { other.client.close(); }
  });

  it.each([
    { synthetic: false }, { actorId: "lab-owner" }, { actorId: "cm-owner" }, { encounterId: "E-999" },
    { text: " " }, { text: "x".repeat(2001) }, { commandId: "not-a-uuid" }, { status: "signed" }, { clinicalOrder: "unsupported" },
  ])("rejects invalid or privilege-expanding input %#", async (overrides) => {
    await expect(persistSyntheticHandover(connection, input(overrides), now)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await graph()).version).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1])("rejects invalid timestamps before transaction work (%s)", async (time) => {
    await expect(persistSyntheticHandover(connection, input(), time)).rejects.toMatchObject({ code: "INVALID_TIME" });
  });
});
