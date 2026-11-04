import { z } from "zod";

export const ReplayEventSchema = z.object({
  synthetic: z.literal(true), id: z.string().min(1), patientId: z.string().regex(/^P-\d+$/),
  encounterId: z.string().regex(/^E-\d+$/), atMs: z.number().int().nonnegative(),
  type: z.enum(["admit", "transfer", "discharge_notification", "room_vacated", "order", "result", "schedule", "signout", "human_attestation"]),
  status: z.enum(["recorded", "pending", "preliminary", "final", "unsigned", "signed"]),
  sourceProtocol: z.enum(["FHIR_SHAPED_JSON", "HL7_SAMPLE"]),
  label: z.string().min(1).max(300), text: z.string().max(6000).optional(),
  subjectId: z.string().optional(), trigger: z.boolean(),
  scheduledForMs: z.number().int().nonnegative().optional(),
  spans: z.array(z.object({ id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict()).optional(),
}).strict();
export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

export function normalizeJson(candidate: unknown): ReplayEvent {
  const event = ReplayEventSchema.parse(candidate);
  if (event.type === "result" && !["pending", "preliminary", "final"].includes(event.status)) throw new Error("RESULT_STATUS_REQUIRED");
  const spanIds = new Set<string>();
  for (const span of event.spans ?? []) {
    if (!event.text || span.start >= span.end || span.end > event.text.length || spanIds.has(span.id)) throw new Error("INVALID_NOTE_SPAN");
    spanIds.add(span.id);
  }
  return event;
}

// Deliberately narrow sample contract, not an HL7 integration/conformance claim.
// Reject real-looking senders/identities rather than accepting arbitrary messages.
export function normalizeHl7Sample(message: string, atMs: number): ReplayEvent {
  if (message.length > 10_000) throw new Error("SAMPLE_TOO_LARGE");
  const segments = message.trim().split(/\r\n|\r|\n/).map((line) => line.split("|"));
  const segment = (name: string) => segments.find((fields) => fields[0] === name);
  const msh = segment("MSH"), pid = segment("PID"), pv1 = segment("PV1");
  // MSH-1 is the separator itself, so split-array indices differ from other segments.
  if (msh?.[2] !== "SYNTHETIC_DEMO" || !msh[9] || !pid?.[3] || !pv1?.[19]) throw new Error("SYNTHETIC_SAMPLE_CONTRACT_REQUIRED");
  const [messageType, trigger] = msh[8]?.split("^") ?? [];
  const identity = { synthetic: true as const, id: msh[9], patientId: pid[3].split("^")[0], encounterId: pv1[19].split("^")[0], atMs, sourceProtocol: "HL7_SAMPLE" as const, trigger: false };
  if (messageType === "ADT" && ["A01", "A02", "A03"].includes(trigger)) {
    const type = ({ A01: "admit", A02: "transfer", A03: "discharge_notification" } as const)[trigger as "A01" | "A02" | "A03"];
    // A03 is a discharge notification. It is not evidence of physical vacancy.
    // Preserve it as an ADT status fact; explicit human vacancy is a separate event.
    return normalizeJson({ ...identity, type, status: "recorded", label: trigger === "A03" ? "ADT discharge notification; physical room vacancy unconfirmed" : `Synthetic ADT ${trigger}`, subjectId: pv1[3] || undefined });
  }
  if (messageType === "ORU" && trigger === "R01") {
    if (segments.filter((fields) => fields[0] === "OBX").length !== 1) throw new Error("SINGLE_OBSERVATION_SAMPLE_REQUIRED");
    const obx = segment("OBX"), obr = segment("OBR");
    const status = obx?.[11] === "P" ? "preliminary" : obx?.[11] === "F" ? "final" : undefined;
    if (!status || !obr?.[3]) throw new Error("SAMPLE_RESULT_STATUS_REQUIRED");
    return normalizeJson({ ...identity, type: "result", status, label: obx?.[3]?.split("^")[1] || "Synthetic result", text: obx?.[5] || "", subjectId: obr[3] });
  }
  if (messageType === "SIU" && ["S12", "S13"].includes(trigger)) {
    const sch = segment("SCH");
    if (!sch?.[1]) throw new Error("SAMPLE_SCHEDULE_ID_REQUIRED");
    return normalizeJson({ ...identity, type: "schedule", status: "recorded", label: trigger === "S13" ? "Existing OR slot rescheduled" : "Existing OR slot booked", subjectId: sch[1] });
  }
  throw new Error("UNSUPPORTED_HL7_SAMPLE_TYPE");
}
