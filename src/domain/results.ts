import type { Source } from "./types";

// Event order is preserved on ingest; a final report supersedes a preliminary
// status for that same supplied order. Unrelated tests remain independent.
export function latestResults(sources: readonly Source[]) {
  const latest = new Map<string, Source>();
  for (const source of sources.filter((item) => item.kind === "result").sort((a, b) => (a.occurredAtMs ?? 0) - (b.occurredAtMs ?? 0))) latest.set(source.subjectId ?? source.id, source);
  return [...latest.values()];
}
export function supersededResultIds(sources: readonly Source[]) {
  const latest = new Set(latestResults(sources).map((source) => source.id));
  return new Set(sources.filter((source) => source.kind === "result" && !latest.has(source.id)).map((source) => source.id));
}
