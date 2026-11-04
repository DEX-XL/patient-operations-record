import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ActionSchema } from "@/domain/types";

export const RecordingSchema = z.object({
  capturedFrom: z.literal("LIVE META"), model: z.literal("muse-spark-1.3"),
  runId: z.string().uuid(), responseIds: z.array(z.string().min(1).max(200)).min(1), capturedAt: z.string().datetime(),
  scenarioId: z.string().regex(/^[a-z0-9-]+$/), eventId: z.string().regex(/^[a-z0-9-]+$/),
  encounterId: z.string(), actorId: z.string(), contextHash: z.string().regex(/^[a-f0-9]{64}$/), promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  actions: z.array(ActionSchema).min(1).max(24),
  trace: z.array(z.object({ name: z.string(), callId: z.string(), ok: z.boolean(), result: z.unknown() }).strict()).max(12),
  originalCostMicrousd: z.number().int().nonnegative(), originalUsage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict(),
}).strict();
export type Recording = z.infer<typeof RecordingSchema>;
const Filename = z.string().regex(/^[a-z0-9-]+__[a-z0-9-]+__[a-f0-9]{64}\.json$/);
export async function findRecording(contextHash: string, encounterId: string, actorId: string): Promise<Recording | undefined> {
  const directory = join(process.cwd(), "fixtures", "recordings");
  const manifest = z.array(Filename).max(100).parse(JSON.parse(await readFile(join(directory, "index.json"), "utf8")));
  for (const file of manifest) {
    const text = await readFile(join(directory, file), "utf8");
    if (Buffer.byteLength(text, "utf8") > 524_288) continue;
    const parsed = RecordingSchema.safeParse(JSON.parse(text));
    if (parsed.success && parsed.data.contextHash === contextHash && parsed.data.encounterId === encounterId && parsed.data.actorId === actorId) return parsed.data;
  }
}
