import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DatabaseConnection } from "@/db/client";
import { fundingRecords, ledgerEntries } from "@/db/schema";
import { BUDGET_CAPS_USD, MODEL_LIMITS } from "./config";
import { SmokeApprovalSchema, validateFundingEvidence } from "./meta-smoke";

export type RuntimeBucket = "runtimeDev" | "heldoutEval" | "publicDemo";
type PaidBucket = RuntimeBucket | "museBuild";
export const MUSE_BODY_LIMIT = 196_608;
export const MUSE_RUN_CAP_MICROUSD = 1_000_000;
export const FundingSchema = z.object({ evidence: SmokeApprovalSchema, smokePassed: z.literal(true), runtimeApproved: z.literal(true) }).strict();
export class BudgetError extends Error { constructor(public readonly code: string) { super(code); } }
export function worstCaseMicrousd(bodyBytes: number) {
  if (!Number.isInteger(bodyBytes) || bodyBytes < 0 || bodyBytes > MODEL_LIMITS.requestBodyBytes) throw new BudgetError("REQUEST_SIZE_BOUND");
  return Math.ceil((bodyBytes + 2048) * 1.25 + MODEL_LIMITS.outputTokens * 4.25);
}
export async function reserveModelRequest(connection: DatabaseConnection, input: { id: string; bucket: RuntimeBucket; bodyBytes: number; now?: number }) {
  if (!["runtimeDev", "heldoutEval", "publicDemo"].includes(input.bucket) || !input.id || input.id.length > 200) throw new BudgetError("INVALID_RESERVATION_SCOPE");
  return reserveRequest(connection, { ...input, reserve: worstCaseMicrousd(input.bodyBytes) });
}
export async function reserveMuseRequest(connection: DatabaseConnection, input: { id: string; runId: string; bodyBytes: number; now?: number }) {
  if (!/^[a-f0-9-]{36}$/.test(input.runId) || !input.id.startsWith(`muse:${input.runId}:`) || !Number.isInteger(input.bodyBytes) || input.bodyBytes < 0 || input.bodyBytes > MUSE_BODY_LIMIT) throw new BudgetError("INVALID_MUSE_RESERVATION");
  const reserve = Math.ceil((input.bodyBytes + 2048) * 1.25 + MODEL_LIMITS.outputTokens * 4.25);
  return reserveRequest(connection, { ...input, bucket: "museBuild", reserve, runPrefix: `muse:${input.runId}:` });
}
async function reserveRequest(connection: DatabaseConnection, input: { id: string; bucket: PaidBucket; reserve: number; now?: number; runPrefix?: string }) {
  const now = input.now ?? Date.now(), reserve = input.reserve;
  return connection.db.transaction(async (tx) => {
    const [record] = await tx.select().from(fundingRecords).where(eq(fundingRecords.id, "active"));
    const proof = FundingSchema.safeParse(record?.evidence);
    if (!proof.success) throw new BudgetError("VERIFIED_FUNDING_AND_SMOKE_REQUIRED");
    try { validateFundingEvidence(proof.data.evidence, now); } catch { throw new BudgetError("FUNDING_EXPIRED_STALE_OR_UNRECONCILED"); }
    const entries = await tx.select().from(ledgerEntries);
    if (entries.some((entry) => entry.id === input.id)) throw new BudgetError("REQUEST_ALREADY_RESERVED");
    if (entries.some((entry) => entry.state === "uncertain")) throw new BudgetError("UNCERTAIN_USAGE_REQUIRES_RECONCILIATION");
    const committed = (entry: typeof entries[number]) => entry.state === "released" ? 0 : entry.state === "settled" ? entry.actualMicrousd ?? entry.reservedMicrousd : entry.reservedMicrousd;
    const total = entries.reduce((sum, entry) => sum + committed(entry), 0);
    const bucketTotal = entries.filter((entry) => entry.bucket === input.bucket).reduce((sum, entry) => sum + committed(entry), 0);
    if (input.runPrefix && entries.filter((entry) => entry.id.startsWith(input.runPrefix!)).reduce((sum, entry) => sum + committed(entry), 0) + reserve > MUSE_RUN_CAP_MICROUSD) throw new BudgetError("MUSE_RUN_CAP_REACHED");
    const external = proof.data.evidence.externalSpentMicrousd;
    if (bucketTotal + external[input.bucket] + reserve > BUDGET_CAPS_USD[input.bucket] * 1_000_000) throw new BudgetError("BUCKET_CAP_REACHED");
    if (proof.data.evidence.remainingGrantMicrousd - total - reserve < BUDGET_CAPS_USD.reserve * 1_000_000) throw new BudgetError("NEVER_SPENT_RESERVE_PROTECTED");
    if (Object.values(external).reduce((sum, spent) => sum + spent, 0) + total + reserve > 120_000_000) throw new BudgetError("COMBINED_CAP_REACHED");
    await tx.insert(ledgerEntries).values({ id: input.id, bucket: input.bucket, reservedMicrousd: reserve, state: "reserved", createdAt: new Date(now).toISOString() });
    return reserve;
  });
}
export async function markUncertain(connection: DatabaseConnection, id: string) {
  await connection.db.update(ledgerEntries).set({ state: "uncertain" }).where(eq(ledgerEntries.id, id));
}
const UsageSchema = z.object({ input_tokens: z.number().int().nonnegative().max(MUSE_BODY_LIMIT + 2048), output_tokens: z.number().int().nonnegative().max(4096) });
export async function settleModelRequest(connection: DatabaseConnection, id: string, usage: unknown) {
  const parsed = UsageSchema.safeParse(usage);
  if (!parsed.success) { await markUncertain(connection, id); throw new BudgetError("MISSING_OR_INVALID_USAGE"); }
  const actual = Math.ceil(parsed.data.input_tokens * 1.25 + parsed.data.output_tokens * 4.25);
  try {
    await connection.db.transaction(async (tx) => {
      const [entry] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, id));
      if (!entry || entry.state !== "reserved" || actual > entry.reservedMicrousd) throw new BudgetError("RESERVATION_MISMATCH");
      await tx.update(ledgerEntries).set({ state: "settled", actualMicrousd: actual }).where(eq(ledgerEntries.id, id));
    });
  } catch (error) { await markUncertain(connection, id); throw error; }
  return { actualMicrousd: actual, usage: parsed.data };
}
