import { GraphSchema, ProposalSchema, type Graph, type Person, type Proposal, type ValidationIssue, type ValidationResult } from "./types";
import { canTransition } from "./transitions";
import { isAssigned, mayManageTask, mayReadTask } from "./scope";
import { topologicalOrder, prerequisitesDone } from "./graph";
import { BLOCKED_PHRASES, validateDraftLines } from "./drafts";
import { matchesTemplate, TEMPLATES } from "./templates";
import { FINDING_DEFINITIONS, findingSupported } from "./findings";

export function validateProposal(graph: Graph, candidate: unknown, roster: readonly Person[], acceptingActor?: Person): ValidationResult {
  const issues: ValidationIssue[] = [];
  const issue = (code: string, path: string, message = code) => issues.push({ code, path, message });
  const parsed = ProposalSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, issues: [{ code: "SCHEMA", path: "proposal", message: "Proposal does not match the strict schema." }] };
  const proposal: Proposal = parsed.data;
  const actor = roster.find((person) => person.id === proposal.actorId);
  const automated = proposal.origin === "model" || proposal.origin === "rules";
  if (!actor || !isAssigned(actor, graph)) issue("SCOPE_DENIED", "actorId");
  if (acceptingActor && !isAssigned(acceptingActor, graph)) issue("SCOPE_DENIED", "acceptingActor");
  if (proposal.encounterId !== graph.encounterId) issue("WRONG_ENCOUNTER", "encounterId");
  if (proposal.baseVersion !== graph.version) issue("STALE_VERSION", "baseVersion");
  if (issues.length) return { ok: false, issues };
  const next = structuredClone(graph);
  const visibleSources = new Set(graph.sources.filter((source) => source.visibleTo.includes(actor!.role)).map((source) => source.id));
  const touched = new Set<string>();
  for (const [index, action] of proposal.actions.entries()) {
    const path = `actions.${index}`;
    const touchKey = action.type === "create_task" ? `create:${action.task.id}` : action.type === "add_dependency" ? `edge:${action.dependency.id}` : action.type === "stage_draft" ? `draft:${action.draft.id}` : action.type === "stage_finding" ? `finding:${action.finding.id}` : `${action.type}:${action.taskId}`;
    if (touched.has(touchKey)) { issue("DUPLICATE_ACTION", path); continue; }
    touched.add(touchKey);
    if (action.type === "create_task") {
      const task = action.task;
      if (next.tasks.some((existing) => existing.id === task.id || existing.projectId === task.projectId && existing.templateStep === task.templateStep && task.templateStep)) issue("DUPLICATE_TASK", path);
      if (task.encounterId !== graph.encounterId || !graph.projects.some((project) => project.id === task.projectId)) issue("WRONG_ENCOUNTER_OR_PROJECT", path);
      if (automated && (task.kind === "clinical_gate")) issue("MODEL_GATE", path);
      if (automated && (task.state === "done" || task.completionSourceId)) issue("MODEL_DONE", path);
      if (automated && !["proposed", "open"].includes(task.state)) issue("MODEL_INITIAL_STATE", path);
      if (automated && !matchesTemplate(task)) issue("UNREGISTERED_OPERATIONAL_TASK", path);
      if (automated && task.templateStep && task.id !== `${task.projectId}:${task.templateStep.split(":")[1]}`) issue("NONCANONICAL_TASK_ID", path);
      if (automated && task.notBeforeMinutes !== undefined) issue("SCHEDULE_FROM_EVENT_ONLY", path);
      const template = TEMPLATES.find((item) => task.templateStep?.startsWith(`${item.id}:`));
      if (automated && template?.projectKind !== graph.projects.find((project) => project.id === task.projectId)?.kind) issue("TEMPLATE_PROJECT_MISMATCH", path);
      if (BLOCKED_PHRASES.test(task.label)) issue("CLINICAL_PHRASE", path);
      if (!mayReadTask(actor!, task.ownerRole)) issue("SCOPE_DENIED", path);
      if (!task.sourceIds.every((id) => visibleSources.has(id))) issue("UNRESOLVED_SOURCE", path);
      if (task.state === "done") issue("CREATE_DONE_FORBIDDEN", path);
      if (task.kind === "clinical_gate") issue("GATE_FROM_TRUSTED_EVENT_ONLY", path);
      if (acceptingActor && !mayManageTask(acceptingActor, task.ownerRole)) issue("ACCEPT_SCOPE_DENIED", path);
      next.tasks.push(task);
    } else if (action.type === "transition_task" || action.type === "assign_task") {
      const task = next.tasks.find((item) => item.id === action.taskId);
      if (!task) { issue("UNKNOWN_TASK", path); continue; }
      if (!mayReadTask(actor!, task.ownerRole)) issue("SCOPE_DENIED", path);
      if (acceptingActor && !mayManageTask(acceptingActor, task.ownerRole)) issue("ACCEPT_SCOPE_DENIED", path);
      if (action.type === "assign_task") {
        if (!mayManageTask(actor!, task.ownerRole) || action.ownerRole !== task.ownerRole) issue("ASSIGN_SCOPE_DENIED", path);
        task.ownerId = action.ownerId; task.ownerRole = action.ownerRole;
      } else {
        if (automated && action.state === "done") issue("MODEL_DONE", path);
        if (task.kind === "clinical_gate") issue("GATE_FROM_TRUSTED_EVENT_ONLY", path);
        if (!automated && !mayManageTask(actor!, task.ownerRole)) issue("WRITE_SCOPE_DENIED", path);
        if (!canTransition(task.state, action.state)) issue("ILLEGAL_TRANSITION", path);
        if (["ready", "in_progress", "done"].includes(action.state) && !prerequisitesDone(task.id, next.tasks, next.dependencies)) issue("UNMET_DEPENDENCY", path);
        if (action.state === "done") {
          const evidence = next.sources.find((source) => source.id === action.evidenceSourceId);
          if (!evidence || evidence.taskId !== task.id || evidence.kind !== task.expectedEvidence || !visibleSources.has(evidence.id)) issue("COMPLETION_EVIDENCE_REQUIRED", path);
          if (evidence?.kind === "result" && evidence.status !== (task.templateStep?.endsWith(":preliminary") ? "preliminary" : "final")) issue("RESULT_STATUS_MISMATCH", path);
          if (evidence?.kind === "attestation" && proposal.origin !== "human") issue("HUMAN_ATTESTATION_REQUIRED", path);
          task.completionSourceId = action.evidenceSourceId;
        }
        task.state = action.state;
      }
    } else if (action.type === "add_dependency") {
      const edge = action.dependency;
      if (edge.kind === "clinician_gate" || next.tasks.some((task) => (task.id === edge.from || task.id === edge.to) && task.kind === "clinical_gate")) issue("MODEL_GATE", path);
      const ends = [edge.from, edge.to].map((id) => next.tasks.find((task) => task.id === id));
      if (ends.some((task) => task && !mayReadTask(actor!, task.ownerRole))) issue("SCOPE_DENIED", path);
      if (acceptingActor && ends.some((task) => task && !mayManageTask(acceptingActor, task.ownerRole))) issue("ACCEPT_SCOPE_DENIED", path);
      if (next.dependencies.some((existing) => existing.id === edge.id)) issue("DUPLICATE_DEPENDENCY", path);
      next.dependencies.push(edge);
    } else if (action.type === "stage_finding") {
      const finding = action.finding;
      const definition = FINDING_DEFINITIONS[finding.key];
      if (automated && finding.id !== `${graph.encounterId}:${finding.key}:${finding.kind}`) issue("NONCANONICAL_FINDING_ID", path);
      if (finding.encounterId !== graph.encounterId) issue("WRONG_ENCOUNTER", path);
      if (finding.state !== "open") issue("MODEL_FINDING_STATE", path);
      if (!(definition.kinds as readonly string[]).includes(finding.kind) || finding.ownerRole !== definition.ownerRole) issue("INVALID_FINDING_KIND_OR_ROLE", path);
      if (!finding.sourceIds.every((id) => visibleSources.has(id))) issue("UNRESOLVED_SOURCE", path);
      if (!findingSupported(finding.key, finding.sourceIds, next.sources.filter((source) => visibleSources.has(source.id)))) issue("UNSUPPORTED_FINDING", path);
      const owner = roster.find((person) => person.id === finding.ownerId);
      if (!owner || owner.role !== finding.ownerRole || !isAssigned(owner, graph)) issue("INVALID_OWNER", path);
      if (!mayReadTask(actor!, finding.ownerRole)) issue("SCOPE_DENIED", path);
      if (acceptingActor && !mayManageTask(acceptingActor, finding.ownerRole)) issue("ACCEPT_SCOPE_DENIED", path);
      if (next.findings.some((item) => item.id === finding.id || item.key === finding.key && item.kind === finding.kind)) issue("DUPLICATE_FINDING", path);
      next.findings.push(finding);
    } else {
      const draft = action.draft;
      if (!["charge_rn", "hospitalist", "surgeon"].includes(actor!.role)) issue("DRAFT_SCOPE_DENIED", path);
      if (acceptingActor && !["charge_rn", "hospitalist", "surgeon"].includes(acceptingActor.role)) issue("ACCEPT_SCOPE_DENIED", path);
      if (draft.encounterId !== graph.encounterId) issue("WRONG_ENCOUNTER", path);
      if (draft.state !== "draft") issue("DRAFT_STATE_FORBIDDEN", path);
      if (next.drafts.some((existing) => existing.id === draft.id)) issue("DUPLICATE_DRAFT", path);
      issues.push(...validateDraftLines(draft.lines, next.sources.filter((source) => visibleSources.has(source.id))).map((item) => ({ ...item, path: `${path}.${item.path}` })));
      next.drafts.push(draft);
    }
  }
  const owners = new Map(roster.map((person) => [person.id, person]));
  for (const task of next.tasks) {
    const owner = owners.get(task.ownerId);
    if (!owner || owner.role !== task.ownerRole || !isAssigned(owner, graph)) issue("INVALID_OWNER", `tasks.${task.id}`);
  }
  try { topologicalOrder(next.tasks, next.dependencies); } catch (error) { issue(error instanceof Error ? error.message : "INVALID_GRAPH", "dependencies"); }
  for (const task of next.tasks) {
    if (["ready", "in_progress"].includes(task.state) && !prerequisitesDone(task.id, next.tasks, next.dependencies)) issue("UNMET_DEPENDENCY", `tasks.${task.id}`);
  }
  const shape = GraphSchema.safeParse(next);
  if (!shape.success) issue("INVALID_GRAPH", "graph");
  return issues.length ? { ok: false, issues } : { ok: true, graph: next };
}
