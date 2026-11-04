import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Server/CLI only. Never import into a client component or serialize its return value.
// Reuse the credential saved by the explicitly authorized Muse browser sign-in.
// The protected app/.env.local file is never opened by this module.
export function credentialFromMuseObject(candidate: unknown): string | undefined {
  if (!candidate || typeof candidate !== "object") return;
  const providers = (candidate as { providers?: unknown }).providers;
  if (!providers || typeof providers !== "object") return;
  const meta = (providers as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return;
  const record = meta as { api_key?: unknown; api_base_url?: unknown };
  if (typeof record.api_key !== "string" || !record.api_key || typeof record.api_base_url !== "string") return;
  try {
    const url = new URL(record.api_base_url);
    if (url.origin !== "https://api.meta.ai" || !["/v1", "/v1/"].includes(url.pathname) || url.search || url.username || url.password) return;
    return record.api_key;
  } catch { return; }
}
export async function resolveMetaCredential(env: Record<string, string | undefined> = process.env): Promise<string | undefined> {
  if (env.MODEL_API_KEY) return env.MODEL_API_KEY;
  if (env.META_API_KEY) return env.META_API_KEY;
  if (env.META_USE_MUSE_LOGIN !== "true") return;
  try { return credentialFromMuseObject(JSON.parse(await readFile(join(homedir(), ".config", "muse", "auth.json"), "utf8"))); }
  catch { return; } // Missing/unavailable native credential stays UNAVAILABLE; never log its payload.
}
