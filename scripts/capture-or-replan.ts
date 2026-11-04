// Continue a real synthetic pre-OR run through its actual SIU reschedule event.
import { writeFile } from "node:fs/promises";
import { runtimeDatabase } from "../src/db/runtime";
import { ReplayStore } from "../src/db/replay-store";
import { AgentStore } from "../src/db/agent-store";
import { OperationsError, OperationsStore } from "../src/db/operations";
import { DEMO_ROSTER } from "../src/domain/roster";
import { criticalPath } from "../src/domain/graph";
async function main() {
  if (process.env.META_LIVE_ENABLED !== "true") throw new Error("LIVE_DISABLED");
  const precedingId = process.argv[2]; if (!/^[a-f0-9-]{36}$/.test(precedingId ?? "")) throw new Error("REAL_PRECEDING_RUN_REQUIRED");
  const connection = await runtimeDatabase();
  try {
    const replay = new ReplayStore(connection), store = new AgentStore(connection), before = await replay.state(Date.now(), "pause"), preceding = await store.get(precedingId);
    if (before.clock.cursor !== 12 || preceding.mode !== "LIVE META" || preceding.status !== "staged" || !preceding.proposalId) throw new Error("PRECEDING_CAPTURE_CONTEXT_REQUIRED");
    const after = await replay.state(Date.now(), "step");
    if (after.clock.cursor !== 13 || after.timeline.at(-1)?.id !== "a-or-moved") throw new Error("ACTUAL_RESCHEDULE_EVENT_REQUIRED");
    let staleRejected = false;
    try { await new OperationsStore(connection, DEMO_ROSTER).accept(preceding.proposalId, "rn-charge"); }
    catch (error) { staleRejected = error instanceof OperationsError && error.details.includes("STALE_VERSION"); }
    if (!staleRejected) throw new Error("STALE_REJECTION_NOT_CONFIRMED");
    const previous = before.panes.charge_rn.find((graph) => graph.encounterId === "E-101")!, current = after.panes.charge_rn.find((graph) => graph.encounterId === "E-101")!;
    const recovery = { synthetic: true, precedingId, staleRejected, eventId: "a-or-moved", previousVersion: previous.version, currentVersion: current.version, previousPlannedMinutes: criticalPath(previous.tasks, previous.dependencies).plannedMinutes, currentPlannedMinutes: criticalPath(current.tasks, current.dependencies).plannedMinutes };
    console.log(JSON.stringify(recovery));
    let run = await store.start("E-101", "rn-charge", "LIVE META"); const deadline = Date.now() + 100_000;
    while (["ready", "calling"].includes(run.status) && Date.now() < deadline) {
      if (run.status === "calling") { await new Promise((done) => setTimeout(done, 250)); run = await store.get(run.id); continue; }
      run = await store.step(run.id); console.log(JSON.stringify({ runId: run.id, status: run.status, requests: run.requests, functions: run.functions, costMicrousd: run.costMicrousd, errorCode: run.errorCode }));
    }
    await writeFile(`data/dev-capture-${run.id}.json`, JSON.stringify({ ...run, recovery, scenarioId: "dev-appendicitis-slot", eventId: "a-or-moved" }, null, 2) + "\n");
    if (run.status !== "staged") process.exitCode = 1;
  } finally { connection.client.close(); }
}
main().catch(() => { console.error("RESCHEDULE_CAPTURE_REFUSED"); process.exitCode = 1; });
