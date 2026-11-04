import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DatabaseConnection } from "./client";
import { agentRuns, encounters, fundingRecords, proposals, replaySessions } from "./schema";
import { OperationsStore, OperationsError } from "./operations";
import { ReplayStore } from "./replay-store";
import { DEMO_ROSTER } from "@/domain/roster";
import { rulesBaseline } from "@/eval/baseline";
import { newAgentState, agentRequest, consumeAgentResponse } from "@/agent/protocol";
import { createToolHandler, promptContext } from "@/agent/tools";
import { callMeta, MetaError } from "@/agent/transport";
import { BudgetError, FundingSchema } from "@/lib/budget";
import { findRecording } from "@/agent/recordings";
import { runtimeBucket } from "@/lib/runtime-purpose";

type RunRow = typeof agentRuns.$inferSelect;
export type AgentMode = "LIVE META" | "RULES BASELINE" | "RECORDED META";
export function contextFingerprint(context: ReturnType<typeof promptContext>) {
  const { version: _version, ...semantic } = context;
  return createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
}
export function publicRun(row: RunRow) {
  const mode = row.mode === "LIVE META" && row.state.requests === 0 ? "UNAVAILABLE" : row.mode;
  return { id: row.id, encounterId: row.encounterId, actorId: row.actorId, mode, status: row.status, requests: row.state.requests, functions: row.state.functions, trace: row.state.trace, responseIds: row.state.responseIds, usage: row.state.usage, recording: row.state.recording, proposalId: row.proposalId, errorCode: row.errorCode, costMicrousd: row.costMicrousd, promptHash: row.promptHash, createdAt: row.createdAt };
}
export class AgentStore {
  constructor(private connection: DatabaseConnection, private env: Record<string, string | undefined> = process.env, private fetcher?: typeof fetch) {}
  private async finishClock(resumeAfter: boolean) {
    if (!resumeAfter) return;
    await this.connection.db.transaction(async (tx) => {
      const active = await tx.select({ id: agentRuns.id }).from(agentRuns).where(inArray(agentRuns.status, ["ready", "calling"])).limit(1);
      if (active.length) return;
      const [session] = await tx.select().from(replaySessions).where(eq(replaySessions.id, "UNIT-A"));
      if (session && session.clock.cursor > 0 && session.clock.pauseReason !== "complete") await tx.update(replaySessions).set({ clock: { ...session.clock, playing: true, pauseReason: null, lastWallMs: Date.now() } }).where(eq(replaySessions.id, "UNIT-A"));
    });
  }
  async get(id: string) {
    const row = await this.connection.db.query.agentRuns.findFirst({ where: eq(agentRuns.id, id) });
    if (!row) throw new Error("UNKNOWN_RUN");
    return publicRun(row);
  }
  async recent() {
    return (await this.connection.db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(10)).map(publicRun);
  }
  async start(encounterId: string, actorId: string, mode: AgentMode) {
    const actor = DEMO_ROSTER.find((person) => person.id === actorId);
    if (!actor || !actor.encounterIds.includes(encounterId)) throw new Error("SCOPE_DENIED");
    const beforePause = await new ReplayStore(this.connection).state(Date.now());
    const resumeAfter = beforePause.clock.playing || beforePause.clock.pauseReason === "trigger";
    await new ReplayStore(this.connection).state(Date.now(), "pause");
    const active = await this.connection.db.select({ id: agentRuns.id }).from(agentRuns).where(inArray(agentRuns.status, ["ready", "calling"])).limit(1);
    if (active.length) throw new Error("ANOTHER_RUN_ACTIVE");
    const operations = new OperationsStore(this.connection, DEMO_ROSTER);
    const graph = await operations.readEncounter(encounterId, actor.id);
    const context = promptContext(graph, actor);
    const id = randomUUID(); const now = Date.now();
    const state = newAgentState(context, now);
    const row: RunRow = { id, encounterId, actorId, unitId: "UNIT-A", baseVersion: graph.version, mode, status: "ready", state, actions: [], proposalId: null, errorCode: null, promptHash: agentRequest(state, now).promptHash, createdAt: now, costMicrousd: 0, resumeAfter };
    if (mode === "RULES BASELINE") {
      const result = rulesBaseline(graph, actor, DEMO_ROSTER);
      row.status = result.proposal ? "staged" : "complete";
      row.state.status = result.proposal ? "staged" : "complete";
      if (result.proposal) {
        try { await operations.stage(result.proposal, { actorId, origin: "rules" }); }
        catch (error) { if (!(error instanceof OperationsError) || error.code !== "DUPLICATE_PROPOSAL") throw error; }
        row.proposalId = result.proposal.id; row.actions = result.proposal.actions;
      }
      row.state.trace.push({ name: "rules_baseline", callId: "deterministic", ok: result.validation?.ok ?? true, result: { items: result.items, modelCalls: 0 } });
    } else if (mode === "RECORDED META") {
      const recording = await findRecording(contextFingerprint(context), encounterId, actorId);
      if (recording) {
        const proposalId = `recorded-${id}`;
        // Rebind only optimistic concurrency metadata. Source facts/context must
        // match the capture, and the same validator must accept every action.
        try {
          await operations.stage({ id: proposalId, encounterId, baseVersion: graph.version, origin: "model", actorId, actions: recording.actions }, { actorId, origin: "model" });
          row.actions = recording.actions; row.proposalId = proposalId; row.status = "staged"; row.state.status = "staged";
          row.state.trace = recording.trace; row.state.responseIds = recording.responseIds;
          row.state.recording = { runId: recording.runId, capturedAt: recording.capturedAt, originalCostMicrousd: recording.originalCostMicrousd, originalUsage: recording.originalUsage };
          row.promptHash = recording.promptHash;
        } catch { row.mode = "UNAVAILABLE"; row.status = "unavailable"; row.state.status = "failed"; row.errorCode = "RECORDING_FAILED_CURRENT_VALIDATION"; }
      } else { row.mode = "UNAVAILABLE"; row.status = "unavailable"; row.state.status = "failed"; row.errorCode = "NO_MATCHING_REAL_RECORDING"; }
    } else {
      const [funding] = await this.connection.db.select().from(fundingRecords).where(eq(fundingRecords.id, "active"));
      if (this.env.META_LIVE_ENABLED !== "true" || !FundingSchema.safeParse(funding?.evidence).success) {
        row.mode = "UNAVAILABLE"; row.status = "unavailable"; row.state.status = "failed"; row.errorCode = this.env.META_LIVE_ENABLED !== "true" ? "LIVE_DISABLED" : "VERIFIED_FUNDING_AND_SMOKE_REQUIRED";
      }
    }
    await this.connection.db.insert(agentRuns).values(row);
    if (row.status !== "ready") await this.finishClock(row.resumeAfter);
    return publicRun(row);
  }
  async step(id: string) {
    const [row] = await this.connection.db.update(agentRuns).set({ status: "calling" }).where(and(eq(agentRuns.id, id), eq(agentRuns.status, "ready"))).returning();
    if (!row) return this.get(id); // A duplicate polling request never sends again.
    let cost = row.costMicrousd;
    try {
      const operations = new OperationsStore(this.connection, DEMO_ROSTER);
      const graph = await operations.readEncounter(row.encounterId, row.actorId);
      if (graph.version !== row.baseVersion) throw new Error("STALE_VERSION_REPLAN_REQUIRED");
      const actor = DEMO_ROSTER.find((person) => person.id === row.actorId)!;
      const { body, promptHash } = agentRequest(row.state);
      const result = await callMeta({ connection: this.connection, requestId: `${row.id}:${row.state.requests}`, body, bucket: runtimeBucket(this.env), env: this.env, fetcher: this.fetcher });
      cost += result.actualMicrousd;
      const handler = createToolHandler({ graph, actor, roster: DEMO_ROSTER, proposalId: `meta-${row.id}`, actions: row.actions });
      const state = await consumeAgentResponse(row.state, result.response, handler.call);
      state.usage = { inputTokens: (row.state.usage?.inputTokens ?? 0) + result.usage.input_tokens, outputTokens: (row.state.usage?.outputTokens ?? 0) + result.usage.output_tokens };
      let proposalId: string | null = null;
      const proposal = handler.getProposal();
      if (state.status === "staged" && proposal) {
        await operations.stage(proposal, { actorId: row.actorId, origin: "model" });
        proposalId = proposal.id;
      }
      await this.connection.db.update(agentRuns).set({ state, status: state.status, actions: handler.getActions(), proposalId, promptHash, costMicrousd: cost, errorCode: state.status === "failed" ? "MODEL_RESPONSE_PROTOCOL_FAILED" : state.status === "exhausted" ? "RUN_EXHAUSTED" : null }).where(and(eq(agentRuns.id, id), eq(agentRuns.status, "calling")));
      if (state.status !== "ready") await this.finishClock(row.resumeAfter);
    } catch (error) {
      const errorCode = error instanceof MetaError || error instanceof BudgetError ? error.code : error instanceof OperationsError ? error.code : error instanceof Error && /^(?:STALE_VERSION_REPLAN_REQUIRED|RUN_EXHAUSTED|REQUEST_CONTEXT_BOUND_EXCEEDED)$/.test(error.message) ? error.message : "AGENT_STEP_FAILED";
      await this.connection.db.update(agentRuns).set({ status: "failed", errorCode, costMicrousd: cost, state: { ...row.state, requests: row.state.requests + (error instanceof MetaError && error.requestSent ? 1 : 0), status: "failed" } }).where(and(eq(agentRuns.id, id), eq(agentRuns.status, "calling")));
      await this.finishClock(row.resumeAfter);
    }
    return this.get(id);
  }
  async proposalInbox() {
    return this.connection.db.select().from(proposals).where(eq(proposals.status, "staged"));
  }
}
