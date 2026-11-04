import type { Role, Source } from "./types";
import { latestResults } from "./results";

export const FINDING_DEFINITIONS = {
  ct_report: { label: "CT final report", ownerRole: "surgeon", kinds: ["link"], question: "The existing final CT report is linked without interpreting its contents.", pattern: /\bCT\b/i },
  blood_culture_pending: { label: "Blood culture final pending", ownerRole: "hospitalist", kinds: ["link", "pending_owner"], question: "Confirm the recorded blood-culture follow-up owner.", pattern: /\b(?:BCx|blood[ -]?cultures?)\b/i },
  home_oxygen_coordination: { label: "Home oxygen arrangement with note author", ownerRole: "case_management", kinds: ["question"], question: "The note mentions home oxygen. Confirm the existing coordination request with its author; this is not an oxygen order.", pattern: /\bhome\s+(?:O2|oxygen)\b/i },
  pcp_coordination: { label: "PCP follow-up arrangement", ownerRole: "case_management", kinds: ["task"], question: "Confirm the follow-up arrangement already mentioned in the note; this does not create an appointment or order.", pattern: /\b(?:PCP|primary care)\b/i },
  pathology_pending: { label: "Surgical pathology", ownerRole: "surgeon", kinds: ["pending_owner"], question: "Confirm the named owner of the recorded pending pathology report.", pattern: /\b(?:path|pathology)\b/i },
  note_result_conflict: { label: "Copied note versus preliminary result", ownerRole: "hospitalist", kinds: ["question"], question: "The note wording and structured result status differ. Ask the author to reconcile them; do not interpret the result.", pattern: /\b(?:final|negative)\b/i },
  room_vacancy: { label: "Room vacancy confirmation", ownerRole: "charge_rn", kinds: ["question"], question: "Confirm physical room vacancy separately from the ADT discharge notification.", pattern: /\b(?:vacan\w*|room\s+empty)\b/i },
  echo_slot: { label: "Existing echo slot", ownerRole: "radiology", kinds: ["question"], question: "Confirm the slot for the echo already mentioned as ordered; this does not order a test.", pattern: /\becho\b/i },
  home_health: { label: "Home health referral", ownerRole: "case_management", kinds: ["pending_owner"], question: "Confirm the receiving owner and acknowledgment for the existing referral.", pattern: /\b(?:HH|home health)\b/i },
  ride: { label: "Ride confirmation", ownerRole: "case_management", kinds: ["question"], question: "Confirm the ride arrangement mentioned in the note.", pattern: /\b(?:ride|pickup)\b/i },
} as const;
export type FindingKey = keyof typeof FINDING_DEFINITIONS;
export const FINDING_KEYS = Object.keys(FINDING_DEFINITIONS) as [FindingKey, ...FindingKey[]];
export function findingSupported(key: FindingKey, sourceIds: readonly string[], sources: readonly Source[]) {
  const evidence = sources.filter((source) => sourceIds.includes(source.id));
  const definition = FINDING_DEFINITIONS[key];
  const note = evidence.filter((source) => source.kind === "note_span").map((source) => source.text).join(" ");
  const current = new Set(latestResults(sources).map((source) => source.id));
  const result = evidence.filter((source) => current.has(source.id) && ["pending", "preliminary"].includes(source.status));
  if (key === "ct_report") return evidence.some((source) => current.has(source.id) && source.status === "final" && definition.pattern.test(source.text));
  if (key === "blood_culture_pending" || key === "pathology_pending") return result.some((source) => definition.pattern.test(source.text));
  if (key === "note_result_conflict") return definition.pattern.test(note) && result.length > 0;
  return definition.pattern.test(note);
}
export function findingRole(key: FindingKey): Role { return FINDING_DEFINITIONS[key].ownerRole; }
