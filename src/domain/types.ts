import { z } from "zod";
import { FINDING_KEYS } from "./findings";

export const RoleSchema = z.enum(["charge_rn", "hospitalist", "lab", "case_management", "surgeon", "radiology", "transport", "or", "pharmacy", "evs"]);
export type Role = z.infer<typeof RoleSchema>;
export const TaskStateSchema = z.enum(["proposed", "open", "blocked", "ready", "in_progress", "done", "stale", "cancelled", "superseded"]);
export type TaskState = z.infer<typeof TaskStateSchema>;
const Id = z.string().min(1).max(100);
export const PersonSchema = z.object({ id: Id, role: RoleSchema, unitId: Id, encounterIds: z.array(Id) }).strict();
export type Person = z.infer<typeof PersonSchema>;
export const SourceSchema = z.object({
  id: Id, encounterId: Id,
  kind: z.enum(["order", "result", "schedule", "adt", "note_span", "attestation", "medication"]),
  status: z.enum(["pending", "preliminary", "final", "signed", "unsigned", "recorded"]),
  text: z.string().max(6000),
  // Statements are deterministic normalized facts, never supplied by the model.
  statements: z.array(z.string().max(1500)),
  visibleTo: z.array(RoleSchema).min(1),
  taskId: Id.optional(),
  subjectId: Id.optional(), occurredAtMs: z.number().int().nonnegative().optional(),
}).strict();
export type Source = z.infer<typeof SourceSchema>;
export const TaskSchema = z.object({
  id: Id, encounterId: Id, projectId: Id, templateStep: Id.optional(),
  label: z.string().min(1).max(240), ownerRole: RoleSchema, ownerId: Id,
  state: TaskStateSchema, plannedMinutes: z.number().int().min(0).max(10080),
  notBeforeMinutes: z.number().int().nonnegative().optional(),
  expectedEvidence: z.enum(["order", "result", "schedule", "adt", "note_span", "attestation", "medication"]),
  expectedWindowMinutes: z.number().int().min(0).max(10080),
  kind: z.enum(["operational", "clinical_gate"]), sourceIds: z.array(Id).min(1),
  completionSourceId: Id.optional(),
}).strict();
export type Task = z.infer<typeof TaskSchema>;
export const DependencySchema = z.object({ id: Id, from: Id, to: Id, kind: z.enum(["finish_to_start", "clinician_gate"]) }).strict();
export type Dependency = z.infer<typeof DependencySchema>;
export const ProjectSchema = z.object({ id: Id, encounterId: Id, kind: z.enum(["lab", "imaging", "or_case", "discharge"]), label: z.string(), sourceOrderId: Id }).strict();
export type MiniProject = z.infer<typeof ProjectSchema>;
export const DraftLineSchema = z.object({ text: z.string().min(1).max(2000), sourceIds: z.array(Id).min(1) }).strict();
export type DraftLine = z.infer<typeof DraftLineSchema>;
export const DraftSchema = z.object({
  id: Id, encounterId: Id, kind: z.enum(["handover", "discharge_pending_tests"]),
  state: z.enum(["draft", "reviewed", "adopted", "signed_in_ehr_simulated", "communicated"]),
  lines: z.array(DraftLineSchema).min(1),
  reviewHistory: z.array(z.object({ actorId: Id, at: z.string(), from: z.string(), to: z.string(), previousLines: z.array(DraftLineSchema), newLines: z.array(DraftLineSchema) }).strict()).optional(),
}).strict();
export type Draft = z.infer<typeof DraftSchema>;
export const FindingSchema = z.object({
  id: Id, encounterId: Id, key: z.enum(FINDING_KEYS), kind: z.enum(["link", "question", "task", "pending_owner"]),
  ownerRole: RoleSchema, ownerId: Id, sourceIds: z.array(Id).min(1), state: z.enum(["open", "answered"]),
}).strict();
export type Finding = z.infer<typeof FindingSchema>;
export const GraphSchema = z.object({
  synthetic: z.literal(true),
  encounterId: Id, patientId: Id, unitId: Id, version: z.number().int().nonnegative(),
  projects: z.array(ProjectSchema), tasks: z.array(TaskSchema), dependencies: z.array(DependencySchema),
  sources: z.array(SourceSchema), drafts: z.array(DraftSchema),
  findings: z.array(FindingSchema),
}).strict();
export type Graph = z.infer<typeof GraphSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_task"), task: TaskSchema }).strict(),
  z.object({ type: z.literal("transition_task"), taskId: Id, state: TaskStateSchema, evidenceSourceId: Id.optional() }).strict(),
  z.object({ type: z.literal("assign_task"), taskId: Id, ownerId: Id, ownerRole: RoleSchema }).strict(),
  z.object({ type: z.literal("add_dependency"), dependency: DependencySchema }).strict(),
  z.object({ type: z.literal("stage_draft"), draft: DraftSchema }).strict(),
  z.object({ type: z.literal("stage_finding"), finding: FindingSchema }).strict(),
]);
export type Action = z.infer<typeof ActionSchema>;
export const ProposalSchema = z.object({
  id: Id, encounterId: Id, baseVersion: z.number().int().nonnegative(),
  origin: z.enum(["model", "rules", "human", "event"]),
  actorId: Id, actions: z.array(ActionSchema).min(1).max(24),
}).strict();
export type Proposal = z.infer<typeof ProposalSchema>;
export type ValidationIssue = { code: string; path: string; message: string };
export type ValidationResult = { ok: true; graph: Graph } | { ok: false; issues: ValidationIssue[] };
