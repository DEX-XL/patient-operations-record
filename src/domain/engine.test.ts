import { describe, expect, it } from "vitest";
import { criticalPath, topologicalOrder } from "./graph";
import { canTransition } from "./transitions";
import { scopedGraph } from "./scope";
import { expandTemplate, TEMPLATES } from "./templates";
import { validateProposal } from "./validator";
import { validateDraftLines } from "./drafts";
import { testGraph, testTask, testRoster, testProposal } from "./test-fixtures";
import type { Action, Graph, Proposal } from "./types";

function codes(proposal: unknown, graph = testGraph()) {
  const result = validateProposal(graph, proposal, testRoster);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}
function createCmTask(): Action {
  const { tasks } = expandTemplate({ templateId: "discharge", encounterId: "E-101", projectId: "project-discharge", sourceOrderId: "note-1#s1", roster: testRoster });
  return { type: "create_task", task: { ...tasks.find((task) => task.templateStep === "discharge:pcp")!, state: "proposed" } };
}
describe("planned graph, not clinical predictions", () => {
  it("computes a branched critical path and slack", () => {
    const graph = testGraph();
    const result = criticalPath(graph.tasks, graph.dependencies);
    expect(result.plannedMinutes).toBe(30);
    expect(result.criticalTaskIds).toEqual(["t1", "t2"]);
    expect(result.schedule.find((task) => task.taskId === "t3")?.slackMinutes).toBe(25);
  });
  it("uses zero remaining duration for completed tasks and excludes cancelled work", () => {
    const graph = testGraph(); graph.tasks[0].state = "done"; graph.tasks[2].state = "cancelled";
    const result = criticalPath(graph.tasks, graph.dependencies);
    expect(result.plannedMinutes).toBe(20);
    expect(result.criticalTaskIds).toEqual(["t2"]);
  });
  it("returns an empty path for no tasks", () => expect(criticalPath([], [])).toEqual({ plannedMinutes: 0, criticalTaskIds: [], schedule: [] }));
  it("is independent of input ordering, including equal branches", () => {
    const graph = testGraph();
    expect(criticalPath([...graph.tasks].reverse(), graph.dependencies)).toEqual(criticalPath(graph.tasks, graph.dependencies));
  });
  it("detects cycles, dangling edges and repeated edge pairs", () => {
    const graph = testGraph();
    expect(() => topologicalOrder(graph.tasks, [...graph.dependencies, { id: "cycle", from: "t2", to: "t1", kind: "finish_to_start" }])).toThrow("CYCLE");
    expect(() => topologicalOrder(graph.tasks, [{ id: "bad", from: "missing", to: "t1", kind: "finish_to_start" }])).toThrow("DANGLING_DEPENDENCY");
    expect(() => topologicalOrder(graph.tasks, [...graph.dependencies, { ...graph.dependencies[0], id: "copy" }])).toThrow("DUPLICATE_DEPENDENCY");
  });
  it.each([ ["done", "open"], ["cancelled", "ready"], ["ready", "done"], ["proposed", "in_progress"] ] as const)("rejects illegal transition %s -> %s", (from, to) => expect(canTransition(from, to)).toBe(false));
  it("expands all handwritten templates with assigned owners and valid graphs", () => {
    for (const template of TEMPLATES) {
      const graph = expandTemplate({ templateId: template.id, encounterId: "E-101", projectId: template.id, sourceOrderId: "supplied-order", roster: testRoster });
      expect(topologicalOrder(graph.tasks, graph.dependencies)).toHaveLength(template.steps.length);
      expect(graph.tasks.every((task) => testRoster.some((person) => person.id === task.ownerId && person.role === task.ownerRole))).toBe(true);
    }
  });
  it("refuses unknown templates and missing owners", () => {
    expect(() => expandTemplate({ templateId: "unknown", encounterId: "E-101", projectId: "x", sourceOrderId: "o", roster: testRoster })).toThrow("UNKNOWN_TEMPLATE");
    expect(() => expandTemplate({ templateId: "ct", encounterId: "E-101", projectId: "x", sourceOrderId: "o", roster: [] })).toThrow("NO_ASSIGNED_OWNER");
  });
});

describe("proposal validator", () => {
  it("accepts a legitimate staged state change without mutating its input", () => {
    const graph = testGraph();
    const result = validateProposal(graph, testProposal(), testRoster);
    expect(result.ok).toBe(true);
    expect(graph.tasks[0].state).toBe("ready");
    if (result.ok) expect(result.graph.tasks[0].state).toBe("in_progress");
  });
  it("requires the current version and correct encounter", () => {
    expect(codes(testProposal({ baseVersion: 8 }))).toContain("STALE_VERSION");
    expect(codes(testProposal({ encounterId: "E-201" }))).toContain("WRONG_ENCOUNTER");
  });
  it("rejects unknown fields and malformed actions", () => {
    expect(codes({ ...testProposal(), secretOverride: true })).toContain("SCHEMA");
    expect(codes({ ...testProposal(), actions: [{ type: "write_order" }] })).toContain("SCHEMA");
  });
  it.each(["model", "rules"] as const)("never allows %s to mark work done", (origin) => {
    const graph = testGraph(); graph.tasks[0].state = "in_progress";
    expect(codes(testProposal({ origin, actions: [{ type: "transition_task", taskId: "t1", state: "done", evidenceSourceId: "attest-1" }] }), graph)).toContain("MODEL_DONE");
    expect(codes(testProposal({ origin, actions: [{ type: "create_task", task: testTask({ id: "new", state: "done" }) }] }))).toContain("MODEL_DONE");
  });
  it("cannot create or satisfy clinical gates", () => {
    expect(codes(testProposal({ actions: [{ type: "create_task", task: testTask({ id: "gate", kind: "clinical_gate" }) }] }))).toContain("MODEL_GATE");
    expect(codes(testProposal({ actions: [{ type: "add_dependency", dependency: { id: "gate-edge", from: "t1", to: "t3", kind: "clinician_gate" } }] }))).toContain("MODEL_GATE");
    const graph = testGraph(); graph.tasks[0].kind = "clinical_gate";
    expect(codes(testProposal(), graph)).toContain("GATE_FROM_TRUSTED_EVENT_ONLY");
  });
  it("checks cycles, duplicate actions and unknown tasks", () => {
    expect(codes(testProposal({ actions: [{ type: "add_dependency", dependency: { id: "reverse", from: "t2", to: "t1", kind: "finish_to_start" } }] }))).toContain("CYCLE");
    expect(codes(testProposal({ actions: [testProposal().actions[0], testProposal().actions[0]] }))).toContain("DUPLICATE_ACTION");
    expect(codes(testProposal({ actions: [{ type: "transition_task", taskId: "unknown", state: "open" }] }))).toContain("UNKNOWN_TASK");
  });
  it("does not let task execution jump unfinished dependencies", () => {
    expect(codes(testProposal({ actions: [{ type: "transition_task", taskId: "t2", state: "ready" }] }))).toContain("UNMET_DEPENDENCY");
  });
  it("accepts completion only with matching human attestation", () => {
    const graph = testGraph(); graph.tasks[0].state = "in_progress";
    const proposal = testProposal({ origin: "human", actions: [{ type: "transition_task", taskId: "t1", state: "done", evidenceSourceId: "attest-1" }] });
    expect(codes(proposal, graph)).toEqual([]);
    expect(codes({ ...proposal, actions: [{ type: "transition_task", taskId: "t1", state: "done" }] }, graph)).toContain("COMPLETION_EVIDENCE_REQUIRED");
    expect(codes({ ...proposal, origin: "event" }, graph)).toContain("HUMAN_ATTESTATION_REQUIRED");
  });
  it("does not complete a final-result task using preliminary or unrelated evidence", () => {
    const graph = testGraph(); graph.tasks[0].state = "done"; graph.tasks[1].state = "in_progress";
    const proposal = testProposal({ origin: "event", actorId: "lab-owner", actions: [{ type: "transition_task", taskId: "t2", state: "done", evidenceSourceId: "result-pre" }] });
    expect(codes(proposal, graph)).toContain("RESULT_STATUS_MISMATCH");
    proposal.actions = [{ type: "transition_task", taskId: "t2", state: "done", evidenceSourceId: "result-final" }];
    expect(codes(proposal, graph)).toEqual([]);
    proposal.actions = [{ type: "transition_task", taskId: "t2", state: "done", evidenceSourceId: "attest-1" }];
    expect(codes(proposal, graph)).toContain("COMPLETION_EVIDENCE_REQUIRED");
  });
  it("requires a rostered, assigned owner of the correct role", () => {
    expect(codes(testProposal({ actions: [{ type: "assign_task", taskId: "t1", ownerId: "missing", ownerRole: "hospitalist" }] }))).toContain("INVALID_OWNER");
    expect(codes(testProposal({ actions: [{ type: "assign_task", taskId: "t1", ownerId: "lab-owner", ownerRole: "hospitalist" }] }))).toContain("INVALID_OWNER");
    const graph = testGraph(); graph.encounterId = "E-unassigned";
    expect(codes(testProposal({ encounterId: "E-unassigned" }), graph)).toContain("SCOPE_DENIED");
  });
  it("allows only fixed template tasks for automated creation", () => {
    const action = createCmTask();
    expect(codes(testProposal({ actions: [action] }))).toEqual([]);
    if (action.type !== "create_task") throw new Error("fixture");
    action.task.label = "Start an unrequested procedure";
    expect(codes(testProposal({ actions: [action] }))).toContain("UNREGISTERED_OPERATIONAL_TASK");
  });
  it("rejects duplicate logical tasks and unsupported task evidence", () => {
    const action = createCmTask();
    if (action.type !== "create_task") throw new Error("fixture");
    const graph = testGraph(); graph.tasks.push({ ...action.task, id: "already-existing" });
    expect(codes(testProposal({ actions: [action] }), graph)).toContain("DUPLICATE_TASK");
    action.task.sourceIds = ["missing-source"];
    expect(codes(testProposal({ actions: [action] }))).toContain("UNRESOLVED_SOURCE");
  });
  it("forbids arbitrary clinical phrasing in task labels", () => {
    expect(codes(testProposal({ actions: [{ type: "create_task", task: testTask({ id: "new", label: "Recommend dose for discharge", state: "proposed" }) }] }))).toContain("CLINICAL_PHRASE");
  });
  it("prevents lab reading/mutating another department's tasks", () => {
    expect(codes(testProposal({ actorId: "lab-owner" }))).toContain("SCOPE_DENIED");
    expect(codes(testProposal({ actorId: "lab-owner", actions: [createCmTask()] }))).toContain("SCOPE_DENIED");
  });
  it("requires accepting role authority, revalidated against the whole batch", () => {
    const cm = testRoster.find((person) => person.role === "case_management")!;
    const result = validateProposal(testGraph(), testProposal(), testRoster, cm);
    expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toContain("ACCEPT_SCOPE_DENIED");
  });
  it("permits drafts only in draft state and for clinician-facing roles", () => {
    const action: Action = { type: "stage_draft", draft: { id: "draft-1", encounterId: "E-101", kind: "handover", state: "reviewed", lines: [{ text: "Blood culture preliminary; final result pending.", sourceIds: ["result-pre"] }] } };
    expect(codes(testProposal({ actions: [action] }))).toContain("DRAFT_STATE_FORBIDDEN");
    expect(codes(testProposal({ actorId: "lab-owner", actions: [action] }))).toContain("DRAFT_SCOPE_DENIED");
  });
});

describe("source-supported drafts", () => {
  const validate = (text: string, sourceIds = ["result-pre"]) => validateDraftLines([{ text, sourceIds }], testGraph().sources).map((issue) => issue.code);
  it("accepts a cited preliminary fact while preserving status", () => expect(validate("Blood culture preliminary; final result pending.")).toEqual([]));
  it("blocks invented text even when the citation itself exists", () => expect(validate("The patient walked 400 feet independently.")).toContain("UNSUPPORTED_LINE"));
  it("blocks absent and unresolvable citations", () => {
    expect(validate("Fact", [])).toContain("UNRESOLVED_SOURCE");
    expect(validate("Fact", ["unknown"])).toContain("UNRESOLVED_SOURCE");
  });
  it.each(["Culture negative.", "Final report available.", "Final result pending; blood culture negative."])("does not promote preliminary evidence: %s", (text) => expect(validate(text)).toContain("PRELIMINARY_AS_FINAL"));
  it.each(["Recommend antibiotics.", "Should start treatment.", "Safe for discharge.", "Adjust dose."])("blocks clinical phrase: %s", (text) => expect(validate(text)).toContain("CLINICAL_PHRASE"));
  it("allows only the verbatim structured medication string", () => {
    expect(validate("Synthetic medication A 5 mg, as recorded", ["med-1"])).toEqual([]);
    expect(validate("Synthetic medication A 10 mg, as recorded", ["med-1"])).toContain("MEDICATION_NOT_VERBATIM");
  });
  it("does not cite a hidden source via a visible proposal", () => {
    const proposal: Proposal = testProposal({ actorId: "lab-owner", actions: [{ type: "stage_draft", draft: { id: "d", encounterId: "E-101", state: "draft", kind: "handover", lines: [{ text: "The sign-out says: f/u BCx.", sourceIds: ["note-1#s1"] }] } }] });
    expect(codes(proposal)).toContain("UNRESOLVED_SOURCE");
  });
});

describe("scoped reads", () => {
  it("filters task, note, source, dependency and draft context by role", () => {
    const graph = testGraph();
    const scoped = scopedGraph(graph, testRoster.find((person) => person.role === "lab")!);
    expect(scoped.tasks.map((task) => task.id)).toEqual(["t2"]);
    expect(scoped.sources.map((source) => source.id)).not.toContain("note-1#s1");
    expect(scoped.sources.map((source) => source.id)).not.toContain("med-1");
    expect(scoped.dependencies).toEqual([]); expect(scoped.drafts).toEqual([]);
    expect(JSON.stringify(scoped)).not.toContain("f/u BCx");
  });
  it("denies a different unit or unassigned patient before returning data", () => {
    const actor = testRoster[0];
    expect(() => scopedGraph(testGraph(), { ...actor, unitId: "OTHER" })).toThrow("SCOPE_DENIED");
    expect(() => scopedGraph(testGraph(), { ...actor, encounterIds: [] })).toThrow("SCOPE_DENIED");
  });
});
