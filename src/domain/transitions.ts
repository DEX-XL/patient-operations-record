import type { TaskState } from "./types";

const transitions: Record<TaskState, readonly TaskState[]> = {
  proposed: ["open", "cancelled", "superseded"],
  open: ["blocked", "ready", "stale", "cancelled", "superseded"],
  blocked: ["ready", "stale", "cancelled", "superseded"],
  ready: ["in_progress", "blocked", "stale", "cancelled", "superseded"],
  in_progress: ["done", "blocked", "stale", "cancelled", "superseded"],
  stale: ["open", "blocked", "ready", "in_progress", "cancelled", "superseded"],
  done: [], cancelled: [], superseded: [],
};
export function canTransition(from: TaskState, to: TaskState) { return transitions[from].includes(to); }
