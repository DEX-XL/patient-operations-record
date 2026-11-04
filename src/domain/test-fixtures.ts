// Developer-authored synthetic unit-test fixtures. No held-out input is used here.
import type { Graph, Proposal, Task } from "./types";
import { DEMO_ROSTER } from "./roster";
export const testRoster = DEMO_ROSTER;
export function testTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1", encounterId: "E-101", projectId: "project-lab", label: "Confirm existing follow-up owner",
    ownerRole: "hospitalist", ownerId: "md-hospitalist", state: "ready", plannedMinutes: 10,
    expectedEvidence: "attestation", expectedWindowMinutes: 60, kind: "operational", sourceIds: ["order-1"], ...overrides,
  };
}
export function testGraph(): Graph {
  return {
    synthetic: true, encounterId: "E-101", patientId: "P-101", unitId: "UNIT-A", version: 0,
    projects: [
      { id: "project-lab", encounterId: "E-101", kind: "lab", label: "Ordered synthetic laboratory work", sourceOrderId: "order-1" },
      { id: "project-discharge", encounterId: "E-101", kind: "discharge", label: "Supplied operational commitments", sourceOrderId: "order-1" },
    ],
    tasks: [testTask(), testTask({ id: "t2", ownerRole: "lab", ownerId: "lab-owner", state: "blocked", plannedMinutes: 20, expectedEvidence: "result" }), testTask({ id: "t3", ownerRole: "case_management", ownerId: "cm-owner", plannedMinutes: 5 })],
    dependencies: [{ id: "d1", from: "t1", to: "t2", kind: "finish_to_start" }],
    sources: [
      { id: "order-1", encounterId: "E-101", kind: "order", status: "recorded", text: "Existing synthetic lab order", statements: ["An existing laboratory order is recorded."], visibleTo: ["hospitalist", "charge_rn", "lab", "case_management"] },
      { id: "note-1#s1", encounterId: "E-101", kind: "note_span", status: "unsigned", text: "f/u BCx, PCP follow-up requested", statements: ["The sign-out says: f/u BCx."], visibleTo: ["hospitalist", "charge_rn"] },
      { id: "result-pre", encounterId: "E-101", taskId: "t2", kind: "result", status: "preliminary", text: "Preliminary; final result pending", statements: ["Blood culture preliminary; final result pending."], visibleTo: ["hospitalist", "charge_rn", "lab"] },
      { id: "result-final", encounterId: "E-101", taskId: "t2", kind: "result", status: "final", text: "Final report available", statements: ["A final report is available."], visibleTo: ["hospitalist", "charge_rn", "lab"] },
      { id: "attest-1", encounterId: "E-101", taskId: "t1", kind: "attestation", status: "recorded", text: "Owner confirmed", statements: ["Follow-up owner confirmed."], visibleTo: ["hospitalist", "charge_rn"] },
      { id: "med-1", encounterId: "E-101", kind: "medication", status: "signed", text: "Synthetic medication A 5 mg, as recorded", statements: ["Synthetic medication A 5 mg, as recorded"], visibleTo: ["hospitalist", "charge_rn", "pharmacy"] },
    ], drafts: [], findings: [],
  };
}
export function testProposal(overrides: Partial<Proposal> = {}): Proposal {
  return { id: "proposal-1", encounterId: "E-101", baseVersion: 0, origin: "model", actorId: "md-hospitalist", actions: [{ type: "transition_task", taskId: "t1", state: "in_progress" }], ...overrides };
}
