import assert from "node:assert/strict";

// Integration check for a NEW, disposable local database only. Never points at
// a public host, reads credentials or submits a paid model request.
const target = new URL(process.argv[2] ?? "http://127.0.0.1:4395");
assert.equal(process.argv[3], "--disposable-database", "Explicit disposable-database acknowledgment required");
assert.equal(target.protocol, "http:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.pathname, "/");
assert(!target.username && !target.password && !target.search && !target.hash);
const checks = [];
async function request(path, body, expected = 200) {
  const response = await fetch(new URL(path, target), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json", Origin: target.origin } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
function check(name, condition) { assert(condition, name); checks.push(name); }
const health = await request("/api/health");
check("synthetic and live disabled", health.synthetic === true && health.liveEnabled === false);
const initial = await request("/api/agent");
check("new empty database; no paid ledger", !initial.runs.length && !initial.proposals.length && initial.budget.localSpentMicrousd === 0 && initial.budget.localReservedMicrousd === 0);
const html = await (await fetch(target, { signal: AbortSignal.timeout(15_000) })).text();
check("synthetic banner rendered", html.includes("Not for clinical use. Not HIPAA-certified."));
check("recorded default rendered", /<option[^>]*selected[^>]*>RECORDED META<\/option>/.test(html));
let replay = await request("/api/replay/state", { action: "reset" });
check("four synchronized department views", Object.keys(replay.panes).join(",") === "charge_rn,hospitalist,lab,case_management");
const graph = (id, role = "charge_rn") => replay.panes[role].find(item => item.encounterId === id);
async function advanceTo(eventId) {
  let count = 0;
  while (replay.timeline.at(-1)?.id !== eventId) {
    assert(count++ < 24, `Replay did not reach ${eventId}`);
    replay = await request("/api/replay/state", { action: "step" });
  }
  // Preserve the exact recorded context while a person reviews it.
  replay = await request("/api/replay/state", { action: "pause" });
}
async function recorded(encounterId) {
  const run = await request("/api/agent", { action: "start", encounterId, actorId: "rn-charge", mode: "RECORDED META" });
  check(`${encounterId} genuine matching recording`, run.mode === "RECORDED META" && run.status === "staged" && run.recording?.runId && run.responseIds.length > 0 && run.requests === 0 && run.costMicrousd === 0);
  return run;
}
async function accept(proposalId, expected = 200) {
  return request("/api/proposals", { action: "accept", proposalId, actorId: "rn-charge" }, expected);
}
await advanceTo("a-proposal-trigger");
const before = await recorded("E-101");
const preVersion = graph("E-101").version;
await advanceTo("a-or-moved");
check("OR event changes encounter version", graph("E-101").version > preVersion);
const stale = await accept(before.proposalId, 409);
check("stale capture rejected", stale.issues.includes("STALE_VERSION"));
await request("/api/proposals", { action: "reject", proposalId: before.proposalId, actorId: "rn-charge" });
const after = await recorded("E-101");
check("post-reschedule recording is a separate real run", after.recording.runId !== before.recording.runId);
await accept(after.proposalId);
const duplicate = await accept(after.proposalId, 409);
check("apply once", duplicate.error === "ALREADY_ACCEPTED");
await advanceTo("p-night-signout");
const preTasks = new Set(graph("E-201").tasks.map(task => task.id));
const night = await recorded("E-201");
await accept(night.proposalId);
replay = await request("/api/replay/state");
const newCmTasks = graph("E-201", "case_management").tasks.filter(task => !preTasks.has(task.id));
check("accepted work reaches case management", newCmTasks.length >= 2 && newCmTasks.every(task => task.ownerRole === "case_management"));
check("accepted CM work visible to charge RN on same tick", newCmTasks.every(task => graph("E-201").tasks.some(item => item.id === task.id)));
check("preliminary culture is never final", graph("E-201").sources.find(source => source.id === "p-bcx-pre")?.status === "preliminary" && graph("E-201").tasks.find(task => task.id === "p-bcx:final")?.state !== "done");
const unsupported = await request("/api/drafts", { action: "validator_demo", encounterId: "E-101", actorId: "rn-charge" });
check("unsupported cited line blocked", unsupported.issues.some(issue => issue.path === "lines.1"));
const draft = await request("/api/drafts", { action: "stage_factual", encounterId: "E-101", actorId: "rn-charge", kind: "discharge_pending_tests" });
await accept(draft.proposalId);
replay = await request("/api/replay/state");
check("pending pathology draft remains a cited draft", graph("E-101").drafts.some(item => item.state === "draft" && item.lines.some(line => line.sourceIds.includes("a-path-pending"))));
const denied = await request("/api/agent", { action: "start", encounterId: "E-201", actorId: "rn-charge", mode: "LIVE META" });
check("explicit live attempt denied without inference", denied.mode === "UNAVAILABLE" && denied.errorCode === "LIVE_DISABLED" && denied.requests === 0);
const state = await request("/api/agent");
check("playback and acceptance cost zero", state.budget.localSpentMicrousd === 0 && state.budget.localReservedMicrousd === 0 && state.budget.uncertainRequests === 0);
check("reserve remains 30 dollars", state.budget.caps.reserve === 30);
console.log(JSON.stringify({ status: "passed", checks, count: checks.length, paidRequests: 0 }, null, 2));
