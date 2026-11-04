import { describe, expect, it } from "vitest";
import { testGraph } from "./test-fixtures";
import { latestResults } from "./results";
import { validateDraftLines } from "./drafts";
import { rulesBaseline } from "@/eval/baseline";
import { DEMO_ROSTER } from "./roster";

describe("result lifecycle survives department and shift handoffs", () => {
  it("uses the latest event for each order, without merging unrelated tests", () => {
    const graph = testGraph();
    graph.sources.find((source) => source.id === "result-pre")!.subjectId = "culture-order";
    graph.sources.find((source) => source.id === "result-pre")!.occurredAtMs = 1;
    graph.sources.find((source) => source.id === "result-final")!.subjectId = "culture-order";
    graph.sources.find((source) => source.id === "result-final")!.occurredAtMs = 2;
    expect(latestResults(graph.sources).map((source) => source.id)).toEqual(["result-final"]);
    expect(validateDraftLines([{ text: "Blood culture preliminary; final result pending.", sourceIds: ["result-pre"] }], graph.sources).map((issue) => issue.code)).toContain("SUPERSEDED_RESULT");
    const baseline = rulesBaseline(graph, DEMO_ROSTER.find((person) => person.id === "md-hospitalist")!, DEMO_ROSTER);
    expect(baseline.items.some((item) => item.key === "blood_culture_pending")).toBe(false);
  });
});
