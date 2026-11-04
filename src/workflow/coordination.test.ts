import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { connectDatabase, type DatabaseConnection } from "@/db/client";
import { OperationsStore } from "@/db/operations";
import { proposals } from "@/db/schema";
import { testGraph, testRoster, testTask } from "@/domain/test-fixtures";
import { confirmCoordinationTask, stageCoordinationTask, type CoordinationInput } from "./coordination";

describe("staff-authored coordination attached to existing work", () => {
  let connection: DatabaseConnection;
  let store: OperationsStore;
  let databaseUrl: string;
  function input(overrides: Partial<CoordinationInput> = {}): CoordinationInput {
    return { synthetic: true, encounterId: "E-101", actorId: "rn-charge", expectedVersion: 0, commandId: randomUUID(),
      projectId: "project-lab", sourceId: "note-1#s1", ownerId: "transport-owner", label: "Confirm transport for the existing laboratory booking", plannedMinutes: 10, ...overrides };
  }
  beforeEach(async () => {
    if (!process.env.PATIENT_OPS_TEST_DIR) throw new Error("Run pnpm test so database cleanup follows worker exit.");
    const directory = await mkdtemp(join(process.env.PATIENT_OPS_TEST_DIR, "coordination-"));
    databaseUrl = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
    connection = connectDatabase(databaseUrl);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    store = new OperationsStore(connection, testRoster);
    const graph = testGraph();
    graph.sources.push({ id: "lab-private", encounterId: "E-101", kind: "note_span", status: "unsigned", text: "Synthetic laboratory-only note", statements: [], visibleTo: ["lab"] });
    graph.tasks.push(testTask({ id: "trusted-clinical-gate", label: "Supplied clinician gate", kind: "clinical_gate", state: "blocked" }));
    await store.seedEncounter(graph);
  });
  afterEach(() => { connection?.client.close(); });

  it("persists a human proposal without changing the worklist, then accepts once and survives reconnect", async () => {
    const before = await store.readEncounter("E-101", "rn-charge");
    const result = await stageCoordinationTask(store, input());
    expect(result).toMatchObject({ status: "staged", mode: "HUMAN PROPOSAL", needsHumanAcceptance: true, synthetic: true });
    expect((await store.readEncounter("E-101", "rn-charge")).tasks).toHaveLength(before.tasks.length);
    const [saved] = await connection.db.select().from(proposals);
    expect(saved.body.origin).toBe("human");
    expect(saved.body.actions).toHaveLength(1);
    await store.accept(result.proposalId, "rn-charge");
    const reopened = connectDatabase(databaseUrl);
    try {
      const graph = await new OperationsStore(reopened, testRoster).readEncounter("E-101", "rn-charge");
      expect(graph.version).toBe(1);
      expect(graph.tasks.find((task) => task.id === result.taskId)).toMatchObject({ ownerRole: "transport", ownerId: "transport-owner", state: "ready", expectedEvidence: "attestation", kind: "operational", sourceIds: ["order-1", "note-1#s1"] });
      expect(graph.tasks.find((task) => task.id === result.taskId)?.completionSourceId).toBeUndefined();
      expect(graph.sources).toEqual(before.sources);
    } finally { reopened.client.close(); }
    await expect(store.accept(result.proposalId, "rn-charge")).rejects.toMatchObject({ code: "ALREADY_ACCEPTED" });
  });

  it("keeps the new task blocked until its recorded operational prerequisite is confirmed", async () => {
    const result = await stageCoordinationTask(store, input({ dependsOnTaskId: "t1" }));
    await store.accept(result.proposalId, "rn-charge");
    expect((await store.readEncounter("E-101", "rn-charge")).tasks.find((task) => task.id === result.taskId)?.state).toBe("blocked");
    await expect(store.attestTask({ encounterId: "E-101", taskId: result.taskId, actorId: "rn-charge", expectedVersion: 1 })).rejects.toMatchObject({ code: "HUMAN_CONFIRMATION_NOT_ALLOWED" });
    await store.attestTask({ encounterId: "E-101", taskId: "t1", actorId: "rn-charge", expectedVersion: 1 });
    const ready = await store.readEncounter("E-101", "rn-charge");
    expect(ready.tasks.find((task) => task.id === result.taskId)?.state).toBe("ready");
    expect(ready.dependencies.some((edge) => edge.from === "t1" && edge.to === result.taskId && edge.kind === "finish_to_start")).toBe(true);
    await store.attestTask({ encounterId: "E-101", taskId: result.taskId, actorId: "transport-owner", expectedVersion: ready.version });
    expect((await store.readEncounter("E-101", "rn-charge")).tasks.find((task) => task.id === result.taskId)?.state).toBe("done");
  });

  it.each(["lab-owner", "rad-owner", "pharmacy-owner", "or-owner", "transport-owner", "evs-owner", "cm-owner"])("derives the assigned department owner server-side for %s", async (ownerId) => {
    const result = await stageCoordinationTask(store, input({ ownerId, sourceId: "order-1" }));
    await store.accept(result.proposalId, "rn-charge");
    const ownerView = await store.readEncounter("E-101", ownerId);
    expect(ownerView.tasks.find((task) => task.id === result.taskId)?.ownerId).toBe(ownerId);
    const [saved] = await connection.db.select().from(proposals);
    const action = saved.body.actions[0];
    expect(action.type === "create_task" && action.task.sourceIds).toEqual(["order-1"]);
    const confirmation = await confirmCoordinationTask(store, { action: "complete", synthetic: true, actorId: ownerId, encounterId: "E-101", taskId: result.taskId, expectedVersion: 1, confirmation: "completed" });
    expect(confirmation).toMatchObject({ version: 2, mode: "HUMAN CONFIRMATION" });
    const completed = (await store.readEncounter("E-101", ownerId)).tasks.find((task) => task.id === result.taskId);
    expect(completed?.state).toBe("done");
    expect(completed?.completionSourceId).toMatch(/^human-/);
  });

  it("rejects completion by a different department or a stale record; Charge RN can explicitly confirm", async () => {
    const task = await stageCoordinationTask(store, input());
    await store.accept(task.proposalId, "rn-charge");
    const command = { action: "complete", synthetic: true, actorId: "transport-owner", encounterId: "E-101", taskId: task.taskId, expectedVersion: 1, confirmation: "completed" };
    await expect(confirmCoordinationTask(store, { ...command, actorId: "lab-owner" })).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    await expect(confirmCoordinationTask(store, { ...command, expectedVersion: 0 })).rejects.toMatchObject({ code: "STALE_VERSION" });
    await confirmCoordinationTask(store, { ...command, actorId: "rn-charge" });
    await expect(confirmCoordinationTask(store, { ...command, expectedVersion: 2 })).rejects.toMatchObject({ code: "HUMAN_CONFIRMATION_NOT_ALLOWED" });
  });

  it("does not let the coordination endpoint complete an existing result-backed task", async () => {
    const id = `coordination:${randomUUID()}`;
    await store.stage({ id: `human-test:${randomUUID()}`, encounterId: "E-101", baseVersion: 0, origin: "human", actorId: "rn-charge", actions: [{ type: "create_task", task: testTask({ id, state: "proposed", expectedEvidence: "result", ownerRole: "lab", ownerId: "lab-owner" }) }] }, { actorId: "rn-charge", origin: "human" }).then((proposal) => store.accept(proposal.proposalId, "rn-charge"));
    await expect(confirmCoordinationTask(store, { action: "complete", synthetic: true, actorId: "lab-owner", encounterId: "E-101", taskId: id, expectedVersion: 1, confirmation: "completed" })).rejects.toMatchObject({ code: "HUMAN_CONFIRMATION_NOT_ALLOWED" });
  });

  it.each([
    { taskId: "t1" }, { confirmation: "yes" }, { synthetic: false }, { origin: "model" },
  ])("requires explicit confirmation and a new coordination task ID %j", async (override) => {
    await expect(confirmCoordinationTask(store, { action: "complete", synthetic: true, actorId: "rn-charge", encounterId: "E-101", taskId: `coordination:${randomUUID()}`, expectedVersion: 0, confirmation: "completed", ...override })).rejects.toMatchObject({ code: "INVALID_COORDINATION_INPUT" });
  });

  it("allows a hospitalist to propose but preserves the nurse/owner acceptance scope", async () => {
    const result = await stageCoordinationTask(store, input({ actorId: "md-hospitalist", ownerId: "cm-owner" }));
    await expect(store.accept(result.proposalId, "md-hospitalist")).rejects.toMatchObject({ details: ["ACCEPT_SCOPE_DENIED"] });
    expect(await store.accept(result.proposalId, "rn-charge")).toMatchObject({ applied: true });
  });

  it("rejects an existing roster owner who is not assigned to this encounter", async () => {
    const graph = testGraph();
    graph.encounterId = "E-201"; graph.patientId = "P-201";
    graph.projects.forEach((project) => { project.encounterId = "E-201"; });
    graph.tasks.forEach((task) => { task.encounterId = "E-201"; });
    graph.sources.forEach((source) => { source.encounterId = "E-201"; });
    await store.seedEncounter(graph);
    await expect(stageCoordinationTask(store, input({ encounterId: "E-201", ownerId: "or-owner" }))).rejects.toMatchObject({ code: "INVALID_OWNER" });
    expect(await connection.db.select().from(proposals)).toHaveLength(0);
  });

  it("rejects repeat command IDs without adding a second proposal", async () => {
    const command = input();
    await stageCoordinationTask(store, command);
    await expect(stageCoordinationTask(store, command)).rejects.toMatchObject({ code: "DUPLICATE_PROPOSAL" });
    expect(await connection.db.select().from(proposals)).toHaveLength(1);
  });

  it("rejects stale input and stale acceptance without changing the record", async () => {
    await expect(stageCoordinationTask(store, input({ expectedVersion: 99 }))).rejects.toMatchObject({ code: "STALE_VERSION" });
    const first = await stageCoordinationTask(store, input());
    const second = await stageCoordinationTask(store, input({ label: "Check the existing receiving-team acknowledgment" }));
    await store.accept(first.proposalId, "rn-charge");
    await expect(store.accept(second.proposalId, "rn-charge")).rejects.toMatchObject({ details: ["STALE_VERSION"] });
    expect((await store.readEncounter("E-101", "rn-charge")).version).toBe(1);
  });

  it.each([
    [{ sourceId: "lab-private" }, "SOURCE_REQUIRED"],
    [{ sourceId: "unknown-source" }, "SOURCE_REQUIRED"],
    [{ projectId: "new-prescription" }, "EXISTING_PROJECT_REQUIRED"],
    [{ ownerId: "unassigned-person" }, "INVALID_OWNER"],
    [{ dependsOnTaskId: "unknown-task" }, "INVALID_PREREQUISITE"],
    [{ dependsOnTaskId: "trusted-clinical-gate" }, "INVALID_PREREQUISITE"],
  ] as const)("rejects invalid source/project/owner/dependency %j", async (override, code) => {
    await expect(stageCoordinationTask(store, input(override))).rejects.toMatchObject({ code });
    expect(await connection.db.select().from(proposals)).toHaveLength(0);
  });

  it.each(["Start oxygen", "Order a new MRI", "Administer medication", "Initiate treatment", "Prescribe treatment", "Discharge patient now", "Recommend a dose"])("blocks direct clinical instruction: %s", async (label) => {
    await expect(stageCoordinationTask(store, input({ label }))).rejects.toMatchObject({ code: "CLINICAL_PHRASE" });
    expect(await connection.db.select().from(proposals)).toHaveLength(0);
  });

  it.each([
    { synthetic: false }, { actorId: "cm-owner" }, { state: "done" }, { ownerRole: "pharmacy" },
    { label: " " }, { label: "x".repeat(241) }, { plannedMinutes: 0 }, { plannedMinutes: 1441 },
    { commandId: "not-a-uuid" },
  ])("strictly rejects unauthorized or out-of-bounds input %j", async (override) => {
    await expect(stageCoordinationTask(store, { ...input(), ...override })).rejects.toMatchObject({ code: "INVALID_COORDINATION_INPUT" });
    expect(await connection.db.select().from(proposals)).toHaveLength(0);
  });
});
