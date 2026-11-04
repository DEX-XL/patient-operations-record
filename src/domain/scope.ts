import type { Graph, Person, Role } from "./types";

export function isAssigned(actor: Person, graph: Graph) {
  return actor.unitId === graph.unitId && actor.encounterIds.includes(graph.encounterId);
}
export function mayReadTask(actor: Person, ownerRole: Role) {
  return actor.role === "charge_rn" || actor.role === "hospitalist" || actor.role === "surgeon" || actor.role === ownerRole;
}
export function mayManageTask(actor: Person, ownerRole: Role) {
  return actor.role === "charge_rn" || actor.role === ownerRole;
}
export function scopedGraph(graph: Graph, actor: Person): Graph {
  if (!isAssigned(actor, graph)) throw new Error("SCOPE_DENIED");
  const sources = graph.sources.filter((source) => source.visibleTo.includes(actor.role));
  const sourceIds = new Set(sources.map((source) => source.id));
  const tasks = graph.tasks.filter((task) => mayReadTask(actor, task.ownerRole)).map((task) => ({
    ...task, sourceIds: task.sourceIds.filter((id) => sourceIds.has(id)),
    completionSourceId: task.completionSourceId && sourceIds.has(task.completionSourceId) ? task.completionSourceId : undefined,
  }));
  const taskIds = new Set(tasks.map((task) => task.id));
  const projects = graph.projects.filter((project) => tasks.some((task) => task.projectId === project.id) || project.kind === "discharge" && ["charge_rn", "hospitalist", "surgeon", "case_management"].includes(actor.role)).map((project) => ({
    ...project, sourceOrderId: sourceIds.has(project.sourceOrderId) ? project.sourceOrderId : "REDACTED",
  }));
  return {
    ...graph, sources, tasks, projects,
    findings: graph.findings.filter((finding) => mayReadTask(actor, finding.ownerRole) && finding.sourceIds.every((id) => sourceIds.has(id))),
    dependencies: graph.dependencies.filter((edge) => taskIds.has(edge.from) && taskIds.has(edge.to)),
    drafts: ["charge_rn", "hospitalist", "surgeon"].includes(actor.role)
      ? graph.drafts.filter((draft) => draft.lines.every((line) => line.sourceIds.every((id) => sourceIds.has(id)))) : [],
  };
}
