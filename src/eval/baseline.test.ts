import { describe, expect, it } from "vitest";
import { DEV_SCENARIOS } from "@/replay/scenarios";
import { devContext } from "./dev-context";
import { rulesBaseline } from "./baseline";
import { scoreItems } from "./metrics";
import { validateProposal } from "@/domain/validator";

describe("strong rules baseline with the shared validator", () => {
  it.each(DEV_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))("produces a valid, cited operational proposal: %s", (_, scenario) => {
    const { graph, actor, roster } = devContext(scenario);
    const result = rulesBaseline(graph, actor, roster);
    expect(result.mode).toBe("RULES BASELINE"); expect(result.tokens).toBe(0); expect(result.costMicrousd).toBe(0);
    expect(result.proposal).not.toBeNull();
    expect(result.validation?.ok).toBe(true);
    for (const item of result.items) expect(item.sourceIds.every((id) => graph.sources.some((source) => source.id === id))).toBe(true);
    expect(result.proposal?.actions.some((action) => action.type === "transition_task" && action.state === "done")).toBe(false);
  });
  it("captures abbreviation commitments, pending results, and both missing CM tasks", () => {
    const { graph, actor, roster } = devContext(DEV_SCENARIOS[2]);
    const result = rulesBaseline(graph, actor, roster);
    expect(result.items.map((item) => item.key)).toEqual(expect.arrayContaining(["blood_culture_pending", "home_oxygen_coordination", "pcp_coordination"]));
    const created = result.proposal!.actions.filter((action) => action.type === "create_task");
    expect(created).toHaveLength(2);
    expect(created.every((action) => action.type === "create_task" && action.task.state === "proposed")).toBe(true);
  });
  it("flags a note/result conflict without repeating it as a final-negative fact", () => {
    const { graph, actor, roster } = devContext(DEV_SCENARIOS[3]);
    const result = rulesBaseline(graph, actor, roster);
    expect(result.items.some((item) => item.key === "note_result_conflict")).toBe(true);
    expect(result.proposal!.actions.every((action) => action.type !== "stage_draft")).toBe(true);
  });
  it("uses the same stale-version and role acceptance checks as a model", () => {
    const { graph, actor, roster } = devContext(DEV_SCENARIOS[2]);
    const result = rulesBaseline(graph, actor, roster);
    const stale = validateProposal({ ...graph, version: 1 }, result.proposal, roster);
    expect(stale.ok ? [] : stale.issues.map((issue) => issue.code)).toContain("STALE_VERSION");
    const wrongRole = validateProposal(graph, result.proposal, roster, roster.find((person) => person.role === "lab")!);
    expect(wrongRole.ok ? [] : wrongRole.issues.map((issue) => issue.code)).toContain("ACCEPT_SCOPE_DENIED");
  });
});

describe("evaluation counts and honest denominators", () => {
  it("matches items one-to-one and penalizes extra detections", () => {
    const item = { key: "blood_culture_pending" as const, kind: "link" as const, subject: "Blood culture final pending", ownerRole: "hospitalist" as const, sourceIds: ["source"] };
    const metrics = scoreItems([item, item], [{ kind: "link", subject: "Blood culture preliminary", ownerRole: "hospitalist" }]);
    expect(metrics.truePositive).toBe(1); expect(metrics.falsePositive).toBe(1); expect(metrics.precision).toBe(0.5); expect(metrics.recall).toBe(1);
  });
  it("reports missing detections and wrong ownership separately", () => {
    const metrics = scoreItems([{ key: "ride", kind: "question", subject: "Ride confirmation", ownerRole: "lab", sourceIds: ["source"] }], [
      { kind: "question", subject: "Ride confirmation", ownerRole: "case_management" }, { kind: "task", subject: "PCP visit", ownerRole: "case_management" },
    ]);
    expect(metrics.recall).toBe(0.5); expect(metrics.ownerAccuracy).toBe(0); expect(metrics.falseNegative).toBe(1);
  });
  it("does not let duplicate subjects inflate per-kind recall", () => {
    const item = { key: "blood_culture_pending" as const, kind: "link" as const, subject: "Blood culture pending", ownerRole: "hospitalist" as const, sourceIds: ["source"] };
    const metrics = scoreItems([item, item], [
      { kind: "link", subject: "Blood culture pending", ownerRole: "hospitalist" },
      { kind: "link", subject: "CT report", ownerRole: "radiology" },
    ]);
    expect(metrics.recall).toBe(0.5);
    expect(metrics.byKind.link).toEqual({ expected: 2, predicted: 2, recall: 0.5, precision: 0.5 });
  });
  it("leaves undefined precision/recall as n/a, not a fabricated 100%", () => {
    const metrics = scoreItems([], []); expect(metrics.precision).toBeNull(); expect(metrics.recall).toBeNull(); expect(metrics.ownerAccuracy).toBeNull();
  });
});
