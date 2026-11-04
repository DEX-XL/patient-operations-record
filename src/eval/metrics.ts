import type { Finding, Role } from "@/domain/types";
export type GoldItem = { kind: Finding["kind"]; subject: string; ownerRole: Role };
export type ScoredItem = GoldItem & { key?: string; sourceIds?: readonly string[] };

export function subjectKey(subject: string) {
  const text = subject.toLowerCase();
  if (/copied note|note.*preliminary/.test(text)) return "note_result_conflict";
  if (/blood.?culture|bcx/.test(text)) return "blood_culture";
  if (/pathology/.test(text)) return "pathology";
  if (/home.*(?:oxygen|o2)/.test(text)) return "home_oxygen";
  if (/pcp|primary care/.test(text)) return "pcp";
  if (/home health/.test(text)) return "home_health";
  if (/vacan/.test(text)) return "room_vacancy";
  if (/echo/.test(text)) return "echo";
  if (/ride/.test(text)) return "ride";
  if (/ct/.test(text)) return "ct";
  return text.trim().replace(/\s+/g, " ");
}
export function scoreItems(predicted: readonly ScoredItem[], gold: readonly GoldItem[]) {
  const remaining = new Set(gold.map((_, index) => index));
  const matches: GoldItem[] = [];
  let truePositive = 0, ownerCorrect = 0;
  const key = (item: GoldItem) => `${item.kind}:${subjectKey(item.subject)}`;
  for (const item of predicted) {
    const match = [...remaining].find((index) => key(gold[index]) === key(item));
    if (match === undefined) continue;
    remaining.delete(match); truePositive++; matches.push(gold[match]);
    if (gold[match].ownerRole === item.ownerRole) ownerCorrect++;
  }
  const falsePositive = predicted.length - truePositive;
  const falseNegative = gold.length - truePositive;
  const byKind = Object.fromEntries((["link", "question", "task", "pending_owner"] as const).map((kind) => {
    const expected = gold.filter((item) => item.kind === kind);
    const actual = predicted.filter((item) => item.kind === kind);
    const matched = matches.filter((item) => item.kind === kind).length;
    return [kind, { expected: expected.length, predicted: actual.length, recall: expected.length ? matched / expected.length : null, precision: actual.length ? matched / actual.length : null }];
  }));
  return { truePositive, falsePositive, falseNegative, recall: gold.length ? truePositive / gold.length : null, precision: predicted.length ? truePositive / predicted.length : null, ownerAccuracy: truePositive ? ownerCorrect / truePositive : null, byKind };
}
