import type { Action } from "@/domain/types";
import { FINDING_DEFINITIONS } from "@/domain/findings";
import { subjectKey, type ScoredItem } from "./metrics";

// The same transformation is used for BOTH methods. It has no gold input.
// Score staged logical items, not prose claims or task completion. A finding
// and its corresponding physical task describe one task item, not two hits.
export function proposalObservations(actions: readonly Action[]): ScoredItem[] {
  const observations: ScoredItem[] = [];
  for (const action of actions) {
    if (action.type === "stage_finding") observations.push({
      kind: action.finding.kind, subject: FINDING_DEFINITIONS[action.finding.key].label,
      ownerRole: action.finding.ownerRole, sourceIds: action.finding.sourceIds,
    });
    if (action.type === "create_task") {
      const subject = action.task.templateStep === "discharge:home_oxygen" ? FINDING_DEFINITIONS.home_oxygen_coordination.label
        : action.task.templateStep === "discharge:pcp" ? FINDING_DEFINITIONS.pcp_coordination.label : action.task.label;
      observations.push({ kind: "task", subject, ownerRole: action.task.ownerRole, sourceIds: action.task.sourceIds });
    }
  }
  const seen = new Set<string>();
  return observations.filter(item => {
    const key = `${item.kind}:${subjectKey(item.subject)}:${item.ownerRole}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
