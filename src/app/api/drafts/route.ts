import { z } from "zod";
import { randomUUID } from "node:crypto";
import { OperationsStore } from "@/db/operations";
import { runtimeDatabase } from "@/db/runtime";
import { DEMO_ROSTER } from "@/domain/roster";
import { DraftLineSchema } from "@/domain/types";
import { latestResults } from "@/domain/results";
import { validateDraftLines } from "@/domain/drafts";
import { commandBody, commandError, NO_STORE } from "@/lib/http";

export const runtime = "nodejs";
const encounterId = z.enum(["E-101", "E-201"]), actorId = z.enum(["rn-charge", "md-hospitalist"]);
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), encounterId, draftId: z.string().min(1).max(100), actorId, expectedVersion: z.number().int().nonnegative(), target: z.enum(["reviewed", "adopted", "signed_in_ehr_simulated", "communicated"]), lines: z.array(DraftLineSchema).min(1).max(20).optional() }).strict(),
  z.object({ action: z.literal("stage_factual"), encounterId, actorId, kind: z.enum(["handover", "discharge_pending_tests"]) }).strict(),
  z.object({ action: z.literal("validator_demo"), encounterId, actorId }).strict(),
]);
export async function POST(request: Request) {
  try {
    const body = await commandBody(request, Command, 16_384); const store = new OperationsStore(await runtimeDatabase(), DEMO_ROSTER);
    if (body.action === "review") { const { action: _action, ...review } = body; return Response.json(await store.reviewDraft(review), { headers: NO_STORE }); }
    const graph = await store.readEncounter(body.encounterId, body.actorId);
    const currentResults = latestResults(graph.sources);
    if (body.action === "validator_demo") {
      const source = [...currentResults, ...graph.sources.filter((item) => item.kind !== "result")].find((item) => item.statements.length);
      if (!source) return Response.json({ error: "Step the replay to create source evidence first" }, { status: 409, headers: NO_STORE });
      const lines = [{ text: source.statements[0], sourceIds: [source.id] }, { text: "The patient walked 400 feet independently.", sourceIds: [source.id] }];
      return Response.json({ mode: "SIMULATED EVENT", intentionalTest: true, lines, issues: validateDraftLines(lines, graph.sources) }, { headers: NO_STORE });
    }
    const pending = currentResults.filter((item) => ["pending", "preliminary"].includes(item.status));
    const evidence = body.kind === "discharge_pending_tests" ? pending : [...graph.sources.filter((item) => ["adt", "order", "schedule"].includes(item.kind)).slice(-3), ...currentResults];
    const ownerFacts = graph.sources.filter((item) => item.id.endsWith(":owner") && item.kind === "attestation");
    const lines = [...evidence, ...ownerFacts].filter((item) => item.statements.length).slice(0, 8).map((source) => ({ text: source.statements[0], sourceIds: [source.id] }));
    if (!lines.length) return Response.json({ error: "No matching source facts are available at this replay point" }, { status: 409, headers: NO_STORE });
    const id = `facts-${randomUUID()}`;
    const proposal = { id, encounterId: graph.encounterId, baseVersion: graph.version, origin: "rules" as const, actorId: body.actorId, actions: [{ type: "stage_draft" as const, draft: { id: `${id}:draft`, encounterId: graph.encounterId, kind: body.kind, state: "draft" as const, lines } }] };
    return Response.json({ mode: "RULES BASELINE", ...await store.stage(proposal, { actorId: body.actorId, origin: "rules" }) }, { headers: NO_STORE });
  }
  catch (error) { return commandError(error); }
}
