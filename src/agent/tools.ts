import { z } from "zod";
import { ActionSchema, DraftLineSchema, type Action, type Graph, type Person, type Proposal } from "@/domain/types";
import { scopedGraph } from "@/domain/scope";
import { TEMPLATES } from "@/domain/templates";
import { FINDING_DEFINITIONS } from "@/domain/findings";
import { validateProposal } from "@/domain/validator";
import { latestResults } from "@/domain/results";

export function promptContext(graph: Graph, actor: Person) {
  const scoped = scopedGraph(graph, actor);
  return {
    synthetic: true, encounterId: scoped.encounterId, version: scoped.version, persona: actor.id, role: actor.role,
    projects: scoped.projects, tasks: scoped.tasks, dependencies: scoped.dependencies, findings: scoped.findings,
    sources: scoped.sources.map(({ id, kind, status, text, statements }) => ({ id, kind, status, text, statements })),
    currentResultSourceIds: latestResults(scoped.sources).map((source) => source.id),
    request: "Reconcile the latest sign-out with existing orders/results and unfinished work. Stage only evidence-supported operational findings, missing coordination tasks, and/or a cited factual draft.",
  };
}
export function createToolHandler(input: { graph: Graph; actor: Person; roster: readonly Person[]; proposalId: string; actions?: Action[] }) {
  const visible = scopedGraph(input.graph, input.actor);
  let actions = [...(input.actions ?? [])];
  const makeProposal = (candidateActions: Action[]): Proposal => ({ id: input.proposalId, encounterId: visible.encounterId, baseVersion: visible.version, origin: "model", actorId: input.actor.id, actions: candidateActions });
  const stage = (additional: Action[]) => {
    const candidate = makeProposal([...actions, ...additional]);
    const validation = validateProposal(input.graph, candidate, input.roster);
    if (!validation.ok) return { ok: false, result: { accepted: false, issues: validation.issues } };
    actions = candidate.actions;
    return { ok: true, staged: true, result: { accepted: true, humanAcceptanceRequired: true, actionCount: actions.length, baseVersion: visible.version } };
  };
  return {
    getActions: () => actions,
    getProposal: () => actions.length ? makeProposal(actions) : null,
    async call(name: string, args: unknown) {
      if (name.startsWith("get_")) z.object({}).strict().parse(args);
      if (name === "get_unit_snapshot") return { ok: true, result: { encounterId: visible.encounterId, version: visible.version, taskCount: visible.tasks.length, unitId: visible.unitId } };
      if (name === "get_patient_timeline") return { ok: true, result: visible.sources.filter((source) => source.kind !== "note_span") };
      if (name === "get_notes") return { ok: true, result: visible.sources.filter((source) => source.kind === "note_span") };
      if (name === "get_task_graph") return { ok: true, result: { version: visible.version, projects: visible.projects, tasks: visible.tasks, dependencies: visible.dependencies, findings: visible.findings } };
      if (name === "get_templates") return { ok: true, result: {
        templates: TEMPLATES, findingDefinitions: Object.fromEntries(Object.entries(FINDING_DEFINITIONS).map(([key, definition]) => [key, { label: definition.label, ownerRole: definition.ownerRole, kinds: definition.kinds, question: definition.question }])),
        roster: input.roster.filter((person) => person.unitId === visible.unitId && person.encounterIds.includes(visible.encounterId)).map(({ id, role }) => ({ id, role })),
        actionSchema: z.toJSONSchema(ActionSchema),
        taskIdFormat: "<projectId>:<template step id without template prefix>", findingIdFormat: "<encounterId>:<key>:<kind>",
      } };
      if (name === "stage_task_changes") {
        const parsed = z.object({ actions_json: z.string().max(16_000) }).strict().parse(args);
        return stage(z.array(ActionSchema).min(1).max(24).parse(JSON.parse(parsed.actions_json)));
      }
      if (name === "stage_document_draft") {
        const parsed = z.object({ draft_json: z.string().max(16_000) }).strict().parse(args);
        const draft = z.object({ kind: z.enum(["handover", "discharge_pending_tests"]), lines: z.array(DraftLineSchema).min(1).max(20) }).strict().parse(JSON.parse(parsed.draft_json));
        return stage([{ type: "stage_draft", draft: { ...draft, id: `${input.proposalId}:draft:${actions.length}`, encounterId: visible.encounterId, state: "draft" } }]);
      }
      return { ok: false, result: { error: "UNKNOWN_TOOL" } };
    },
  };
}
