// Local operator action only: existing human evidence plus settled real smoke.
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { runtimeDatabase } from "../src/db/runtime";
import { fundingRecords, ledgerEntries } from "../src/db/schema";
import { validateFundingEvidence } from "../src/lib/meta-smoke";
import { FundingSchema } from "../src/lib/budget";
async function main() {
  const evidence = validateFundingEvidence(JSON.parse(await readFile("data/b2-smoke-approval.json", "utf8")), Date.now());
  const initial = JSON.parse(await readFile("data/b2-smoke-report.json", "utf8"));
  const report = initial.connectivityOk ? initial : JSON.parse(await readFile("data/b2-smoke-followup-report.json", "utf8"));
  if (report.connectivityOk !== true || report.status !== "completed" || !report.responseId) throw new Error("SUCCESSFUL_REAL_SMOKE_REQUIRED");
  const connection = await runtimeDatabase();
  try {
    const ledger = await connection.db.select().from(ledgerEntries);
    const settled = ledger.find((entry) => entry.id === (report.authorizationId ?? "B2-SMOKE-01"));
    if (!settled || settled.state !== "settled" || settled.actualMicrousd !== report.actualMicrousd || ledger.some((entry) => ["reserved", "uncertain"].includes(entry.state))) throw new Error("RECONCILED_REAL_LEDGER_REQUIRED");
    const proof = FundingSchema.parse({ evidence, smokePassed: true, runtimeApproved: true });
    await connection.db.insert(fundingRecords).values({ id: "active", evidence: proof }).onConflictDoUpdate({ target: fundingRecords.id, set: { evidence: proof } });
    console.log(JSON.stringify({ fundingActivated: true, source: evidence.grantValidityBasis ?? "verified_dashboard", grantExpiryKnown: Boolean(evidence.grantExpiresAt), localSettledMicrousd: ledger.reduce((sum, entry) => sum + (entry.actualMicrousd ?? 0), 0), protectedReserveUsd: 30 }));
  } finally { connection.client.close(); }
}
main().catch(() => { console.error("FUNDING_ACTIVATION_REFUSED"); process.exitCode = 1; });
