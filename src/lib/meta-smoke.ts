import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DatabaseConnection } from "@/db/client";
import { ledgerEntries } from "@/db/schema";
import { BUDGET_CAPS_USD } from "./config";

export const SMOKE_ID = "B2-SMOKE-01";
export const SMOKE_RESERVATION_MICROUSD = 20_000; // $0.02; no automatic second attempt.
export const SMOKE_FOLLOWUP_ID = "B2-SMOKE-02";
export const SMOKE_REQUEST = Object.freeze({
  model: "muse-spark-1.3", store: false,
  input: "Synthetic connectivity test only. Reply exactly: SYNTHETIC_CONNECTION_OK. Do not give clinical advice or invoke tools.",
  reasoning: { effort: "low" }, max_output_tokens: 128, parallel_tool_calls: false,
});
export const SmokeApprovalSchema = z.object({
  userApproved: z.literal(true),
  grantVerifiedAt: z.string().datetime(), grantExpiresAt: z.string().datetime().optional(),
  grantValidityBasis: z.literal("current_balance_confirmed_by_user").optional(),
  remainingGrantMicrousd: z.number().int().nonnegative().max(150_000_000),
  externalSpentMicrousd: z.object({
    museBuild: z.number().int().nonnegative(), runtimeDev: z.number().int().nonnegative(),
    heldoutEval: z.number().int().nonnegative(), publicDemo: z.number().int().nonnegative(),
  }).strict(),
  sharedUsageReconciled: z.literal(true),
  pricingVerifiedAt: z.string().datetime(),
}).strict().refine((proof) => Boolean(proof.grantExpiresAt) || proof.grantValidityBasis === "current_balance_confirmed_by_user");
export type SmokeApproval = z.infer<typeof SmokeApprovalSchema>;
export class SmokeError extends Error { constructor(public readonly code: string) { super(code); } }

export function validateFundingEvidence(candidate: unknown, now: number): SmokeApproval {
  const parsed = SmokeApprovalSchema.safeParse(candidate);
  if (!parsed.success) throw new SmokeError("SMOKE_APPROVAL_OR_GRANT_EVIDENCE_MISSING");
  const approval = parsed.data;
  const grantAge = now - Date.parse(approval.grantVerifiedAt);
  const pricingAge = now - Date.parse(approval.pricingVerifiedAt);
  // A direct human confirmation authorizes this bounded coding session. It is
  // not a claim about the provider's expiry date; normal dashboard proofs stay
  // on the stricter15-minute refresh. Every request still debits the ledger.
  const maximumEvidenceAge = approval.grantValidityBasis === "current_balance_confirmed_by_user" ? 2 * 60 * 60_000 : 15 * 60_000;
  if (grantAge < 0 || grantAge > maximumEvidenceAge) throw new SmokeError("STALE_GRANT_EVIDENCE");
  if (pricingAge < 0 || pricingAge > 24 * 60 * 60_000) throw new SmokeError("STALE_PRICING_EVIDENCE");
  if (approval.grantExpiresAt && Date.parse(approval.grantExpiresAt) <= now + 30_000) throw new SmokeError("GRANT_EXPIRED_OR_TOO_CLOSE");
  for (const [bucket, spent] of Object.entries(approval.externalSpentMicrousd)) {
    if (spent > BUDGET_CAPS_USD[bucket as keyof SmokeApproval["externalSpentMicrousd"]] * 1_000_000) throw new SmokeError("EXTERNAL_BUCKET_EXHAUSTED");
  }
  return approval;
}

export async function reserveSmoke(connection: DatabaseConnection, candidate: unknown, now = Date.now(), followup = false) {
  const approval = validateFundingEvidence(candidate, now);
  const id = followup ? SMOKE_FOLLOWUP_ID : SMOKE_ID, reserve = followup ? 10_000 : SMOKE_RESERVATION_MICROUSD;
  return connection.db.transaction(async (tx) => {
    const entries = await tx.select().from(ledgerEntries);
    if (entries.some((entry) => entry.id === id)) throw new SmokeError("SMOKE_AUTHORIZATION_ALREADY_USED");
    const committed = (entry: typeof entries[number]) => entry.state === "released" ? 0 : entry.state === "settled" ? entry.actualMicrousd ?? entry.reservedMicrousd : entry.reservedMicrousd;
    if (followup && (!entries.some((entry) => entry.id === SMOKE_ID && entry.state === "settled") || entries.filter((entry) => entry.id.startsWith("B2-SMOKE-")).reduce((sum, entry) => sum + committed(entry), 0) + reserve > SMOKE_RESERVATION_MICROUSD)) throw new SmokeError("SMOKE_FOLLOWUP_BOUND");
    const localCommitted = entries.reduce((sum, entry) => sum + committed(entry), 0);
    const devCommitted = entries.filter((entry) => entry.bucket === "runtimeDev").reduce((sum, entry) => sum + committed(entry), 0);
    if (approval.externalSpentMicrousd.runtimeDev + devCommitted + reserve > BUDGET_CAPS_USD.runtimeDev * 1_000_000) throw new SmokeError("RUNTIME_DEV_CAP_REACHED");
    // Conservatively subtract all local commitments again, even if a fresh
    // Billing balance already reflects settled calls. This never enlarges budget.
    if (approval.remainingGrantMicrousd - localCommitted - reserve < BUDGET_CAPS_USD.reserve * 1_000_000) throw new SmokeError("GRANT_RESERVE_PROTECTED");
    const totalExternal = Object.values(approval.externalSpentMicrousd).reduce((sum, spent) => sum + spent, 0);
    if (totalExternal + localCommitted + reserve > 120_000_000) throw new SmokeError("COMBINED_SPEND_CAP_REACHED");
    await tx.insert(ledgerEntries).values({ id, bucket: "runtimeDev", reservedMicrousd: reserve, state: "reserved", createdAt: new Date(now).toISOString() });
    return { id, reservedMicrousd: reserve };
  });
}

const ResponseSchema = (maxOutputTokens: number) => z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), status: z.string(),
  usage: z.object({ input_tokens: z.number().int().nonnegative().max(1024), output_tokens: z.number().int().nonnegative().max(maxOutputTokens) }),
  output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
});
async function boundedJson(response: Response) {
  if (!response.body) throw new SmokeError("EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65_536) { await reader.cancel(); throw new SmokeError("RESPONSE_TOO_LARGE"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}

export async function executeSmoke(input: {
  connection: DatabaseConnection; approval: unknown; apiKey?: string; liveEnabled: boolean;
  fetcher?: typeof fetch; now?: number; followup?: boolean;
}) {
  if (!input.liveEnabled) throw new SmokeError("LIVE_DISABLED");
  if (!input.apiKey) throw new SmokeError("PROCESS_CREDENTIAL_REQUIRED_NO_DOTENV");
  const request = input.followup ? { ...SMOKE_REQUEST, max_output_tokens: 1024 } : SMOKE_REQUEST;
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > 512) throw new SmokeError("SMOKE_INPUT_BOUND_EXCEEDED");
  const reservation = await reserveSmoke(input.connection, input.approval, input.now, input.followup);
  // After reservation the one-call authorization is consumed even on errors.
  try {
    const response = await (input.fetcher ?? fetch)("https://api.meta.ai/v1/responses", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new SmokeError(`META_HTTP_${response.status}`);
    const parsed = ResponseSchema(request.max_output_tokens).safeParse(await boundedJson(response));
    if (!parsed.success) throw new SmokeError("UNRECONCILED_RESPONSE_USAGE");
    const result = parsed.data;
    const actualMicrousd = Math.ceil(result.usage.input_tokens * 1.25 + result.usage.output_tokens * 4.25);
    if (actualMicrousd > reservation.reservedMicrousd) throw new SmokeError("USAGE_EXCEEDS_RESERVATION");
    await input.connection.db.update(ledgerEntries).set({ state: "settled", actualMicrousd }).where(eq(ledgerEntries.id, reservation.id));
    const text = result.output.filter((item) => item.type === "message").flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("").trim();
    return {
      responseId: result.id, status: result.status,
      connectivityOk: result.status === "completed" && text === "SYNTHETIC_CONNECTION_OK",
      usage: result.usage, actualMicrousd, reservedMicrousd: reservation.reservedMicrousd, authorizationId: reservation.id,
      // No arbitrary model/provider text, headers or encrypted reasoning is logged.
    };
  } catch (error) {
    await input.connection.db.update(ledgerEntries).set({ state: "uncertain" }).where(eq(ledgerEntries.id, reservation.id));
    throw error instanceof SmokeError ? error : new SmokeError("SMOKE_NETWORK_OR_RESPONSE_FAILURE_RESERVATION_RETAINED");
  }
}
