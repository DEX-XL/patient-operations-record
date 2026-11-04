import { readFile, writeFile, mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { agentRuns, ledgerEntries } from "../src/db/schema";
import { RecordingSchema } from "../src/agent/recordings";
import { contextFingerprint } from "../src/db/agent-store";
import type { promptContext } from "../src/agent/tools";

async function main() {
  const [runId, scenarioId, eventId] = process.argv.slice(2);
  if (!/^[a-f0-9-]{36}$/.test(runId ?? "") || !/^[a-z0-9-]+$/.test(scenarioId ?? "") || !/^[a-z0-9-]+$/.test(eventId ?? "")) throw new Error("Invalid recording identifiers");
  const connection = connectDatabase("file:data/patient-ops.db");
  try {
    const [run] = await connection.db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    const ledger = await connection.db.select().from(ledgerEntries);
    const charges = ledger.filter((entry) => entry.id.startsWith(`${runId}:`));
    if (!run || run.mode !== "LIVE META" || run.status !== "staged" || !run.state.responseIds.length || !charges.length || charges.some((entry) => entry.state !== "settled")) throw new Error("A completed, reconciled live capture is required");
    const initial = run.state.input[0] as { content?: Array<{ text?: string }> };
    const context = JSON.parse(initial.content?.[0]?.text ?? "null") as ReturnType<typeof promptContext>;
    if (!context?.synthetic) throw new Error("Synthetic context required");
    const recording = RecordingSchema.parse({ capturedFrom: "LIVE META", model: "muse-spark-1.3", runId, responseIds: run.state.responseIds, capturedAt: new Date(run.createdAt).toISOString(), scenarioId, eventId, encounterId: run.encounterId, actorId: run.actorId, contextHash: contextFingerprint(context), promptHash: run.promptHash, actions: run.actions, trace: run.state.trace, originalCostMicrousd: run.costMicrousd, originalUsage: run.state.usage });
    await mkdir("fixtures/recordings", { recursive: true });
    const name = `${scenarioId}__${eventId}__${recording.promptHash}.json`;
    const manifest = JSON.parse(await readFile("fixtures/recordings/index.json", "utf8")) as string[];
    await writeFile(`fixtures/recordings/${name}`, JSON.stringify(recording, null, 2) + "\n");
    await writeFile("fixtures/recordings/index.json", JSON.stringify([...new Set([...manifest, name])].sort(), null, 2) + "\n");
    console.log(`Exported synthetic live capture: ${name}`);
  } finally { connection.client.close(); }
}
main().catch(() => { console.error("Recording export refused. No live capture was invented."); process.exitCode = 1; });
