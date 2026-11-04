import type { Graph, Person, Source } from "@/domain/types";
import { DEMO_ROSTER } from "@/domain/roster";
import type { z } from "zod";
import type { DevScenarioSchema } from "@/replay/scenarios";

export function devContext(scenario: z.infer<typeof DevScenarioSchema>) {
  const roster: Person[] = DEMO_ROSTER.map((person) => ({ ...person, encounterIds: [...new Set([...person.encounterIds, scenario.encounterId])] }));
  const visibleTo = roster.map((person) => person.role);
  const source = (id: string, kind: Source["kind"], status: Source["status"], text: string): Source => ({ id, kind, status, text, encounterId: scenario.encounterId, visibleTo, statements: kind === "note_span" ? [] : [text] });
  const sources = [source(`${scenario.id}#note`, "note_span", "unsigned", scenario.note), source(`${scenario.id}:admit`, "adt", "recorded", "Synthetic admission")];
  if (scenario.id.includes("appendicitis")) {
    sources.push(source(`${scenario.id}:path`, "result", "pending", "Surgical pathology pending; supplied owner: surgeon."));
    sources.push(source(`${scenario.id}:ct`, "result", "final", "CT final report available."));
  } else if (scenario.id.includes("pneumonia")) sources.push(source(`${scenario.id}:bcx`, "result", "preliminary", "Blood culture preliminary; final result pending."));
  else sources.push(source(`${scenario.id}:echo`, scenario.id.endsWith("echo") ? "order" : "result", scenario.id.endsWith("echo") ? "recorded" : "final", scenario.id.endsWith("echo") ? "Existing echo order" : "Existing echo report filed"));
  const graph: Graph = {
    synthetic: true, patientId: scenario.patientId, encounterId: scenario.encounterId, unitId: "UNIT-A", version: 0,
    projects: [{ id: `${scenario.encounterId}:discharge`, encounterId: scenario.encounterId, kind: "discharge", label: "Existing operational coordination", sourceOrderId: `${scenario.id}:admit` }],
    sources, tasks: [], dependencies: [], drafts: [], findings: [],
  };
  return { graph, roster, actor: roster.find((person) => person.id === "md-hospitalist")! };
}
