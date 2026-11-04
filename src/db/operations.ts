import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DatabaseConnection } from "./client";
import { patients, encounters, proposals, auditEntries } from "./schema";
import { DraftLineSchema, GraphSchema, ProposalSchema, type Draft, type DraftLine, type Graph, type Person, type Proposal } from "@/domain/types";
import { validateProposal } from "@/domain/validator";
import { isAssigned, mayManageTask, scopedGraph } from "@/domain/scope";
import { prerequisitesDone, topologicalOrder } from "@/domain/graph";
import { validateDraftLines } from "@/domain/drafts";

type WriteTransaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];
async function appendAudit(tx: WriteTransaction, input: { encounterId: string; proposalId?: string; actorId: string; action: string; version: number }) {
  const [previous] = await tx.select().from(auditEntries).where(eq(auditEntries.encounterId, input.encounterId)).orderBy(desc(auditEntries.sequence)).limit(1);
  const entry = { id: randomUUID(), encounterId: input.encounterId, sequence: (previous?.sequence ?? 0) + 1, proposalId: input.proposalId ?? null, actorId: input.actorId, action: input.action, version: input.version, createdAt: new Date().toISOString(), previousHash: previous?.hash ?? "GENESIS" };
  await tx.insert(auditEntries).values({ ...entry, hash: createHash("sha256").update(JSON.stringify(entry)).digest("hex") });
}

type OriginContext = { actorId: string; origin: Proposal["origin"] };
export class OperationsError extends Error {
  constructor(public readonly code: string, public readonly details: string[] = []) { super(code); }
}
export class OperationsStore {
  constructor(private connection: DatabaseConnection, private roster: readonly Person[]) {}

  private actor(id: string) {
    const actor = this.roster.find((person) => person.id === id);
    if (!actor) throw new OperationsError("SCOPE_DENIED");
    return actor;
  }
  // B3's trusted synthetic event ingestion will use this initialization path.
  // Never expose it as a model tool or a public route.
  async seedEncounter(candidate: Graph) {
    const graph = GraphSchema.parse(candidate);
    topologicalOrder(graph.tasks, graph.dependencies);
    await this.connection.db.transaction(async (tx) => {
      await tx.insert(patients).values({ id: graph.patientId, syntheticLabel: `Synthetic ${graph.patientId}` }).onConflictDoNothing();
      await tx.insert(encounters).values({ id: graph.encounterId, patientId: graph.patientId, unitId: graph.unitId, version: graph.version, snapshot: graph });
    });
  }
  async readEncounter(encounterId: string, actorId: string) {
    const actor = this.actor(actorId);
    const row = await this.connection.db.query.encounters.findFirst({ where: eq(encounters.id, encounterId) });
    if (!row || !isAssigned(actor, row.snapshot)) throw new OperationsError("SCOPE_DENIED");
    return scopedGraph(row.snapshot, actor);
  }
  async stage(candidate: unknown, context: OriginContext) {
    const parsed = ProposalSchema.safeParse(candidate);
    if (!parsed.success) throw new OperationsError("INVALID_PROPOSAL", ["SCHEMA"]);
    const proposal = parsed.data;
    // Context is server-owned. A model cannot claim to be a human or an event.
    if (proposal.actorId !== context.actorId || proposal.origin !== context.origin) throw new OperationsError("ORIGIN_MISMATCH");
    const actor = this.actor(context.actorId);
    return this.connection.db.transaction(async (tx) => {
      const [row] = await tx.select().from(encounters).where(eq(encounters.id, proposal.encounterId));
      if (!row || !isAssigned(actor, row.snapshot)) throw new OperationsError("SCOPE_DENIED");
      const result = validateProposal(row.snapshot, proposal, this.roster);
      if (!result.ok) throw new OperationsError("INVALID_PROPOSAL", result.issues.map((issue) => issue.code));
      const [existing] = await tx.select().from(proposals).where(eq(proposals.id, proposal.id));
      if (existing) throw new OperationsError("DUPLICATE_PROPOSAL");
      await tx.insert(proposals).values({ id: proposal.id, encounterId: proposal.encounterId, baseVersion: proposal.baseVersion, status: "staged", body: proposal });
      return { proposalId: proposal.id, status: "staged" as const, baseVersion: proposal.baseVersion };
    });
  }
  async accept(proposalId: string, actorId: string) {
    const actor = this.actor(actorId);
    // libSQL defaults transactions to write mode (BEGIN IMMEDIATE locally).
    // Drizzle commits/rolls back the entire callback, including the audit entry.
    return this.connection.db.transaction(async (tx) => {
      const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, proposalId));
      if (!proposal) throw new OperationsError("UNKNOWN_PROPOSAL");
      const [row] = await tx.select().from(encounters).where(eq(encounters.id, proposal.encounterId));
      if (!row || !isAssigned(actor, row.snapshot)) throw new OperationsError("SCOPE_DENIED");
      if (proposal.status === "accepted") throw new OperationsError("ALREADY_ACCEPTED");
      if (proposal.status !== "staged") throw new OperationsError("PROPOSAL_NOT_STAGED");
      const validation = validateProposal(row.snapshot, proposal.body, this.roster, actor);
      if (!validation.ok) throw new OperationsError("INVALID_PROPOSAL", validation.issues.map((issue) => issue.code));
      const version = row.version + 1;
      const snapshot = { ...validation.graph, version };
      for (const action of proposal.body.actions) {
        if (action.type === "create_task") {
          const task = snapshot.tasks.find((item) => item.id === action.task.id)!;
          if (task.state === "proposed" || task.state === "open") task.state = prerequisitesDone(task.id, snapshot.tasks, snapshot.dependencies) ? "ready" : "blocked";
        }
        if (action.type === "stage_finding" && action.finding.kind === "pending_owner") {
          const finding = action.finding;
          const id = `${snapshot.encounterId}:${finding.key}:owner`;
          const subject = finding.key === "blood_culture_pending" ? "blood culture" : finding.key === "pathology_pending" ? "surgical pathology" : "existing referral";
          const text = `Follow-up owner for ${subject}: ${finding.ownerRole}.`;
          if (!snapshot.sources.some((source) => source.id === id)) snapshot.sources.push({ id, encounterId: snapshot.encounterId, kind: "attestation", status: "recorded", text, statements: [text], visibleTo: [...new Set(["charge_rn" as const, "hospitalist" as const, "surgeon" as const, finding.ownerRole])] });
        }
      }
      const updated = await tx.update(encounters).set({ version, snapshot }).where(and(eq(encounters.id, row.id), eq(encounters.version, proposal.baseVersion))).returning({ id: encounters.id });
      if (updated.length !== 1) throw new OperationsError("STALE_VERSION");
      await tx.update(proposals).set({ status: "accepted", acceptedBy: actorId, acceptedVersion: version }).where(and(eq(proposals.id, proposalId), eq(proposals.status, "staged")));
      await appendAudit(tx, { encounterId: row.id, proposalId, actorId, action: "accept_proposal", version });
      return { proposalId, version, applied: true as const };
    });
  }
  async reject(proposalId: string, actorId: string) {
    const actor = this.actor(actorId);
    return this.connection.db.transaction(async (tx) => {
      const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, proposalId));
      if (!proposal || proposal.status !== "staged") throw new OperationsError("PROPOSAL_NOT_STAGED");
      const [row] = await tx.select().from(encounters).where(eq(encounters.id, proposal.encounterId));
      if (!row || !isAssigned(actor, row.snapshot) || actor.role !== "charge_rn" && actor.id !== proposal.body.actorId) throw new OperationsError("SCOPE_DENIED");
      await tx.update(proposals).set({ status: "rejected" }).where(eq(proposals.id, proposalId));
      await appendAudit(tx, { encounterId: row.id, proposalId, actorId, action: "reject_proposal", version: row.version });
      return { proposalId, rejected: true };
    });
  }
  async reviewDraft(input: { encounterId: string; draftId: string; actorId: string; expectedVersion: number; target: Draft["state"]; lines?: DraftLine[] }) {
    const actor = this.actor(input.actorId);
    if (!["charge_rn", "hospitalist", "surgeon"].includes(actor.role)) throw new OperationsError("DRAFT_SCOPE_DENIED");
    return this.connection.db.transaction(async (tx) => {
      const [row] = await tx.select().from(encounters).where(eq(encounters.id, input.encounterId));
      if (!row || !isAssigned(actor, row.snapshot)) throw new OperationsError("SCOPE_DENIED");
      if (row.version !== input.expectedVersion) throw new OperationsError("STALE_VERSION");
      const graph = structuredClone(row.snapshot); const draft = graph.drafts.find((item) => item.id === input.draftId);
      if (!draft) throw new OperationsError("UNKNOWN_DRAFT");
      const sequence: Draft["state"][] = ["draft", "reviewed", "adopted", "signed_in_ehr_simulated", "communicated"];
      const reReview = input.target === "reviewed" && draft.state !== "communicated";
      if (!reReview && sequence.indexOf(input.target) !== sequence.indexOf(draft.state) + 1) throw new OperationsError("ILLEGAL_DRAFT_TRANSITION");
      if (input.lines && input.target !== "reviewed") throw new OperationsError("EDIT_REQUIRES_REVIEW");
      const lines = input.lines?.map((line) => DraftLineSchema.parse(line)) ?? draft.lines;
      const validation = validateDraftLines(lines, scopedGraph(graph, actor).sources);
      if (validation.length) throw new OperationsError("INVALID_DRAFT", validation.map((issue) => issue.code));
      draft.reviewHistory = [...(draft.reviewHistory ?? []), { actorId: actor.id, at: new Date().toISOString(), from: draft.state, to: input.target, previousLines: structuredClone(draft.lines), newLines: structuredClone(lines) }];
      draft.lines = lines; draft.state = input.target; graph.version++;
      await tx.update(encounters).set({ version: graph.version, snapshot: graph }).where(eq(encounters.id, row.id));
      await appendAudit(tx, { encounterId: row.id, actorId: actor.id, action: `draft_${input.target}`, version: graph.version });
      return { draftId: draft.id, state: draft.state, version: graph.version };
    });
  }
  async attestTask(input: { encounterId: string; taskId: string; actorId: string; expectedVersion: number }) {
    const actor = this.actor(input.actorId);
    return this.connection.db.transaction(async (tx) => {
      const [row] = await tx.select().from(encounters).where(eq(encounters.id, input.encounterId));
      if (!row || !isAssigned(actor, row.snapshot)) throw new OperationsError("SCOPE_DENIED");
      if (row.version !== input.expectedVersion) throw new OperationsError("STALE_VERSION");
      const graph = structuredClone(row.snapshot); const task = graph.tasks.find((item) => item.id === input.taskId);
      if (!task || !mayManageTask(actor, task.ownerRole)) throw new OperationsError("SCOPE_DENIED");
      if (task.kind !== "operational" || task.expectedEvidence !== "attestation" || !["ready", "in_progress"].includes(task.state) || !prerequisitesDone(task.id, graph.tasks, graph.dependencies)) throw new OperationsError("HUMAN_CONFIRMATION_NOT_ALLOWED");
      const id = `human-${randomUUID()}`; const text = `${task.label}: completion attested by ${actor.role}.`;
      graph.sources.push({ id, encounterId: row.id, kind: "attestation", status: "recorded", taskId: task.id, text, statements: [text], visibleTo: [...new Set([actor.role, task.ownerRole, "charge_rn" as const, "hospitalist" as const])] });
      task.state = "done"; task.completionSourceId = id;
      for (const item of graph.tasks) if (item.state === "blocked" && prerequisitesDone(item.id, graph.tasks, graph.dependencies)) item.state = "ready";
      graph.version++;
      await tx.update(encounters).set({ version: graph.version, snapshot: graph }).where(eq(encounters.id, row.id));
      await appendAudit(tx, { encounterId: row.id, actorId: actor.id, action: `human_task_attestation:${task.id}`, version: graph.version });
      return { taskId: task.id, version: graph.version, evidenceSourceId: id };
    });
  }
}
