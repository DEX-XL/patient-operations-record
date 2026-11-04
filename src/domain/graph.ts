import type { Dependency, Task } from "./types";

export function topologicalOrder(tasks: readonly Task[], dependencies: readonly Dependency[]): string[] {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error("DUPLICATE_TASK");
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map(tasks.map((task) => [task.id, [] as string[]]));
  const edgePairs = new Set<string>();
  for (const edge of dependencies) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error("DANGLING_DEPENDENCY");
    const pair = `${edge.from}\0${edge.to}`;
    if (edgePairs.has(pair)) throw new Error("DUPLICATE_DEPENDENCY");
    edgePairs.add(pair);
    outgoing.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
  }
  const queue = [...ids].filter((id) => indegree.get(id) === 0).sort();
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const to of outgoing.get(id)!.sort()) {
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) { queue.push(to); queue.sort(); }
    }
  }
  if (ordered.length !== tasks.length) throw new Error("CYCLE");
  return ordered;
}

export type ScheduleItem = { taskId: string; startMinutes: number; finishMinutes: number; slackMinutes: number; critical: boolean };
export function criticalPath(tasks: readonly Task[], dependencies: readonly Dependency[]) {
  // This is a planned-duration dependency calculation, never an ETA or readiness prediction.
  topologicalOrder(tasks, dependencies);
  const active = tasks.filter((task) => !["cancelled", "superseded"].includes(task.state));
  const activeIds = new Set(active.map((task) => task.id));
  const edges = dependencies.filter((edge) => activeIds.has(edge.from) && activeIds.has(edge.to));
  const order = topologicalOrder(active, edges);
  const byId = new Map(active.map((task) => [task.id, task]));
  const starts = new Map<string, number>();
  const finishes = new Map<string, number>();
  const duration = (id: string) => byId.get(id)!.state === "done" ? 0 : byId.get(id)!.plannedMinutes;
  for (const id of order) {
    const release = byId.get(id)!.state === "done" ? 0 : byId.get(id)!.notBeforeMinutes ?? 0;
    const start = Math.max(release, 0, ...edges.filter((edge) => edge.to === id).map((edge) => finishes.get(edge.from)!));
    starts.set(id, start); finishes.set(id, start + duration(id));
  }
  const plannedMinutes = Math.max(0, ...finishes.values());
  const latestStarts = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const children = edges.filter((edge) => edge.from === id);
    const finish = children.length ? Math.min(...children.map((edge) => latestStarts.get(edge.to)!)) : plannedMinutes;
    latestStarts.set(id, finish - duration(id));
  }
  const schedule: ScheduleItem[] = order.map((id) => ({
    taskId: id, startMinutes: starts.get(id)!, finishMinutes: finishes.get(id)!,
    slackMinutes: latestStarts.get(id)! - starts.get(id)!,
    critical: latestStarts.get(id) === starts.get(id) && byId.get(id)!.state !== "done",
  }));
  return { plannedMinutes, criticalTaskIds: schedule.filter((task) => task.critical).map((task) => task.taskId), schedule };
}

export function prerequisitesDone(taskId: string, tasks: readonly Task[], dependencies: readonly Dependency[]) {
  return dependencies.filter((edge) => edge.to === taskId).every((edge) => tasks.find((task) => task.id === edge.from)?.state === "done");
}
