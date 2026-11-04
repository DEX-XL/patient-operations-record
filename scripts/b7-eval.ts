import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { configurationSnapshot, verifyFrozenConfiguration } from "../src/eval/freeze";
import { rulesBaseline } from "../src/eval/baseline";
import { proposalObservations } from "../src/eval/observations";
import { promptContext, createToolHandler } from "../src/agent/tools";
import { newAgentState, agentRequest, consumeAgentResponse, type AgentState } from "../src/agent/protocol";
import { callMeta, MetaError } from "../src/agent/transport";
import { FundingSchema, BudgetError } from "../src/lib/budget";
import { validateFundingEvidence } from "../src/lib/meta-smoke";
import { runtimeDatabase } from "../src/db/runtime";
import { fundingRecords, ledgerEntries } from "../src/db/schema";
import type { Action } from "../src/domain/types";
import { InputSet, inputContext } from "./b7-input";

const EXPECTED = {
  "inputs.json": "99793b06a23bf8e09e90be14cbd61c75462d883486a6a5b057d77821e13868a8",
  "gold.json": "3d0fa3333e7e6c25be27447768ace2b84e7cec774248d69410b9c2a1495c8983",
};
type Trial = { id: string; scenarioId: string; repetition: number; status: string; responseIds?: string[]; errorCode?: string };
type SavedRun = { state: AgentState; actions: Action[]; inFlight: boolean; costMicrousd: number; messages: string[]; receipts: { responseId: unknown; inputTokens: number; outputTokens: number; costMicrousd: number }[] };
async function save(path: string, data: unknown) { await writeFile(path, JSON.stringify(data, null, 2) + "\n"); }
async function main() {
  const execute = process.argv.includes("--execute");
  const sourceFreeze = verifyFrozenConfiguration(await configurationSnapshot(), JSON.parse(await readFile("eval/FROZEN_CONFIG.json", "utf8")));
  // Hash ALL raw files before parsing either. Expected values are the original
  // frozen README's values, not regenerated from the evaluated payloads.
  const buffers = await Promise.all(Object.keys(EXPECTED).map(file => readFile(`heldout/${file}`)));
  Object.entries(EXPECTED).forEach(([file, hash], index) => {
    if (createHash("sha256").update(buffers[index]).digest("hex") !== hash) throw new Error(`HELDOUT_HASH_MISMATCH:${file}`);
  });
  const inputs = InputSet.parse(JSON.parse(buffers[0].toString("utf8")));
  const gold = JSON.parse(buffers[1].toString("utf8"));
  await mkdir("eval/heldout", { recursive: true });
  await mkdir("data/b7", { recursive: true });
  const contract = {
    status: "incompatible_scoring_contract", sourceDigest: sourceFreeze.sourceDigest, datasetHashes: EXPECTED,
    implementationKinds: ["link", "question", "task", "pending_owner"], goldKinds: Object.keys(gold.item_kinds),
    requiredGoldItems: gold.totals.required_items, optionalGoldItems: gold.totals.optional_items,
    reason: "Frozen implementation scores normalized kind/subject/owner. The untouched gold contract requires six different kinds plus exact reference and note-span overlap. No pre-registered ontology/span bridge exists. Do not invent a post-exposure remapping or claim valid official recall/precision.",
    primaryMetrics: null, ruleTuningAfterExposure: false,
  };
  await save("eval/heldout/CONTRACT_AUDIT.json", contract);
  const contexts = new Map(inputs.scenarios.map(scenario => [scenario.id, inputContext(scenario)]));
  for (const scenario of inputs.scenarios) {
    const path = `eval/heldout/${scenario.id}__baseline.json`;
    if (existsSync(path)) continue;
    const { graph, actor, roster, limitations } = contexts.get(scenario.id)!;
    const started = performance.now(), result = rulesBaseline(graph, actor, roster);
    await save(path, {
      scenarioId: scenario.id, mode: result.mode, sourceDigest: sourceFreeze.sourceDigest,
      adapterLimitations: limitations, inputGraph: graph, actorId: actor.id,
      proposal: result.proposal, validation: result.validation, observations: proposalObservations(result.proposal?.actions ?? []),
      officialMetrics: null, scoringStatus: contract.status, latencyMs: performance.now() - started,
      tokens: 0, costMicrousd: 0, modelRequests: 0, humanAcceptances: 0,
      safetyAdjudication: "Unadjudicated global/per-case prose; validator result is separate and is not a zero-violation claim.",
    });
  }
  const manifestPath = "eval/heldout/TRIALS.json";
  const manifest: { createdAt: string; sourceDigest: string; trials: Trial[] } = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8"))
    : { createdAt: new Date().toISOString(), sourceDigest: sourceFreeze.sourceDigest, trials: inputs.scenarios.flatMap(scenario => [1, 2, 3].map(repetition => ({ id: `b7-${scenario.id}-${repetition}`, scenarioId: scenario.id, repetition, status: "pending_funding" }))) };
  if (manifest.sourceDigest !== sourceFreeze.sourceDigest || manifest.trials.length !== 12) throw new Error("TRIAL_MANIFEST_CHANGED");
  if (!existsSync(manifestPath)) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  if (!execute) { console.log(JSON.stringify({ baselineRuns: 4, modelTrials: manifest.trials.length, modelCalls: 0, contract: contract.status, officialMetrics: null })); return; }

  const connection = await runtimeDatabase();
  async function preflight() {
    verifyFrozenConfiguration(await configurationSnapshot(), sourceFreeze);
    const [record] = await connection.db.select().from(fundingRecords).where(eq(fundingRecords.id, "active"));
    const proof = FundingSchema.parse(record?.evidence); validateFundingEvidence(proof.evidence, Date.now());
    const ledger = await connection.db.select().from(ledgerEntries);
    if (ledger.some(row => ["reserved", "uncertain"].includes(row.state))) throw new Error("UNRECONCILED_LEDGER");
    if (process.env.META_LIVE_ENABLED !== "true") throw new Error("LIVE_DISABLED");
  }
  try {
    try { await preflight(); }
    catch { console.log("B7 model trials remain pending: current funding, pricing and reconciled ledger/live enablement are required. No provider request sent."); return; }
    for (const trial of manifest.trials) {
      if (["staged", "complete", "failed", "exhausted", "interrupted_needs_reconciliation"].includes(trial.status)) continue;
      const { graph, actor, roster } = contexts.get(trial.scenarioId)!;
      const privatePath = `data/b7/${trial.id}.json`;
      const saved: SavedRun = existsSync(privatePath) ? JSON.parse(await readFile(privatePath, "utf8")) : { state: newAgentState(promptContext(graph, actor)), actions: [], inFlight: false, costMicrousd: 0, messages: [], receipts: [] };
      if (saved.inFlight) { trial.status = "interrupted_needs_reconciliation"; await save(manifestPath, manifest); break; }
      // Never restart a timed-out protocol window or replace a failed trial.
      const started = performance.now();
      const handler = createToolHandler({ graph, actor, roster, proposalId: trial.id, actions: saved.actions });
      try {
        while (saved.state.status === "ready") {
          await preflight();
          const { body } = agentRequest(saved.state);
          saved.inFlight = true; trial.status = "running";
          await save(privatePath, saved); await save(manifestPath, manifest);
          const result = await callMeta({ connection, requestId: `${trial.id}:${saved.state.requests}`, body, bucket: "heldoutEval" });
          saved.costMicrousd += result.actualMicrousd;
          saved.receipts.push({ responseId: result.response.id, inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens, costMicrousd: result.actualMicrousd });
          await save(privatePath, saved); // Preserve the settled receipt even if later parsing fails.
          const output = result.response.output;
          if (Array.isArray(output)) for (const item of output) {
            if (item && item.type === "message" && Array.isArray(item.content)) for (const part of item.content) if (part && part.type === "output_text" && typeof part.text === "string") saved.messages.push(part.text);
          }
          const next = await consumeAgentResponse(saved.state, result.response, handler.call);
          next.usage = { inputTokens: saved.state.usage.inputTokens + result.usage.input_tokens, outputTokens: saved.state.usage.outputTokens + result.usage.output_tokens };
          saved.state = next; saved.actions = handler.getActions(); saved.inFlight = false;
          await save(privatePath, saved);
        }
        trial.status = saved.state.status;
      } catch (error) {
        const sent = error instanceof MetaError && error.requestSent;
        const unconsumedReceipt = saved.receipts.length > saved.state.requests;
        saved.inFlight = sent || unconsumedReceipt;
        trial.errorCode = error instanceof MetaError || error instanceof BudgetError ? error.code : error instanceof Error && /^(?:RUN_EXHAUSTED|REQUEST_CONTEXT_BOUND_EXCEEDED)$/.test(error.message) ? error.message : "B7_STOP_REQUIRED";
        trial.status = sent || unconsumedReceipt ? "failed" : saved.state.requests > 0 ? "interrupted_needs_reconciliation" : "pending_funding";
        await save(privatePath, saved);
      }
      trial.responseIds = saved.state.responseIds;
      await save(`eval/heldout/${trial.id}.json`, {
        ...trial, sourceDigest: sourceFreeze.sourceDigest, mode: saved.receipts.length ? "LIVE META" : "UNAVAILABLE", protocolRequests: saved.state.requests, settledResponses: saved.receipts.length, receipts: saved.receipts,
        usage: saved.state.usage, costMicrousd: saved.costMicrousd, latencyMs: performance.now() - started,
        actions: saved.actions, observations: proposalObservations(saved.actions), trace: saved.state.trace,
        unadjudicatedAssistantMessages: saved.messages, officialMetrics: null, scoringStatus: contract.status,
        safetyAdjudication: "Pending explicit review of global and per-case rules; not zero violations.",
      });
      await save(manifestPath, manifest);
      if (["pending_funding", "interrupted_needs_reconciliation"].includes(trial.status) || saved.inFlight) break;
    }
    console.log(JSON.stringify({ trials: manifest.trials.map(({ id, status }) => ({ id, status })), officialMetrics: null }));
  } finally { connection.client.close(); }
}
main().catch(() => { console.error("B7 stopped. Inspect hash/freeze/input/manifest validation locally; no automatic retry or rule change performed."); process.exitCode = 1; });
