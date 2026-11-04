import { describe, expect, it } from "vitest";
import { DEV_SCENARIOS } from "@/replay/scenarios";
import { rulesBaseline } from "./baseline";
import { devContext } from "./dev-context";
import { proposalObservations } from "./observations";
import { scoreItems } from "./metrics";

function actions() {
  const { graph, actor, roster } = devContext(DEV_SCENARIOS[2]);
  return rulesBaseline(graph, actor, roster).proposal!.actions;
}
describe("common action observations before held-out exposure", () => {
  it("counts an additional coordination task as an extra item for the baseline too", () => {
    const observed = proposalObservations(actions());
    expect(observed.filter(item => item.kind === "task")).toHaveLength(2);
    const score = scoreItems(observed, DEV_SCENARIOS[2].gold);
    expect(score.falsePositive).toBe(2); expect(score.precision).toBe(0.6);
  });
  it("does not count a PCP finding plus its created task as two task hits", () => {
    const observed = proposalObservations(actions());
    expect(observed.filter(item => item.kind === "task" && /PCP/.test(item.subject))).toHaveLength(1);
  });
  it("scores an actual task even without a separate finding", () => {
    const task = actions().find(action => action.type === "create_task" && action.task.templateStep === "discharge:pcp")!;
    expect(proposalObservations([task])).toMatchObject([{ kind: "task", ownerRole: "case_management" }]);
  });
  it("retains other created tasks as predictions rather than silently dropping extras", () => {
    const task = actions().find(action => action.type === "create_task")!;
    if (task.type !== "create_task") throw new Error("fixture");
    const observed = proposalObservations([{ ...task, task: { ...task.task, templateStep: undefined, label: "Extra paperwork coordination" } }]);
    expect(observed[0].subject).toBe("Extra paperwork coordination");
    expect(scoreItems(observed, []).falsePositive).toBe(1);
  });
});
