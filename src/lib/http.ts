import { z } from "zod";
export const NO_STORE = { "Cache-Control": "no-store" };
export async function commandBody<T>(request: Request, schema: z.ZodType<T>, maxBytes = 8192): Promise<T> {
  const origin = request.headers.get("origin");
  if (origin) {
    // Next may reconstruct request.url with its internal localhost hostname.
    // Host is the browser-facing authority; never trust a forwarded-host override.
    const url = new URL(request.url), authority = request.headers.get("host") ?? url.host;
    let supplied: URL;
    try { supplied = new URL(origin); } catch { throw new Error("ORIGIN_DENIED"); }
    if (supplied.origin !== origin || supplied.host !== authority || !["http:", "https:"].includes(supplied.protocol) || (url.protocol === "https:" && supplied.protocol !== "https:")) throw new Error("ORIGIN_DENIED");
  }
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  if (!reader) throw new Error("BODY_REQUIRED");
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
export function commandError(error: unknown) {
  const detail = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error && /^(?:ORIGIN_DENIED|BODY_TOO_LARGE|ANOTHER_RUN_ACTIVE|UNKNOWN_RUN|SCOPE_DENIED)$/.test(error.message) ? error.message : "COMMAND_REJECTED";
  const issues = error && typeof error === "object" && "details" in error && Array.isArray(error.details) ? error.details : [];
  return Response.json({ error: detail, issues }, { status: detail === "ORIGIN_DENIED" || detail === "SCOPE_DENIED" ? 403 : 409, headers: NO_STORE });
}
