import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const FREEZE_NOT_BEFORE = "2026-11-02T02:00:00.000Z"; // Nov1 9PM EST, after the DST change.
const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const FrozenConfigSchema = z.object({
  version: z.literal(1), frozenAt: z.string().datetime(), notBefore: z.literal(FREEZE_NOT_BEFORE),
  encoding: z.literal("UTF-8 with CRLF normalized to LF; NOT the held-out file hash procedure"),
  sourceDigest: hex, files: z.record(z.string(), hex),
}).strict();
export function assertFreezeTime(now: number) {
  if (!Number.isFinite(now) || now < Date.parse(FREEZE_NOT_BEFORE)) throw new Error("FEATURE_FREEZE_NOT_REACHED");
}
export function hashConfigurationEntries(entries: readonly (readonly [string, string])[]) {
  const files: Record<string, string> = {};
  for (const [path, text] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.hasOwn(files, path)) throw new Error("DUPLICATE_CONFIG_PATH");
    files[path] = createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
  }
  return { files, sourceDigest: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}
export async function configurationSnapshot(root = process.cwd()) {
  // Positive, source-only allowlist. Never enumerate heldout/, data/, native
  // login, parent folders, dotenv, node_modules or arbitrary manifest paths.
  const paths = ["package.json", "pnpm-lock.yaml", "fixtures/dev/scenarios.json", "scripts/eval-dev.ts", "scripts/eval-freeze.ts", "docs/EVAL_PROTOCOL.md"];
  async function collect(directory: string) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("CONFIG_SYMLINK_DENIED");
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await collect(path);
      else if (/\.(?:ts|tsx|json|sql)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name) && entry.name !== "test-fixtures.ts") paths.push(path);
    }
  }
  for (const directory of ["src/agent", "src/db", "src/domain", "src/eval", "src/lib", "src/replay", "config/templates", "drizzle"]) await collect(directory);
  return hashConfigurationEntries(await Promise.all(paths.map(async path => [path, await readFile(join(root, path), "utf8")] as const)));
}
export function verifyFrozenConfiguration(current: ReturnType<typeof hashConfigurationEntries>, candidate: unknown, now = Date.now()) {
  const manifest = FrozenConfigSchema.parse(candidate);
  assertFreezeTime(Date.parse(manifest.frozenAt));
  if (Date.parse(manifest.frozenAt) > now || manifest.sourceDigest !== current.sourceDigest || JSON.stringify(Object.entries(manifest.files).sort()) !== JSON.stringify(Object.entries(current.files).sort())) throw new Error("FROZEN_CONFIGURATION_CHANGED");
  return manifest;
}
