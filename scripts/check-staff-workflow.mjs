import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// This test writes only to a NEW disposable synthetic preview database.
// It refuses public hosts and live-enabled previews, and sends no Meta request.
const target = new URL(process.argv[2] ?? "http://127.0.0.1:4395");
assert.equal(process.argv[3], "--disposable-database", "Explicit disposable-database acknowledgement required");
assert.equal(target.protocol, "http:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.pathname, "/");
assert(target.port && !target.username && !target.password && !target.search && !target.hash);
const checks = [];
let requestCount = 0;
async function request(path, body, expected = 200, extraHeaders = {}) {
  assert(++requestCount <= 70, "HTTP acceptance request bound exceeded");
  const response = await fetch(new URL(path, target), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json", Origin: target.origin, ...extraHeaders } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  assert([expected].flat().includes(response.status), `${path}: HTTP${response.status}: ${JSON.stringify(result)}`);
  return result;
}
function check(name, condition) { assert(condition, name); checks.push(name); }
const health = await request("/api/health");
check("synthetic preview with live inference disabled", health.synthetic === true && health.liveEnabled === false);
const initialAgent = await request("/api/agent");
check("fresh disposable database has no runs, proposals, audit or spend", initialAgent.runs.length === 0 && initialAgent.proposals.length === 0 && initialAgent.audit.length === 0 && initialAgent.budget.localSpentMicrousd === 0 && initialAgent.budget.localReservedMicrousd === 0 && initialAgent.budget.uncertainRequests === 0);
let replay = await request("/api/replay/state", { action: "reset" });
const graph = (role = "charge_rn") => replay.panes[role].find((item) => item.encounterId === "E-201");
for (let step = 0; replay.timeline.at(-1)?.id !== "p-night-signout"; step++) {
  assert(step < 24, "Expected development sign-out event missing");
  replay = await request("/api/replay/state", { action: "step" });
}
replay = await request("/api/replay/state", { action: "pause" });
const before = structuredClone(graph());
const note = {
  synthetic: true,
  encounterId: "E-201",
  actorId: "rn-charge",
  expectedVersion: before.version,
  commandId: randomUUID(),
  text: "Ride not confirmed; ask case management to confirm the already-mentioned family pickup arrangement. Pharmacy liaison to confirm already-requested bedside delivery coordination. Blood culture final remains pending.",
};
const saved = await request("/api/handovers", note);
check("staff text saved as explicitly simulated input", saved.synthetic === true && saved.mode === "SIMULATED EVENT" && saved.created === true && saved.version === before.version + 1);
replay = await request("/api/replay/state");
const source = graph().sources.find((item) => item.id === saved.sourceId);
check("refresh returns exact unsigned source text with no trusted factual statements", source?.kind === "note_span" && source.status === "unsigned" && source.text === note.text && source.statements.length === 0);
check("save preserves tasks, dependencies, projects, drafts and findings", ["tasks", "dependencies", "projects", "drafts", "findings"].every((field) => JSON.stringify(graph()[field]) === JSON.stringify(before[field])));
check("save adds timeline event and keeps replay paused", replay.timeline.some((event) => event.id === saved.sourceId && event.type === "signout" && event.status === "unsigned" && event.trigger === false) && replay.clock.playing === false);
let agent = await request("/api/agent");
const noteAudit = agent.audit.filter((entry) => entry.action === "record_synthetic_handover" && entry.encounterId === "E-201");
check("save creates hash-linked human audit without model run", noteAudit.length === 1 && noteAudit[0].actorId === "rn-charge" && noteAudit[0].version === saved.version && /^[a-f0-9]{64}$/.test(noteAudit[0].hash) && agent.runs.length === 0);
const repeat = await request("/api/handovers", note);
check("same command is idempotent despite its old expected version", repeat.created === false && repeat.sourceId === saved.sourceId && repeat.version === saved.version);
check("changed text with same identity is rejected", (await request("/api/handovers", { ...note, text: "Different synthetic note" }, 409)).error === "HANDOVER_COMMAND_CONFLICT");
check("stale new command is rejected", (await request("/api/handovers", { ...note, commandId: randomUUID() }, 409)).error === "STALE_VERSION");
await request("/api/handovers", { ...note, actorId: "lab-owner" }, 409);
await request("/api/handovers", { ...note, synthetic: false }, 409);
await request("/api/handovers", { ...note, clinicalOrder: "not permitted" }, 409);
await request("/api/handovers", note, 403, { Origin: "https://unrelated.invalid" });
check("scope, synthetic-only, strict-shape and origin guards reject unsupported input", true);
replay = await request("/api/replay/state");
agent = await request("/api/agent");
check("retries and invalid input add no extra source/version/audit", graph().version === saved.version && graph().sources.filter((item) => item.id === saved.sourceId).length === 1 && agent.audit.filter((item) => item.action === "record_synthetic_handover").length === 1);

const unavailable = await request("/api/agent", { action: "start", encounterId: "E-201", actorId: "rn-charge", mode: "RECORDED META" });
check("edited note does not silently substitute an old Meta capture", unavailable.mode === "UNAVAILABLE" && unavailable.errorCode === "NO_MATCHING_REAL_RECORDING" && unavailable.requests === 0);
const baseline = await request("/api/agent", { action: "start", encounterId: "E-201", actorId: "rn-charge", mode: "RULES BASELINE" });
check("explicit rules review stages supported work without model calls", baseline.mode === "RULES BASELINE" && baseline.status === "staged" && baseline.requests === 0 && baseline.costMicrousd === 0 && baseline.proposalId);
agent = await request("/api/agent");
const proposal = agent.proposals.find((item) => item.id === baseline.proposalId);
check("new handover is cited by the supported pickup question", proposal?.body.actions.some((action) => action.type === "stage_finding" && action.finding.key === "ride" && action.finding.sourceIds.includes(saved.sourceId)));
await request("/api/proposals", { action: "accept", proposalId: baseline.proposalId, actorId: "rn-charge" });
replay = await request("/api/replay/state");
check("human-accepted review appears across scoped department views", graph().findings.some((finding) => finding.key === "ride" && finding.sourceIds.includes(saved.sourceId)) && graph("case_management").tasks.some((task) => task.templateStep === "discharge:pcp" && task.ownerRole === "case_management"));
check("review preserves pending culture rather than inventing a final result", graph().sources.find((item) => item.id === "p-bcx-pre")?.status === "preliminary" && graph().tasks.find((item) => item.id === "p-bcx:final")?.state !== "done");

// Human-authored coordination follows the same staged/accepted/evidenced path.
const project = graph().projects.find((item) => item.kind === "discharge");
assert(project, "Admission event did not create the operational coordination project");
const taskInput = {
  synthetic: true,
  encounterId: "E-201",
  actorId: "rn-charge",
  expectedVersion: graph().version,
  commandId: randomUUID(),
  projectId: project.id,
  sourceId: saved.sourceId,
  ownerId: "pharmacy-owner",
  label: "Confirm existing pharmacy delivery coordination",
  plannedMinutes: 10,
};
const preStage = structuredClone(graph());
const coordinated = await request("/api/coordination", taskInput);
check("staff coordination is labeled as a human proposal", coordinated.synthetic === true && coordinated.mode === "HUMAN PROPOSAL" && coordinated.needsHumanAcceptance === true && coordinated.proposalId && coordinated.taskId);
replay = await request("/api/replay/state");
check("staging coordination does not change graph or complete work", graph().version === preStage.version && JSON.stringify(graph().tasks) === JSON.stringify(preStage.tasks));
const coordinationRetry = await request("/api/coordination", taskInput, [200, 409]);
check("duplicate coordination command cannot create a second proposal", coordinationRetry.proposalId === coordinated.proposalId || coordinationRetry.error === "DUPLICATE_PROPOSAL");
await request("/api/proposals", { action: "accept", proposalId: coordinated.proposalId, actorId: "rn-charge" });
replay = await request("/api/replay/state");
const created = graph().tasks.find((task) => task.id === coordinated.taskId);
check("accepted Pharmacy coordination has assigned owner and both source anchors", created?.kind === "operational" && created.state === "ready" && created.expectedEvidence === "attestation" && created.ownerId === "pharmacy-owner" && created.ownerRole === "pharmacy" && created.sourceIds.includes(project.sourceOrderId) && created.sourceIds.includes(saved.sourceId) && !created.completionSourceId);
const completeInput = { action: "complete", synthetic: true, encounterId: "E-201", taskId: created.id, actorId: "pharmacy-owner", expectedVersion: graph().version, confirmation: "completed" };
check("Case management cannot complete Pharmacy's coordination", (await request("/api/coordination", { ...completeInput, actorId: "cm-owner" }, 403)).error === "SCOPE_DENIED");
check("completion rejects stale record version", (await request("/api/coordination", { ...completeInput, expectedVersion: taskInput.expectedVersion }, 409)).error === "STALE_VERSION");
await request("/api/coordination", { ...completeInput, taskId: "p-bcx:final" }, 409);
check("coordination completion cannot complete an old result or template task", true);
replay = await request("/api/replay/state");
check("denied completion requests leave the Pharmacy task and preliminary result unchanged", graph().version === completeInput.expectedVersion && graph().tasks.find((task) => task.id === created.id)?.state === "ready" && graph().tasks.find((task) => task.id === "p-bcx:final")?.state !== "done");
const completion = await request("/api/coordination", completeInput);
check("named Pharmacy owner explicitly confirms completion", completion.synthetic === true && completion.mode === "HUMAN CONFIRMATION" && completion.taskId === created.id && completion.version === completeInput.expectedVersion + 1);
replay = await request("/api/replay/state");
const completed = graph().tasks.find((task) => task.id === created.id);
check("Pharmacy completion persists human evidence in the shared patient record", completed.state === "done" && completed.completionSourceId && graph().sources.some((item) => item.id === completed.completionSourceId && item.kind === "attestation" && item.taskId === created.id && item.text.includes("pharmacy")));
check("repeated stale completion is rejected", (await request("/api/coordination", completeInput, 409)).error === "STALE_VERSION");
check("repeated current-version completion cannot apply twice", (await request("/api/coordination", { ...completeInput, expectedVersion: graph().version }, 409)).error === "HUMAN_CONFIRMATION_NOT_ALLOWED");
agent = await request("/api/agent");
const completionAudit = agent.audit.filter((item) => item.action === `human_task_attestation:${created.id}`);
check("Pharmacy completion produces exactly one named-owner audit event", completionAudit.length === 1 && completionAudit[0].actorId === "pharmacy-owner");
check("apply-once coordination acceptance remains enforced", (await request("/api/proposals", { action: "accept", proposalId: coordinated.proposalId, actorId: "rn-charge" }, 409)).error === "ALREADY_ACCEPTED");
await request("/api/coordination", { ...taskInput, expectedVersion: graph().version, commandId: randomUUID(), ownerId: "unassigned-person" }, 409);
await request("/api/coordination", { ...taskInput, expectedVersion: graph().version, commandId: randomUUID(), label: "Order a new MRI" }, 409);
await request("/api/coordination", { ...taskInput, expectedVersion: graph().version, commandId: randomUUID(), sourceId: "missing-source" }, 409);
await request("/api/coordination", { ...taskInput, expectedVersion: graph().version, commandId: randomUUID(), projectId: "missing-project" }, 409);
await request("/api/coordination", { ...taskInput, commandId: randomUUID() }, 409);
check("coordination rejects unassigned owners, clinical order requests, missing anchors and stale records", true);
agent = await request("/api/agent");
check("staff workflow and explicitly chosen rules made no paid request", agent.runs.every((run) => run.requests === 0 && run.costMicrousd === 0) && agent.budget.localSpentMicrousd === 0 && agent.budget.localReservedMicrousd === 0 && agent.budget.uncertainRequests === 0);
console.log(JSON.stringify({ status: "passed", synthetic: true, target: target.origin, checks, count: checks.length, httpRequests: requestCount, paidRequests: 0 }, null, 2));
