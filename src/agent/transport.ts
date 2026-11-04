import type { DatabaseConnection } from "@/db/client";
import { reserveModelRequest, settleModelRequest, markUncertain, type RuntimeBucket } from "@/lib/budget";
import { resolveMetaCredential } from "@/lib/meta-credential";
import { z } from "zod";
import { AGENT_TOOLS, SYSTEM_PROMPT } from "./protocol";

export class MetaError extends Error { constructor(public readonly code: string, public readonly requestSent = false) { super(code); } }
const RequestSchema = z.object({
  model: z.literal("muse-spark-1.3"), instructions: z.literal(SYSTEM_PROMPT),
  input: z.array(z.record(z.string(), z.unknown())).max(128), tools: z.array(z.unknown()),
  tool_choice: z.literal("auto"), parallel_tool_calls: z.literal(false), store: z.literal(false),
  include: z.tuple([z.literal("reasoning.encrypted_content")]),
  reasoning: z.object({ effort: z.literal("low") }).strict(), max_output_tokens: z.number().int().min(16).max(4096),
}).strict();
export function validateBoundedRequest(candidate: unknown) {
  const parsed = RequestSchema.safeParse(candidate);
  if (!parsed.success || JSON.stringify(parsed.data.tools) !== JSON.stringify(AGENT_TOOLS)) throw new MetaError("INVALID_OR_UNBOUNDED_REQUEST");
  for (const item of parsed.data.input) {
    if (item.type === "reasoning") {
      if (typeof item.encrypted_content !== "string") throw new MetaError("INVALID_REASONING_REPLAY");
    } else if (item.type === "function_call") {
      if (typeof item.arguments !== "string" || typeof item.call_id !== "string") throw new MetaError("INVALID_FUNCTION_REPLAY");
    } else if (item.type === "function_call_output") {
      if (typeof item.output !== "string" || typeof item.call_id !== "string") throw new MetaError("INVALID_FUNCTION_REPLAY");
    } else if (["user", "assistant", "system", "developer"].includes(String(item.role))) {
      if (!Array.isArray(item.content) || item.content.some((part) => !part || !["input_text", "output_text"].includes(part.type) || typeof part.text !== "string")) throw new MetaError("NON_TEXT_INPUT_FORBIDDEN");
    } else throw new MetaError("UNSUPPORTED_REPLAY_ITEM");
  }
  return parsed.data;
}
async function readBounded(response: Response) {
  if (!response.body) throw new MetaError("EMPTY_MODEL_RESPONSE");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 524_288) { await reader.cancel(); throw new MetaError("MODEL_RESPONSE_TOO_LARGE"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } finally { reader.releaseLock(); }
}
export async function callMeta(input: {
  connection: DatabaseConnection; requestId: string; body: unknown; bucket: RuntimeBucket;
  env?: Record<string, string | undefined>; fetcher?: typeof fetch; now?: number;
}) {
  const env = input.env ?? process.env;
  const checkedBody = validateBoundedRequest(input.body);
  if (env.META_LIVE_ENABLED !== "true") throw new MetaError("LIVE_DISABLED");
  const credential = await resolveMetaCredential(env);
  if (!credential) throw new MetaError("NO_PERMITTED_CREDENTIAL");
  const body = JSON.stringify(checkedBody);
  await reserveModelRequest(input.connection, { id: input.requestId, bucket: input.bucket, bodyBytes: Buffer.byteLength(body, "utf8"), now: input.now });
  try {
    const response = await (input.fetcher ?? fetch)("https://api.meta.ai/v1/responses", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body,
    });
    if (!response.ok) throw new MetaError(`META_HTTP_${response.status}`);
    const result = await readBounded(response);
    const cost = await settleModelRequest(input.connection, input.requestId, result.usage);
    return { response: result, ...cost };
  } catch (error) {
    await markUncertain(input.connection, input.requestId);
    throw new MetaError(error instanceof MetaError ? error.code : "MODEL_REQUEST_FAILED_RECONCILIATION_REQUIRED", true);
  }
}
