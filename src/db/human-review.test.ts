import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase, type DatabaseConnection } from "./client";
import { OperationsStore } from "./operations";
import { testGraph, testProposal, testRoster } from "@/domain/test-fixtures";
import { auditEntries } from "./schema";

describe("human review and operational attestation", () => {
  let connection: DatabaseConnection; let store: OperationsStore;
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Use pnpm test");
    const directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "human-"));
    connection = connectDatabase(`file:${join(directory, "test.db").replaceAll("\\", "/")}`);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    store = new OperationsStore(connection, testRoster); await store.seedEncounter(testGraph());
  });
  afterEach(() => connection?.client.close());
  it("only lets a responsible human attest eligible operational work", async () => {
    await expect(store.attestTask({ encounterId: "E-101", taskId: "t1", actorId: "lab-owner", expectedVersion: 0 })).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    const result = await store.attestTask({ encounterId: "E-101", taskId: "t1", actorId: "md-hospitalist", expectedVersion: 0 });
    const graph = await store.readEncounter("E-101", "rn-charge");
    expect(graph.tasks[0]).toMatchObject({ state: "done", completionSourceId: result.evidenceSourceId });
    expect(graph.sources.some((source) => source.id === result.evidenceSourceId && source.kind === "attestation")).toBe(true);
    await expect(store.attestTask({ encounterId: "E-101", taskId: "t2", actorId: "lab-owner", expectedVersion: 1 })).rejects.toMatchObject({ code: "HUMAN_CONFIRMATION_NOT_ALLOWED" });
  });
  it("keeps cited draft edits, reviewer identity and lifecycle without writing an EHR note", async () => {
    const proposal = testProposal({ actions: [{ type: "stage_draft", draft: { id: "draft-review", encounterId: "E-101", kind: "handover", state: "draft", lines: [{ text: "Blood culture preliminary; final result pending.", sourceIds: ["result-pre"] }] } }] });
    await store.stage(proposal, { actorId: "md-hospitalist", origin: "model" }); await store.accept(proposal.id, "rn-charge");
    await expect(store.reviewDraft({ encounterId: "E-101", draftId: "draft-review", actorId: "lab-owner", expectedVersion: 1, target: "reviewed" })).rejects.toMatchObject({ code: "DRAFT_SCOPE_DENIED" });
    await expect(store.reviewDraft({ encounterId: "E-101", draftId: "draft-review", actorId: "md-hospitalist", expectedVersion: 1, target: "communicated" })).rejects.toMatchObject({ code: "ILLEGAL_DRAFT_TRANSITION" });
    await store.reviewDraft({ encounterId: "E-101", draftId: "draft-review", actorId: "md-hospitalist", expectedVersion: 1, target: "reviewed" });
    const draft = (await store.readEncounter("E-101", "md-hospitalist")).drafts[0];
    expect(draft.state).toBe("reviewed"); expect(draft.reviewHistory?.[0].actorId).toBe("md-hospitalist");
    expect(draft.reviewHistory?.[0].previousLines).toEqual(draft.reviewHistory?.[0].newLines);
    await expect(store.reviewDraft({ encounterId: "E-101", draftId: "draft-review", actorId: "md-hospitalist", expectedVersion: 2, target: "reviewed", lines: [{ text: "Safe for discharge.", sourceIds: ["result-pre"] }] })).rejects.toMatchObject({ code: "INVALID_DRAFT" });
    await store.reviewDraft({ encounterId: "E-101", draftId: "draft-review", actorId: "md-hospitalist", expectedVersion: 2, target: "adopted" });
    await store.reviewDraft({ encounterId: "E-101", draftId: "draft-review", actorId: "md-hospitalist", expectedVersion: 3, target: "signed_in_ehr_simulated" });
    expect((await store.readEncounter("E-101", "md-hospitalist")).drafts[0].state).toBe("signed_in_ehr_simulated");
  });
  it("links audit entries in sequence when multiple actions share an encounter version", async () => {
    await store.stage(testProposal(), { actorId: "md-hospitalist", origin: "model" }); await store.reject("proposal-1", "rn-charge");
    await store.stage(testProposal({ id: "proposal-2" }), { actorId: "md-hospitalist", origin: "model" }); await store.reject("proposal-2", "rn-charge");
    const audit = await connection.db.select().from(auditEntries);
    expect(audit.map((entry) => entry.sequence)).toEqual([1, 2]); expect(audit[1].previousHash).toBe(audit[0].hash);
    expect((await store.readEncounter("E-101", "rn-charge")).version).toBe(0);
  });
});
