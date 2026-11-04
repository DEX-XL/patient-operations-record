// Initial helper drafted by native Muse Code run 6d5fdc87-92ae-4650-a52b-7a306702fd8b; reviewed and corrected in Codex.
import { z } from "zod";
import { OperationsError, OperationsStore } from "@/db/operations";
import { DEMO_ROSTER } from "@/domain/roster";
import { isAssigned } from "@/domain/scope";
import { BLOCKED_PHRASES } from "@/domain/drafts";
import type { Person, Proposal, Task } from "@/domain/types";

export const CoordinationInputSchema = z.object({
  synthetic: z.literal(true),
  encounterId: z.enum(["E-101", "E-201"]),
  actorId: z.enum(["rn-charge", "md-hospitalist"]),
  expectedVersion: z.number().int().nonnegative(),
  commandId: z.string().uuid(),
  projectId: z.string().min(1).max(100),
  sourceId: z.string().min(1).max(100),
  ownerId: z.string().min(1).max(100),
  label: z.string().trim().min(1).max(240),
  plannedMinutes: z.number().int().min(1).max(1440),
  dependsOnTaskId: z.string().min(1).max(100).optional(),
}).strict();

export type CoordinationInput = z.infer<typeof CoordinationInputSchema>;

export const CoordinationCompletionSchema = z.object({
  action: z.literal("complete"),
  synthetic: z.literal(true),
  encounterId: z.enum(["E-101", "E-201"]),
  actorId: z.string().min(1).max(100),
  taskId: z.string().regex(/^coordination:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  expectedVersion: z.number().int().nonnegative(),
  confirmation: z.literal("completed"),
}).strict();

export const CoordinationCommandSchema = z.union([CoordinationInputSchema, CoordinationCompletionSchema]);

const DIRECT_COMMAND = /^(?:start|stop|order|administer|prescribe|diagnose|(?:initiate|begin) treatment|discharge patient|give (?:medication|oxygen|insulin|antibiotic))\b/i;

export async function stageCoordinationTask(
  store: Pick<OperationsStore, "readEncounter" | "stage">,
  candidate: unknown,
  roster: readonly Person[] = DEMO_ROSTER,
) {
  const parsed = CoordinationInputSchema.safeParse(candidate);
  if (!parsed.success) throw new OperationsError("INVALID_COORDINATION_INPUT");
  const input = parsed.data;
  const actor = roster.find((p) => p.id === input.actorId);
  if (!actor || (actor.role !== "charge_rn" && actor.role !== "hospitalist"))
    throw new OperationsError("SCOPE_DENIED");
  const graph = await store.readEncounter(input.encounterId, input.actorId);
  if (!isAssigned(actor, graph) || graph.synthetic !== true)
    throw new OperationsError("SCOPE_DENIED");
  if (graph.version !== input.expectedVersion) throw new OperationsError("STALE_VERSION");
  const project = graph.projects.find((p) => p.id === input.projectId);
  if (!project || project.encounterId !== graph.encounterId)
    throw new OperationsError("EXISTING_PROJECT_REQUIRED");
  const src = graph.sources.find((s) => s.id === input.sourceId);
  const anchor = graph.sources.find((s) => s.id === project.sourceOrderId);
  for (const s of [src, anchor]) {
    if (!s || s.encounterId !== graph.encounterId || !s.visibleTo.includes(actor.role))
      throw new OperationsError("SOURCE_REQUIRED");
  }
  const owner = roster.find((p) => p.id === input.ownerId);
  if (!owner || !isAssigned(owner, graph)) throw new OperationsError("INVALID_OWNER");
  if (input.dependsOnTaskId !== undefined) {
    const dep = graph.tasks.find((t) => t.id === input.dependsOnTaskId);
    if (!dep || dep.encounterId !== graph.encounterId || dep.kind !== "operational")
      throw new OperationsError("INVALID_PREREQUISITE");
  }
  if (BLOCKED_PHRASES.test(input.label) || DIRECT_COMMAND.test(input.label))
    throw new OperationsError("CLINICAL_PHRASE");
  const proposalId = `human-coordination:${input.commandId}`;
  const taskId = `coordination:${input.commandId}`;
  const edgeId = `coordination-dep:${input.commandId}`;
  const task: Task = {
    id: taskId,
    encounterId: graph.encounterId,
    projectId: project.id,
    label: input.label.trim(),
    ownerRole: owner.role,
    ownerId: owner.id,
    state: "proposed",
    plannedMinutes: input.plannedMinutes,
    expectedEvidence: "attestation",
    expectedWindowMinutes: input.plannedMinutes,
    kind: "operational",
    sourceIds: Array.from(new Set([project.sourceOrderId, input.sourceId])),
  };
  const actions: Proposal["actions"] = [{ type: "create_task", task }];
  if (input.dependsOnTaskId !== undefined) actions.push({
    type: "add_dependency",
    dependency: { id: edgeId, from: input.dependsOnTaskId, to: taskId, kind: "finish_to_start" },
  });
  const proposal: Proposal = {
    id: proposalId,
    encounterId: graph.encounterId,
    baseVersion: input.expectedVersion,
    origin: "human",
    actorId: input.actorId,
    actions,
  };
  const result = await store.stage(proposal, { actorId: input.actorId, origin: "human" });
  return { ...result, synthetic: true as const, taskId, mode: "HUMAN PROPOSAL" as const, needsHumanAcceptance: true as const };
}

// Human confirmation is separate from proposal creation, AI inference and clinical events.
// Restrict this new endpoint to coordination tasks created by the helper above.
export async function confirmCoordinationTask(
  store: Pick<OperationsStore, "readEncounter" | "attestTask">,
  candidate: unknown,
  roster: readonly Person[] = DEMO_ROSTER,
) {
  const parsed = CoordinationCompletionSchema.safeParse(candidate);
  if (!parsed.success) throw new OperationsError("INVALID_COORDINATION_INPUT");
  const input = parsed.data;
  const actor = roster.find((person) => person.id === input.actorId);
  if (!actor) throw new OperationsError("SCOPE_DENIED");
  const graph = await store.readEncounter(input.encounterId, input.actorId);
  if (!graph.synthetic || !isAssigned(actor, graph)) throw new OperationsError("SCOPE_DENIED");
  if (graph.version !== input.expectedVersion) throw new OperationsError("STALE_VERSION");
  const task = graph.tasks.find((item) => item.id === input.taskId);
  if (!task || (actor.role !== "charge_rn" && task.ownerId !== actor.id)) throw new OperationsError("SCOPE_DENIED");
  if (task.kind !== "operational" || task.expectedEvidence !== "attestation" || !["ready", "in_progress"].includes(task.state)) {
    throw new OperationsError("HUMAN_CONFIRMATION_NOT_ALLOWED");
  }
  const result = await store.attestTask({ encounterId: input.encounterId, taskId: input.taskId, actorId: input.actorId, expectedVersion: input.expectedVersion });
  return { ...result, synthetic: true as const, mode: "HUMAN CONFIRMATION" as const };
}
