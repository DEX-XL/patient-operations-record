import { eq, inArray } from "drizzle-orm";
import type { DatabaseConnection } from "./client";
import { agentRuns, encounters, patients, replayEvents, replaySessions } from "./schema";
import { advanceClock, controlClock, newClock, type ReplaySpeed } from "@/replay/clock";
import { demoEvents } from "@/replay/scenarios";
import { applyReplayEvent, emptyDemoGraph } from "@/replay/fold";
import { scopedGraph } from "@/domain/scope";
import { DEMO_ROSTER } from "@/domain/roster";
import { expireAbandonedRuns } from "./run-lock";

export type ReplayCommand = "play" | "pause" | "step" | "reset" | ReplaySpeed;
export class ReplayStore {
  constructor(private connection: DatabaseConnection) {}
  async state(now = Date.now(), command?: ReplayCommand) {
    return this.connection.db.transaction(async (tx) => {
      await expireAbandonedRuns(tx, now);
      let [session] = await tx.select().from(replaySessions).where(eq(replaySessions.id, "UNIT-A"));
      const active = await tx.select({ id: agentRuns.id }).from(agentRuns).where(inArray(agentRuns.status, ["ready", "calling"])).limit(1);
      if (active.length && command && command !== "pause") throw new Error("CLOCK_LOCKED_DURING_AGENT_RUN");
      if (active.length && session) session = { ...session, clock: { ...session.clock, playing: false, pauseReason: "trigger", lastWallMs: now } };
      if (!session || command === "reset") {
        const epoch = (session?.epoch ?? 0) + 1;
        const clock = newClock(2026, now);
        for (const patientId of ["P-101", "P-201"] as const) {
          const encounterId = patientId.replace("P-", "E-");
          const [old] = await tx.select().from(encounters).where(eq(encounters.id, encounterId));
          const graph = emptyDemoGraph(patientId, (old?.version ?? -1) + 1);
          await tx.insert(patients).values({ id: patientId, syntheticLabel: `Synthetic ${patientId}` }).onConflictDoNothing();
          await tx.insert(encounters).values({ id: encounterId, patientId, unitId: "UNIT-A", version: graph.version, snapshot: graph }).onConflictDoUpdate({ target: encounters.id, set: { version: graph.version, snapshot: graph } });
        }
        session = { id: "UNIT-A", epoch, clock };
        await tx.insert(replaySessions).values(session).onConflictDoUpdate({ target: replaySessions.id, set: { epoch, clock } });
      }
      const events = demoEvents();
      const result = command && command !== "reset" ? controlClock(session.clock, events, command, now) : advanceClock(session.clock, events, now);
      for (const event of result.applied) {
        const eventId = `${session.epoch}:${event.id}`;
        const [existing] = await tx.select().from(replayEvents).where(eq(replayEvents.id, eventId));
        if (existing) continue;
        const [row] = await tx.select().from(encounters).where(eq(encounters.id, event.encounterId));
        if (!row) throw new Error("REPLAY_ENCOUNTER_MISSING");
        const graph = applyReplayEvent(row.snapshot, event);
        await tx.update(encounters).set({ version: graph.version, snapshot: graph }).where(eq(encounters.id, row.id));
        await tx.insert(replayEvents).values({ id: eventId, epoch: session.epoch, encounterId: event.encounterId, body: event });
      }
      await tx.update(replaySessions).set({ clock: result.clock }).where(eq(replaySessions.id, "UNIT-A"));
      const rows = await tx.select().from(encounters).where(eq(encounters.unitId, "UNIT-A"));
      const timeline = await tx.select().from(replayEvents).where(eq(replayEvents.epoch, session.epoch));
      // This endpoint is a synthetic observer console deliberately showing four
      // scoped demo personas together; it is not hospital authentication.
      const panes = Object.fromEntries(["rn-charge", "md-hospitalist", "lab-owner", "cm-owner"].map((id) => {
        const person = DEMO_ROSTER.find((actor) => actor.id === id)!;
        return [person.role, rows.filter((row) => person.encounterIds.includes(row.id)).map((row) => scopedGraph(row.snapshot, person))];
      }));
      return { synthetic: true, mode: "SIMULATED EVENT" as const, epoch: session.epoch, clock: result.clock, tick: now, panes, timeline: timeline.map((row) => row.body).sort((a, b) => a.atMs - b.atMs), totalEvents: events.length };
    });
  }
}
