// Initial implementation drafted by native Muse Code (run f644ebb6-db23-44b7-88e6-6241e53dfb30), reviewed and corrected in Codex.
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseConnection } from "@/db/client";
import {
  agentRuns,
  auditEntries,
  encounters,
  replayEvents,
  replaySessions,
} from "@/db/schema";
import { DEMO_ROSTER } from "@/domain/roster";
import { isAssigned } from "@/domain/scope";
import { GraphSchema } from "@/domain/types";
import { normalizeJson } from "@/replay/events";
import { applyReplayEvent } from "@/replay/fold";

export const HandoverInputSchema = z
  .object({
    synthetic: z.literal(true),
    encounterId: z.enum(["E-101", "E-201"]),
    actorId: z.enum(["rn-charge", "md-hospitalist"]),
    expectedVersion: z.number().int().nonnegative(),
    commandId: z.string().uuid(),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();

export type HandoverInput = z.infer<typeof HandoverInputSchema>;

export class HandoverError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "HandoverError";
    this.code = code;
  }
}

const UNIT_ID = "UNIT-A";
export async function persistSyntheticHandover(
  connection: DatabaseConnection,
  candidate: unknown,
  now = Date.now(),
): Promise<{
  synthetic: true;
  mode: "SIMULATED EVENT";
  sourceId: string;
  version: number;
  created: boolean;
}> {
  if (typeof now !== "number" || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new HandoverError("INVALID_TIME");
  }
  const parsed = HandoverInputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new HandoverError("INVALID_INPUT");
  }
  const input = parsed.data;

  const actor = DEMO_ROSTER.find((r) => r.id === input.actorId);
  if (!actor || (actor.role !== "charge_rn" && actor.role !== "hospitalist")) {
    throw new HandoverError("SCOPE_DENIED");
  }

  const sourceId = `staff-handover:${input.actorId}:${input.commandId}`;

  return connection.db.transaction(async (tx) => {
    const encounterRows = await tx
      .select()
      .from(encounters)
      .where(eq(encounters.id, input.encounterId));
    const row = encounterRows[0];
    if (!row) {
      throw new HandoverError("LOAD_PATIENT_FIRST");
    }

    const graph = GraphSchema.parse(row.snapshot);
    if (graph.encounterId !== row.id || graph.patientId !== row.patientId || row.unitId !== UNIT_ID || graph.unitId !== row.unitId || graph.version !== row.version) {
      throw new HandoverError("INVALID_ENCOUNTER");
    }
    if (!isAssigned(actor, graph)) throw new HandoverError("SCOPE_DENIED");
    const [session] = await tx.select().from(replaySessions).where(eq(replaySessions.id, UNIT_ID)).limit(1);
    if (!session) throw new HandoverError("LOAD_PATIENT_FIRST");
    const clock = session.clock;
    if (clock.playing !== false) throw new HandoverError("PAUSE_REPLAY_FIRST");
    if (!Number.isSafeInteger(clock.simulatedMs) || clock.simulatedMs < 0) throw new HandoverError("INVALID_CLOCK");
    const active = await tx.select({ id: agentRuns.id }).from(agentRuns)
      .where(and(eq(agentRuns.unitId, UNIT_ID), inArray(agentRuns.status, ["ready", "calling"]))).limit(1);
    if (active.length) throw new HandoverError("CLOCK_LOCKED_DURING_AGENT_RUN");

    const existing = graph.sources.find((source) => source.id === sourceId);
    if (existing && typeof existing === "object") {
      const priorText = existing.text;
      if (existing.kind === "note_span" && existing.status === "unsigned" && priorText === input.text) {
        return {
          synthetic: true as const,
          mode: "SIMULATED EVENT" as const,
          sourceId,
          version: row.version,
          created: false as const,
        };
      }
      throw new HandoverError("HANDOVER_COMMAND_CONFLICT");
    }

    if (row.version !== input.expectedVersion) {
      throw new HandoverError("STALE_VERSION");
    }

    const rawEvent = {
      synthetic: true,
      id: sourceId,
      patientId: row.patientId,
      encounterId: input.encounterId,
      atMs: clock.simulatedMs,
      type: "signout",
      status: "unsigned",
      sourceProtocol: "FHIR_SHAPED_JSON",
      trigger: false,
      label: "Staff handover recorded (demo)",
      text: input.text,
    };
    const event = normalizeJson(rawEvent);
    const next = applyReplayEvent(graph, event);

    const updated = await tx
      .update(encounters)
      .set({ version: next.version, snapshot: next })
      .where(
        and(
          eq(encounters.id, row.id),
          eq(encounters.version, input.expectedVersion),
        ),
      )
      .returning({ id: encounters.id });
    if (updated.length !== 1) {
      throw new HandoverError("STALE_VERSION");
    }

    await tx.insert(replayEvents).values({
      id: `${session.epoch}:${sourceId}`,
      epoch: session.epoch,
      encounterId: row.id,
      body: event,
    });

    const previousRows = await tx
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.encounterId, row.id))
      .orderBy(desc(auditEntries.sequence)).limit(1);
    const previous = previousRows[0];
    const entry = {
      id: randomUUID(),
      encounterId: row.id,
      sequence: (previous?.sequence ?? 0) + 1,
      proposalId: null as string | null,
      actorId: input.actorId,
      action: "record_synthetic_handover",
      version: next.version,
      createdAt: new Date(now).toISOString(),
      previousHash: previous?.hash ?? "GENESIS",
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(entry))
      .digest("hex");
    await tx.insert(auditEntries).values({ ...entry, hash });

    return {
      synthetic: true as const,
      mode: "SIMULATED EVENT" as const,
      sourceId,
      version: next.version,
      created: true as const,
    };
  });
}