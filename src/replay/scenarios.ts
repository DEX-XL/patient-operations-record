import { z } from "zod";
import scenarios from "../../fixtures/dev/scenarios.json";
import { RoleSchema } from "@/domain/types";
import { normalizeJson, type ReplayEvent } from "./events";

export const DevScenarioSchema = z.object({
  id: z.string(), patientId: z.string(), encounterId: z.string(), label: z.string(), note: z.string(),
  gold: z.array(z.object({ kind: z.enum(["link", "question", "task", "pending_owner"]), subject: z.string(), ownerRole: RoleSchema }).strict()),
  mustNot: z.array(z.string()),
}).strict();
export const DEV_SCENARIOS = z.array(DevScenarioSchema).length(6).parse(scenarios);

// 48-hour synthetic unit envelope. Each fixed event is authored for development;
// it neither reads held-out cases nor claims to be a real EHR/FHIR resource.
export function demoEvents(): ReplayEvent[] {
  const event = (id: string, patientId: string, atMinutes: number, type: ReplayEvent["type"], label: string, extra: Partial<ReplayEvent> = {}) => normalizeJson({
    synthetic: true, id, patientId, encounterId: patientId.replace("P-", "E-"), atMs: atMinutes * 60_000,
    type, label, status: "recorded", sourceProtocol: "FHIR_SHAPED_JSON", trigger: false, ...extra,
  });
  const surgicalNote = DEV_SCENARIOS[0].note;
  const medicalNote = DEV_SCENARIOS[2].note;
  return [
    event("a-admit", "P-101", 0, "admit", "Synthetic inpatient admission recorded"),
    event("p-admit", "P-201", 1, "admit", "Synthetic inpatient admission recorded"),
    event("a-ct-order", "P-101", 10, "order", "Existing CT order", { subjectId: "a-ct" }),
    event("p-bcx-order", "P-201", 12, "order", "Existing blood-culture order", { subjectId: "p-bcx" }),
    event("a-ct-slot", "P-101", 15, "schedule", "Existing CT slot recorded", { subjectId: "a-ct" }),
    event("p-bcx-collected", "P-201", 20, "human_attestation", "Lab records ordered specimen collection", { subjectId: "p-bcx:collect" }),
    event("a-ct-transport", "P-101", 25, "human_attestation", "Transport records arrival at scheduled CT", { subjectId: "a-ct:transport" }),
    event("a-ct-scan", "P-101", 40, "human_attestation", "Radiology records scan completion", { subjectId: "a-ct:scan" }),
    event("a-ct-pre", "P-101", 50, "result", "Preliminary CT report available", { status: "preliminary", subjectId: "a-ct" }),
    event("a-ct-final", "P-101", 90, "result", "Final CT report available", { status: "final", subjectId: "a-ct" }),
    event("a-or-booked", "P-101", 120, "schedule", "Clinician-booked OR slot", { subjectId: "a-or", scheduledForMs: 240 * 60_000 }),
    event("a-proposal-trigger", "P-101", 130, "signout", "Surgical handover triggers proposal", { text: surgicalNote, status: "unsigned", trigger: true, spans: [{ id: "a-note#s1", start: 0, end: surgicalNote.length }] }),
    event("a-or-moved", "P-101", 135, "schedule", "Existing OR slot rescheduled; proposals need revalidation", { subjectId: "a-or", scheduledForMs: 360 * 60_000 }),
    event("a-path-pending", "P-101", 500, "result", "Surgical pathology pending; supplied follow-up owner: surgeon", { status: "pending", subjectId: "a-path" }),
    event("p-bcx-pre", "P-201", 700, "result", "Blood culture preliminary; final result pending", { status: "preliminary", subjectId: "p-bcx" }),
    event("p-night-signout", "P-201", 720, "signout", "Night sign-out triggers commitment reconciliation", { text: medicalNote, status: "unsigned", trigger: true, spans: [{ id: "p-note#s1", start: 0, end: medicalNote.length }] }),
    event("a-ride-confirmed", "P-101", 1300, "human_attestation", "CM confirms ride; room vacancy remains separate"),
    event("a-vacancy", "P-101", 1400, "room_vacated", "RN confirms room physically vacated"),
    event("a-clean", "P-101", 1430, "human_attestation", "EVS confirms cleaning completed"),
    event("a-bed-ready", "P-101", 1435, "human_attestation", "EVS confirms bed ready"),
    event("p-followup-handover", "P-201", 2500, "signout", "Pending culture and named owner retained at discharge", { status: "unsigned", text: "Blood culture final pending; follow-up owner: hospitalist." }),
    event("unit-end", "P-201", 2880, "human_attestation", "End of synthetic 48-hour replay; unresolved items stay pending"),
  ];
}
