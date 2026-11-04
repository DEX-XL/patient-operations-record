import type { Graph, Source } from "@/domain/types";
import { expandTemplate } from "@/domain/templates";
import { DEMO_ROSTER } from "@/domain/roster";
import { prerequisitesDone } from "@/domain/graph";
import type { ReplayEvent } from "./events";

export function emptyDemoGraph(patientId: "P-101" | "P-201", version = 0): Graph {
  return { synthetic: true, patientId, encounterId: patientId.replace("P-", "E-"), unitId: "UNIT-A", version, projects: [], tasks: [], dependencies: [], sources: [], drafts: [], findings: [] };
}
export function applyReplayEvent(graph: Graph, event: ReplayEvent): Graph {
  if (event.encounterId !== graph.encounterId || event.patientId !== graph.patientId) throw new Error("EVENT_IDENTITY_MISMATCH");
  if (graph.sources.some((source) => source.id === event.id)) return graph;
  const next = structuredClone(graph);
  const kind: Source["kind"] = event.type === "result" ? "result" : event.type === "order" ? "order" : event.type === "schedule" ? "schedule" : event.type === "signout" ? "note_span" : event.type === "human_attestation" || event.type === "room_vacated" ? "attestation" : "adt";
  const visibleTo: Source["visibleTo"] = event.type === "result" ? ["charge_rn", "hospitalist", "surgeon", "lab"] : event.type === "signout" ? ["charge_rn", "hospitalist", "surgeon", "case_management"] : DEMO_ROSTER.map((person) => person.role);
  const source: Source = { id: event.id, encounterId: event.encounterId, kind, status: event.status, text: event.text ?? event.label, statements: event.type === "signout" ? [] : [event.label], visibleTo, subjectId: event.subjectId, occurredAtMs: event.atMs };
  next.sources.push(source);
  for (const span of event.spans ?? []) next.sources.push({ ...source, id: span.id, text: event.text!.slice(span.start, span.end), statements: [] });

  if (event.type === "admit") {
    next.projects.push({ id: `${event.encounterId}:discharge`, encounterId: event.encounterId, kind: "discharge", label: "Operational coordination (not clinical clearance)", sourceOrderId: event.id });
  }
  if ((event.type === "order" || event.type === "schedule" && event.subjectId === "a-or") && event.subjectId && !next.projects.some((project) => project.id === event.subjectId)) {
    const templateId = event.subjectId === "a-ct" ? "ct" : event.subjectId === "a-or" ? "or" : "lab";
    next.projects.push({ id: event.subjectId, encounterId: event.encounterId, kind: templateId === "ct" ? "imaging" : templateId === "or" ? "or_case" : "lab", label: event.label, sourceOrderId: event.id });
    const expanded = expandTemplate({ templateId, encounterId: event.encounterId, projectId: event.subjectId, sourceOrderId: event.id, roster: DEMO_ROSTER });
    next.tasks.push(...expanded.tasks); next.dependencies.push(...expanded.dependencies);
  }
  if (event.type === "schedule" && event.subjectId && event.scheduledForMs !== undefined) {
    const transport = next.tasks.find((task) => task.projectId === event.subjectId && task.templateStep === "or:transport");
    if (transport) transport.notBeforeMinutes = Math.max(0, Math.floor(event.scheduledForMs / 60_000) - transport.plannedMinutes);
  }
  // Trusted replay events may record completion; model proposals never use this path.
  let evidenceTaskId: string | undefined;
  if (event.type === "human_attestation") evidenceTaskId = event.subjectId;
  if (event.type === "schedule") evidenceTaskId = `${event.subjectId}:${event.subjectId === "a-or" ? "slot" : "schedule"}`;
  if (event.type === "result" && ["preliminary", "final"].includes(event.status)) evidenceTaskId = `${event.subjectId}:${event.status === "preliminary" ? "preliminary" : "final"}`;
  const task = next.tasks.find((item) => item.id === evidenceTaskId);
  if (task && task.expectedEvidence === source.kind && prerequisitesDone(task.id, next.tasks, next.dependencies)) {
    task.state = "done"; task.completionSourceId = event.id; source.taskId = task.id;
  }
  for (const pending of next.tasks) {
    if (pending.state === "blocked" && prerequisitesDone(pending.id, next.tasks, next.dependencies)) pending.state = "ready";
  }
  next.version++;
  return next;
}
