import { runtimeDatabase } from "../src/db/runtime";
import { agentRuns, ledgerEntries } from "../src/db/schema";
async function main() {
  const connection = await runtimeDatabase();
  try {
    const ledger = await connection.db.select().from(ledgerEntries), runs = await connection.db.select().from(agentRuns);
    const buckets = Object.fromEntries(["museBuild", "runtimeDev", "heldoutEval", "publicDemo"].map((bucket) => [bucket, { spentMicrousd: ledger.filter((row) => row.bucket === bucket && row.state === "settled").reduce((sum, row) => sum + (row.actualMicrousd ?? 0), 0), reservedMicrousd: ledger.filter((row) => row.bucket === bucket && ["reserved", "uncertain"].includes(row.state)).reduce((sum, row) => sum + row.reservedMicrousd, 0) }]));
    console.log(JSON.stringify({ buckets, settledRequests: ledger.filter((row) => row.state === "settled").length, uncertainRequests: ledger.filter((row) => row.state === "uncertain").length, activeRuns: runs.filter((run) => ["ready", "calling"].includes(run.status)).map((run) => ({ id: run.id, status: run.status })), latestRuns: runs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map((run) => ({ id: run.id, mode: run.mode, status: run.status, errorCode: run.errorCode, requests: run.state.requests, functions: run.state.functions, costMicrousd: run.costMicrousd, tools: run.state.trace.map((trace) => ({ name: trace.name, ok: trace.ok })) })) }, null, 2));
  } finally { connection.client.close(); }
}
main().catch(() => { console.error("USAGE_REPORT_UNAVAILABLE"); process.exitCode = 1; });
