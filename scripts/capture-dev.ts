// Explicit local development action: resets only the synthetic replay.
// Never reads heldout/ or dotenv. Live calls use the existing funding ledger.
import { writeFile } from "node:fs/promises";
import { runtimeDatabase } from "../src/db/runtime";
import { ReplayStore } from "../src/db/replay-store";
import { AgentStore } from "../src/db/agent-store";
async function main() {
  if (process.env.META_LIVE_ENABLED !== "true") throw new Error("LIVE_DISABLED");
  const variant = process.argv[2] ?? "pneumonia";
  if (!["pneumonia", "appendicitis-before", "appendicitis-after"].includes(variant)) throw new Error("DEVELOPMENT_SCENARIO_REQUIRED");
  const connection = await runtimeDatabase();
  try {
    const replay = new ReplayStore(connection), now = Date.now();
    await replay.state(now - 200_000, "reset"); await replay.state(now - 200_000, 2000);
    await replay.state(now - 200_000, "play"); await replay.state(now - 100_000);
    if (variant === "pneumonia") { await replay.state(now - 100_000, "play"); await replay.state(now); }
    if (variant === "appendicitis-after") await replay.state(now - 100_000, "step");
    const state = await replay.state(now, "pause");
    if (state.clock.cursor !== (variant === "pneumonia" ? 16 : variant === "appendicitis-after" ? 13 : 12)) throw new Error("EXPECTED_DEVELOPMENT_TRIGGER_NOT_REACHED");
    const store = new AgentStore(connection);
    let run = await store.start(variant === "pneumonia" ? "E-201" : "E-101", "rn-charge", "LIVE META");
    const deadline = Date.now() + 100_000;
    while (["ready", "calling"].includes(run.status) && Date.now() < deadline) {
      if (run.status === "calling") { await new Promise((done) => setTimeout(done, 250)); run = await store.get(run.id); continue; }
      run = await store.step(run.id);
      console.log(JSON.stringify({ runId: run.id, status: run.status, requests: run.requests, functions: run.functions, costMicrousd: run.costMicrousd, errorCode: run.errorCode }));
    }
    const report = { ...run, scenarioId: variant === "pneumonia" ? "dev-pneumonia-signout" : "dev-appendicitis-slot", eventId: variant === "pneumonia" ? "p-night-signout" : variant === "appendicitis-after" ? "a-or-moved" : "a-proposal-trigger", synthetic: true };
    await writeFile(`data/dev-capture-${run.id}.json`, JSON.stringify(report, null, 2) + "\n");
    if (run.status !== "staged") process.exitCode = 1;
  } finally { connection.client.close(); }
}
main().catch((error) => { const code = error && typeof error === "object" && typeof error.code === "string" && /^[A-Z_0-9]+$/.test(error.code) ? error.code : error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : "DETAILS_WITHHELD"; console.error(JSON.stringify({ error: "DEVELOPMENT_CAPTURE_REFUSED", code })); process.exitCode = 1; });
