import { z } from "zod";
import type { DatabaseConnection } from "@/db/client";
import { markUncertain, MUSE_BODY_LIMIT, reserveMuseRequest, settleModelRequest } from "@/lib/budget";

export class MuseGatewayError extends Error { constructor(public readonly code: string) { super(code); } }
const TextPart = z.object({ type: z.enum(["input_text", "output_text"]), text: z.string() }).strict();
const NativeRequest = z.object({
  model: z.literal("muse-spark-1.3"), instructions: z.string().max(MUSE_BODY_LIMIT),
  input: z.union([z.string(), z.array(z.object({ role: z.enum(["system", "developer", "user", "assistant"]), type: z.literal("message").optional(), content: z.union([z.string(), z.array(TextPart)]) }).strict()).max(16)]),
  max_output_tokens: z.number().int().positive(), store: z.boolean(),
  reasoning: z.object({ effort: z.string(), summary: z.string().optional() }).strict().optional(),
  include: z.array(z.string()).optional(), prompt_cache_key: z.string().max(200).optional(),
  stream: z.boolean(), tools: z.array(z.unknown()).max(0).optional(),
}).strict();
export function boundedMuseRequest(candidate: unknown) {
  const parsed = NativeRequest.safeParse(candidate);
  if (!parsed.success) throw new MuseGatewayError("UNSUPPORTED_NATIVE_MUSE_REQUEST");
  const body = { ...parsed.data, model: "muse-spark-1.3", max_output_tokens: Math.min(parsed.data.max_output_tokens, 4096), store: false, stream: true, reasoning: { effort: "low" } };
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > MUSE_BODY_LIMIT || /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:sk-|mmk-|LLM_)[A-Za-z0-9_-]{24,}/.test(text)) throw new MuseGatewayError("NATIVE_MUSE_CONTEXT_REFUSED");
  return text;
}
export function completedStreamResponse(text: string) {
  let completed: Record<string, unknown> | undefined;
  for (const block of text.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(data); } catch { throw new MuseGatewayError("MALFORMED_MUSE_EVENT"); }
    if (["response.failed", "error"].includes(String(event.type))) throw new MuseGatewayError("MUSE_RESPONSE_FAILED");
    if (event.type === "response.completed" && event.response && typeof event.response === "object") {
      if (completed) throw new MuseGatewayError("DUPLICATE_MUSE_COMPLETION");
      completed = event.response as Record<string, unknown>;
    }
  }
  if (!completed || completed.status !== "completed" || typeof completed.id !== "string") throw new MuseGatewayError("MUSE_COMPLETION_OR_USAGE_MISSING");
  return completed;
}
export async function forwardMuseRequest(input: { connection: DatabaseConnection; runId: string; step: number; body: unknown; credential: string; fetcher?: typeof fetch; now?: number }) {
  if (!Number.isInteger(input.step) || input.step < 0 || input.step >= 6 || !input.credential) throw new MuseGatewayError("MUSE_STEP_BOUND");
  const body = boundedMuseRequest(input.body);
  if (body.includes(input.credential)) throw new MuseGatewayError("CREDENTIAL_IN_MUSE_CONTEXT");
  const id = `muse:${input.runId}:${input.step}`;
  await reserveMuseRequest(input.connection, { id, runId: input.runId, bodyBytes: Buffer.byteLength(body), now: input.now });
  try {
    const response = await (input.fetcher ?? fetch)("https://api.meta.ai/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${input.credential}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body, redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new MuseGatewayError(`MUSE_HTTP_${response.status}`);
    if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new MuseGatewayError("MUSE_STREAM_REQUIRED");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 524_288) { await reader.cancel(); throw new MuseGatewayError("MUSE_RESPONSE_BOUND"); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const stream = Buffer.concat(chunks).toString("utf8"), result = completedStreamResponse(stream);
    const settled = await settleModelRequest(input.connection, id, result.usage);
    const output = Array.isArray(result.output) ? result.output : [];
    const outputText = output.filter((item) => item?.type === "message").flatMap((item) => Array.isArray(item.content) ? item.content.filter((part: { type?: string; text?: unknown }) => part.type === "output_text" && typeof part.text === "string").map((part: { text: string }) => part.text) : []).join("\n");
    return { stream, responseId: result.id as string, outputText, ...settled };
  } catch (error) {
    await markUncertain(input.connection, id);
    throw new MuseGatewayError(error instanceof MuseGatewayError ? error.code : "MUSE_CALL_UNCERTAIN");
  }
}
