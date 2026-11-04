import { z } from "zod";
import { GraphSchema, type Source } from "../src/domain/types";
import { DEMO_ROSTER } from "../src/domain/roster";

const record = z.record(z.string(), z.unknown());
export const InputScenario = z.object({
  id: z.string(), journey: z.enum(["appendicitis", "pneumonia"]), unit: z.string(), clock: z.string(), handoff: z.string(), patient: record,
  events: z.array(record), orders: z.array(record),
  note: z.object({ id: z.string(), author_role: z.string(), status: z.enum(["signed", "unsigned"]), text: z.string().max(6000) }).strict(),
  consults: z.array(record).optional(), appointments: z.array(record).optional(),
  interpreter_requests: z.array(record).optional(), dme_orders: z.array(record).optional(),
}).strict();
export const InputSet = z.object({ set: z.literal("heldout-v1"), synthetic: z.literal(true), notice: z.string(), scenarios: z.array(InputScenario).length(4) }).strict();

// Transport-shape adapter only. It accepts NO gold and adds no default result,
// clinical interpretation, supplied clinician owner or completion evidence.
export function inputContext(candidate: unknown) {
  const scenario = InputScenario.parse(candidate);
  const surgical = scenario.journey === "appendicitis";
  const encounterId = surgical ? "E-101" : "E-201", patientId = surgical ? "P-101" : "P-201";
  const roster = DEMO_ROSTER.map(person => ({ ...person, encounterIds: [...person.encounterIds] }));
  const visibleTo = roster.filter(person => person.encounterIds.includes(encounterId)).map(person => person.role);
  const source = (id: string, kind: Source["kind"], status: Source["status"], text: string, subjectId?: string): Source => ({
    id, encounterId, kind, status, text, subjectId, visibleTo, statements: kind === "note_span" ? [] : [text],
  });
  const sources: Source[] = [];
  for (const event of scenario.events) {
    const id = z.string().parse(event.id), type = z.string().parse(event.type), detail = z.string().parse(event.detail);
    const kind = type.startsWith("ORU") ? "result" : type.startsWith("SIU") ? "schedule" : type.startsWith("ORM") ? "order" : "adt";
    const status = kind === "result" && /\bPRELIM\b/i.test(detail) ? "preliminary" : kind === "result" && /\bFINAL\b/.test(detail) ? "final" : "recorded";
    sources.push(source(id, kind, status, JSON.stringify(event), typeof event.ref === "string" ? event.ref : undefined));
  }
  for (const order of scenario.orders) {
    const id = z.string().parse(order.id), status = z.string().parse(order.status);
    const resultState = ["pending", "preliminary", "final"].includes(status);
    sources.push(source(id, order.kind === "medication" ? "medication" : resultState ? "result" : "order", resultState ? status as Source["status"] : "recorded", JSON.stringify(order), id));
  }
  sources.push(source(scenario.note.id, "note_span", scenario.note.status, scenario.note.text));
  sources.push(source(`${scenario.id}:context`, "adt", "recorded", JSON.stringify({ journey: scenario.journey, unit: scenario.unit, clock: scenario.clock, handoff: scenario.handoff, patient: scenario.patient, noteAuthorRole: scenario.note.author_role })));
  for (const [key, value] of Object.entries(scenario)) {
    if (!["id", "journey", "unit", "clock", "handoff", "patient", "events", "orders", "note"].includes(key)) sources.push(source(`${scenario.id}:${key}`, "schedule", "recorded", JSON.stringify({ suppliedCollection: key, value })));
  }
  const admission = scenario.events.find(event => typeof event.type === "string" && event.type.startsWith("ADT^A01"));
  if (!admission || typeof admission.id !== "string") throw new Error("NO_SUPPLIED_ADMISSION");
  const graph = GraphSchema.parse({
    synthetic: true, patientId, encounterId, unitId: "UNIT-A", version: 0,
    projects: [{ id: `${encounterId}:discharge`, encounterId, kind: "discharge", label: "Existing operational coordination", sourceOrderId: admission.id }],
    sources, tasks: [], dependencies: [], drafts: [], findings: [],
  });
  return { graph, roster, actor: roster.find(person => person.id === "md-hospitalist")!, limitations: [
    "Case identifiers map to the existing two demo encounters; original unit/handoff/patient metadata is retained verbatim as a source.",
    "No task-state/dependency/clinical-gate evidence was supplied as a task collection; the input adapter does not invent it.",
    "Only explicit current result status is normalized; raw record fields and note text are retained. No final-negative inference or note-derived fact is added.",
  ] };
}
