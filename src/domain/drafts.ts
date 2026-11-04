import type { DraftLine, Source, ValidationIssue } from "./types";
import { supersededResultIds } from "./results";

export const BLOCKED_PHRASES = /\b(?:dose|dosage|recommend(?:ed|ation|ations|ing|s)?|should\s+start|safe\s+for\s+discharge|diagnos(?:e|is)|prescrib\w*)\b/i;
const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export function validateDraftLines(lines: readonly DraftLine[], sources: readonly Source[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const superseded = supersededResultIds(sources);
  for (const [index, line] of lines.entries()) {
    const path = `lines.${index}`;
    if (line.sourceIds.some((id) => superseded.has(id))) issues.push({ code: "SUPERSEDED_RESULT", path, message: "Use the current result status for this order." });
    const evidence = line.sourceIds.map((id) => sources.find((source) => source.id === id));
    if (evidence.some((source) => !source) || line.sourceIds.length === 0) {
      issues.push({ code: "UNRESOLVED_SOURCE", path, message: "Every line requires resolvable, visible source IDs." });
      continue;
    }
    if (BLOCKED_PHRASES.test(line.text)) issues.push({ code: "CLINICAL_PHRASE", path, message: "Clinical recommendations are not permitted." });
    const resolved = evidence as Source[];
    const withoutPendingQualification = line.text.replace(/\b(?:final(?:ized)?\s+(?:result\s+)?pending|awaiting\s+final|not\s+final)\b/gi, "");
    if (resolved.some((source) => source.status === "preliminary" || source.status === "pending") && /\b(?:negative|final(?:ized)?)\b/i.test(withoutPendingQualification)) {
      issues.push({ code: "PRELIMINARY_AS_FINAL", path, message: "Pending or preliminary evidence cannot establish a final or negative result." });
    }
    // Exact normalized source statements, or their ordered concatenation, are the
    // B2 support contract. A real citation is not permission to invent a claim.
    const statements = resolved.flatMap((source) => source.statements).map(normalize);
    const candidate = normalize(line.text);
    if (!statements.includes(candidate) && candidate !== resolved.flatMap((source) => source.statements).map(normalize).join(" ")) {
      issues.push({ code: "UNSUPPORTED_LINE", path, message: "Text must match normalized source facts; a citation alone is insufficient." });
    }
    for (const source of resolved.filter((source) => source.kind === "medication")) {
      if (line.text !== source.text) issues.push({ code: "MEDICATION_NOT_VERBATIM", path, message: "Medication text must be verbatim structured data." });
    }
  }
  return issues;
}
