import { readFile, writeFile } from "node:fs/promises";
import { connectDatabase } from "../src/db/client";
import { executeSmoke, SMOKE_REQUEST, SMOKE_RESERVATION_MICROUSD, SmokeError } from "../src/lib/meta-smoke";
import { resolveMetaCredential } from "../src/lib/meta-credential";

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ dryRun: true, request: SMOKE_REQUEST, reserveMicrousd: SMOKE_RESERVATION_MICROUSD, requests: 1, retries: 0, timeoutMs: 30_000 }, null, 2));
    return;
  }
  // The only file this script may read is a designated nonsecret approval record.
  // Never accept a caller-supplied path, dotenv file or arbitrary context input.
  const approval = JSON.parse(await readFile("data/b2-smoke-approval.json", "utf8"));
  const connection = connectDatabase("file:data/patient-ops.db");
  try {
    const followup = process.argv.includes("--finish");
    if (followup) {
      const initial = JSON.parse(await readFile("data/b2-smoke-report.json", "utf8"));
      if (initial.status !== "incomplete" || initial.connectivityOk !== false) throw new SmokeError("SMOKE_FOLLOWUP_BOUND");
    }
    const report = await executeSmoke({ connection, approval, apiKey: await resolveMetaCredential(), liveEnabled: process.env.META_LIVE_ENABLED === "true", followup });
    await writeFile(followup ? "data/b2-smoke-followup-report.json" : "data/b2-smoke-report.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
    if (!report.connectivityOk) process.exitCode = 1;
  } finally { connection.client.close(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof SmokeError ? error.code : "SMOKE_SETUP_FAILED_DETAILS_WITHHELD");
  process.exitCode = 1;
});
