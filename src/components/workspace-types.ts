import type { ReplayStore } from "@/db/replay-store";
import type { publicRun } from "@/db/agent-store";
import type { proposals, auditEntries } from "@/db/schema";
import type { Role } from "@/domain/types";
export type ReplayView = Awaited<ReturnType<ReplayStore["state"]>>;
export type Run = ReturnType<typeof publicRun>;
export type AgentMode = "LIVE META" | "RECORDED META" | "RULES BASELINE";
export type AgentView = { runs: Run[]; proposals: (typeof proposals.$inferSelect)[]; audit: (typeof auditEntries.$inferSelect)[]; budget: { localSpentMicrousd: number; localReservedMicrousd: number; uncertainRequests: number; grantStatus: string } };
export const ROLES: Record<Role, string> = { charge_rn: "Charge RN", hospitalist: "Hospitalist", lab: "Laboratory", case_management: "Case management", surgeon: "Surgeon", radiology: "Radiology", transport: "Transport", or: "OR team", pharmacy: "Pharmacy", evs: "EVS" };
export const PATIENTS: Record<string, { name: string; label: string }> = { "P-101": { name: "Appendicitis", label: "P-101" }, "P-201": { name: "Pneumonia", label: "P-201" } };
export const money = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;
export function replayTime(ms: number) { const minutes = Math.floor(ms / 60_000) + 420; return `Day ${Math.floor(minutes / 1440) + 1} · ${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
export function friendly(code: string, issues: string[] = []) {
  if (code.includes("STALE") || issues.some((issue) => issue.includes("STALE"))) return "The record changed after staging. Reconcile again using its current version.";
  const messages: Record<string, string> = { LIVE_DISABLED: "Live runs are disabled until grant funding and the smoke gate are verified.", VERIFIED_FUNDING_AND_SMOKE_REQUIRED: "Live runs need verified grant funding and the approved smoke gate.", NO_MATCHING_REAL_RECORDING: "No real Meta recording matches this context yet. Choose Rules baseline explicitly for an offline run.", SCOPE_DENIED: "This demo persona is not assigned to that action.", ACCEPT_SCOPE_DENIED: "Use the task owner or Charge RN to accept this batch.", ALREADY_ACCEPTED: "This proposal was already applied. It cannot be applied twice.", CLOCK_LOCKED_DURING_AGENT_RUN: "The clock is paused while the agent is working.", RUN_EXPIRED: "The run timed out safely. Reconcile again.", BUCKET_CAP_REACHED: "The approved budget bucket is exhausted; live calls are blocked.", UNCERTAIN_USAGE_REQUIRES_RECONCILIATION: "A prior request has uncertain cost. Live calls are blocked until reconciliation." };
  return messages[code] ?? messages[issues[0]] ?? code.replaceAll("_", " ").toLowerCase();
}
