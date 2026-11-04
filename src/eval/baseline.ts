import { createHash } from "node:crypto";
import { FINDING_DEFINITIONS, type FindingKey } from "@/domain/findings";
import { ownerFor } from "@/domain/roster";
import { expandTemplate } from "@/domain/templates";
import { scopedGraph } from "@/domain/scope";
import { validateProposal } from "@/domain/validator";
import type { Action, Finding, Graph, Person, Proposal } from "@/domain/types";
import { latestResults } from "@/domain/results";

export type ExtractedItem = { key: FindingKey; kind: Finding["kind"]; subject: string; ownerRole: Finding["ownerRole"]; sourceIds: string[] };
export function rulesBaseline(graph: Graph, actor: Person, roster: readonly Person[]) {
  const visible = scopedGraph(graph, actor);
  const notes = visible.sources.filter((source) => source.kind === "note_span");
  const note = notes.map((source) => source.text).join("\n");
  const items: ExtractedItem[] = [];
  const add = (key: FindingKey, kind: Finding["kind"], sourceIds: string[]) => {
    if (!items.some((item) => item.key === key && item.kind === kind) && sourceIds.length) items.push({ key, kind, subject: FINDING_DEFINITIONS[key].label, ownerRole: FINDING_DEFINITIONS[key].ownerRole, sourceIds: [...new Set(sourceIds)] });
  };
  for (const source of latestResults(visible.sources)) {
    if (source.kind !== "result") continue;
    if (/\bCT\b/i.test(source.text) && source.status === "final" && /\bCT\b/i.test(note)) add("ct_report", "link", [source.id]);
    if (["pending", "preliminary"].includes(source.status)) {
      if (FINDING_DEFINITIONS.blood_culture_pending.pattern.test(source.text)) {
        add("blood_culture_pending", "link", [source.id]);
        add("blood_culture_pending", "pending_owner", [source.id]);
        const conflict = notes.find((span) => /\b(?:BCx|blood culture)\b/i.test(span.text) && /\b(?:negative|final)\b/i.test(span.text) && /\b(?:prelim|copied|still)\b/i.test(span.text));
        if (conflict) add("note_result_conflict", "question", [conflict.id, source.id]);
      }
      if (FINDING_DEFINITIONS.pathology_pending.pattern.test(source.text)) add("pathology_pending", "pending_owner", [source.id]);
    }
  }
  for (const [key, kind] of [["home_oxygen_coordination", "question"], ["pcp_coordination", "task"], ["room_vacancy", "question"], ["echo_slot", "question"], ["home_health", "pending_owner"], ["ride", "question"]] as const) {
    const span = notes.find((source) => FINDING_DEFINITIONS[key].pattern.test(source.text));
    if (!span) continue;
    // Confirmed rides do not generate a redundant question. Other uncertainty
    // patterns include "not confirmed", "?", "no ... named", "not back".
    if (key === "ride" && /\bride confirmed\b/i.test(span.text) && !/\bnot confirmed\b/i.test(span.text)) continue;
    add(key, kind, [span.id]);
  }
  const actions: Action[] = [];
  for (const item of items) {
    if (!graph.findings.some((finding) => finding.key === item.key && finding.kind === item.kind)) actions.push({ type: "stage_finding", finding: {
      id: `${graph.encounterId}:${item.key}:${item.kind}`, encounterId: graph.encounterId, key: item.key, kind: item.kind,
      ownerId: ownerFor(item.ownerRole, graph.encounterId, roster), ownerRole: item.ownerRole, sourceIds: item.sourceIds, state: "open",
    } });
    const step = item.key === "home_oxygen_coordination" ? "discharge:home_oxygen" : item.key === "pcp_coordination" ? "discharge:pcp" : undefined;
    const project = graph.projects.find((project) => project.kind === "discharge");
    if (step && project && !graph.tasks.some((task) => task.templateStep === step)) {
      const expanded = expandTemplate({ templateId: "discharge", encounterId: graph.encounterId, projectId: project.id, sourceOrderId: item.sourceIds[0], roster });
      const task = expanded.tasks.find((task) => task.templateStep === step)!;
      actions.push({ type: "create_task", task: { ...task, state: "proposed" } });
    }
  }
  const id = `rules-${createHash("sha256").update(JSON.stringify({ version: graph.version, encounterId: graph.encounterId, items })).digest("hex").slice(0, 16)}`;
  const proposal: Proposal | null = actions.length ? { id, encounterId: graph.encounterId, baseVersion: graph.version, origin: "rules", actorId: actor.id, actions } : null;
  const validation = proposal ? validateProposal(graph, proposal, roster) : null;
  return { mode: "RULES BASELINE" as const, items, proposal, validation, tokens: 0, costMicrousd: 0 };
}
