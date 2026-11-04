import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { AgentStore } from "@/db/agent-store";
import { runtimeDatabase } from "@/db/runtime";
import { auditEntries, ledgerEntries, fundingRecords } from "@/db/schema";
import { FundingSchema } from "@/lib/budget";
import { validateFundingEvidence } from "@/lib/meta-smoke";
import { BUDGET_CAPS_USD } from "@/lib/config";
import { commandBody, commandError, NO_STORE } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), encounterId: z.enum(["E-101", "E-201"]), actorId: z.enum(["rn-charge", "md-hospitalist", "lab-owner", "cm-owner"]), mode: z.enum(["LIVE META", "RECORDED META", "RULES BASELINE"]) }).strict(),
  z.object({ action: z.literal("step"), runId: z.string().uuid() }).strict(),
]);
export async function GET() {
  try {
    const connection = await runtimeDatabase(); const store = new AgentStore(connection);
    const [runs, proposals, audit, ledger] = await Promise.all([store.recent(), store.proposalInbox(), connection.db.select().from(auditEntries).orderBy(desc(auditEntries.createdAt)).limit(40), connection.db.select().from(ledgerEntries)]);
    const spent = ledger.reduce((sum, row) => sum + (row.state === "settled" ? row.actualMicrousd ?? row.reservedMicrousd : 0), 0);
    const reserved = ledger.reduce((sum, row) => sum + (["reserved", "uncertain"].includes(row.state) ? row.reservedMicrousd : 0), 0);
    const [record] = await connection.db.select().from(fundingRecords).where(eq(fundingRecords.id, "active"));
    let grantStatus = "Verification required before live calls";
    const funding = FundingSchema.safeParse(record?.evidence);
    if (funding.success) {
      try { const proof = validateFundingEvidence(funding.data.evidence, Date.now()); grantStatus = proof.grantValidityBasis ? "Current balance confirmed by user; grant expiry unknown" : "Current grant verified"; }
      catch { grantStatus = "Funding evidence needs a refresh; live requests stay blocked"; }
    }
    return Response.json({ synthetic: true, runs, proposals, audit, budget: { caps: BUDGET_CAPS_USD, localSpentMicrousd: spent, localReservedMicrousd: reserved, uncertainRequests: ledger.filter((row) => row.state === "uncertain").length, grantStatus } }, { headers: NO_STORE });
  } catch { return Response.json({ error: "Agent state unavailable" }, { status: 503, headers: NO_STORE }); }
}
export async function POST(request: Request) {
  try {
    const body = await commandBody(request, Command, 512); const store = new AgentStore(await runtimeDatabase());
    return Response.json(body.action === "start" ? await store.start(body.encounterId, body.actorId, body.mode) : await store.step(body.runId), { headers: NO_STORE });
  } catch (error) { return commandError(error); }
}
