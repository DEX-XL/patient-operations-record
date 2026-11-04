# Patient Operations Record

A synthetic U.S. inpatient shift-change replay for the Meta Global AI Developer Hackathon 2026. It connects unfinished operational work across departments with owners, dependencies and source evidence. People make clinical decisions.

**Synthetic data. Not for clinical use. Not HIPAA-certified.**

## Current build

The local app now has four synchronized department panes, a 48-hour replay, two patient workspaces, planned critical paths, a proposal inbox, cited drafts with human review and diffs, source inspection, and a trace/cost/audit panel. The rules baseline works offline. Six development scenarios and their measured baseline results are in `eval/DEV_RESULTS.md`.

Meta Spark1.3 has now executed real role-scoped tool runs and staged validated proposals. Genuine development recordings retain their response IDs, tool traces and reconciled costs. Muse Code completed two coding contributions: the keyless demo launcher and a bounded64KiB runtime envelope after a real context-limit failure. Codex reviewed/integrated the changes, corrected environment typing, and fixed observer tabs taking over externally started runs. Exact runs, costs and failures belong in BUILD_LOG.md. Held-out evaluation, deployment, video and publication remain pending.

## Run locally

Requires Node.js 22+ and pnpm 11.25.0 (Node 24 used locally).

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm test
pnpm build
pnpm start --port 4391 --hostname 127.0.0.1
```

For development: `pnpm dev`. `pnpm typecheck` checks types, `pnpm guardrails` scans candidate source and Git exclusions, `pnpm check:bundles` verifies required runtime assets after a build, and `pnpm eval:dev` reruns only the six development cases. Use the package test wrapper so Windows SQLite handles close before temporary-file cleanup.

For keyless playback after building: `pnpm demo --port 4393 --hostname 127.0.0.1` (or `npm run demo -- --port 4393` where npm is installed). The launcher defaults to RECORDED META, removes inherited model keys and disables native-login/live-call flags. Recordings must match the exact synthetic context and persona; other contexts report UNAVAILABLE. No deterministic output is relabeled as a Meta capture.

The package scripts disable Next's automatic dotenv loading and guard dotenv file reads, including in child workers. **Do not invoke Next directly or load `.env.local`.** Explicit process environment supplies database settings. Local storage defaults to the ignored `data/patient-ops.db`. No database account, hosting subscription or deployment is required locally.

## Try the offline demonstration

1. Start in Unit replay, select **2000× demo**, then Play. The replay pauses at the first sign-out.
2. Reconcile P-101 in **RULES BASELINE**. The run proposes a source link and resumes the replay. After the supplied OR slot moves, the inbox marks the old proposal stale; attempting acceptance rejects it. Pause, reject the stale batch and reconcile the current record.
3. At the pneumonia night sign-out, open P-201 and reconcile. Inspect the preliminary blood-culture link, follow-up owner and case-management commitments. As Charge RN, accept the exact batch; the case-management pane updates on the same shared tick.
4. On a patient workspace, stage a factual handover or pending-tests section. Inspect the citations in the inbox and accept the draft. Review text, inspect the diff and progress the simulated review states. Unsupported edits are rejected and remain editable.
5. Run the explicitly labeled unsupported-line test. A valid citation does not make the invented sentence supported. Inspect a source drawer; Escape closes it and returns keyboard focus.
6. A task's assigned owner or Charge RN can confirm eligible operational work. This records a human attestation. Model output cannot mark a task done.

The demo persona selector changes the server-validated action actor. All four panes remain visible as an observer console. These role filters are not hospital authentication or SSO.

## Engine and safety contract

- Handwritten templates and supplied orders define workflows. The agent can propose operational work; it cannot create a clinical gate or order.
- Version-checked acceptance validates and atomically applies the exact batch once, increments the encounter version and appends a hash-linked audit event. Stale, duplicate, cyclic or out-of-scope changes fail.
- Completion requires matching source events or a permitted human attestation. Preliminary reports never complete final-report steps.
- Each draft line must cite visible evidence and match its normalized factual statements. A resolvable citation alone is insufficient. Superseded results cannot support current draft statements, and medication text must match supplied structured data verbatim.
- Review, adoption, signing and communication states are simulated. No external EHR write or final note occurs.
- Planned durations and supplied schedules are not ETAs, discharge readiness or outcome predictions.
- Each model step is a separate server request. The clock pauses during a run; database state preserves tool pairing, encrypted reasoning replay and bounded progress. Internal reasoning and credentials are not exposed in the UI.
- Recordings require actual LIVE META provenance, matching context, settled ledger entries and current validation. The manifest contains only exported, reconciled real captures. In-memory test mocks are not recording assets.
- The local audit chain detects changes relative to a trusted retained hash; it is not an externally anchored immutable log.

## Financial boundaries

Only the existing **$150 Meta grant** is authorized: Muse building $75, runtime development/smoke $15, held-out evaluation $10, public demo/video $20, **$30 never spent**. These app limits are not a Meta billing-provider hard cap.

Rohit directly confirmed the current$150 balance and requested paid calls on October30. That confirmation is recorded as human evidence; the grant expiry remains unknown. It is not replaced with an invented date. Human balance evidence authorizes a bounded two-hour coding session; ordinary dashboard evidence retains a15-minute refresh. Known expiry, exhausted caps or ambiguous usage still block calls.

The real smoke gate passed: the128-token initial call was incomplete; one explicitly requested1024-token verification completed successfully. Both cost$0.002460 combined, below the$0.02 bound, with no automatic HTTP retry. Runtime calls require successful smoke, current funding evidence, live enablement and atomic worst-case reservations. Missing or ambiguous usage retains the reservation and blocks later calls.

`pnpm muse:prepare` is dry-run information. `pnpm muse:run` uses a loopback spending gate for one native Muse Code request, capped at4096 output tokens and$1 per contribution inside the$75 build bucket. The CLI receives a local token; the actual credential stays in the gateway. Native requests cannot bypass the ledger through this launcher. Model-generated code is reviewed before application. Its task input is explicit synthetic/public source only; native shell, workspace writes, web tools and unrelated personal context are disabled. No card fallback, top-up, paid hosting or alternate paid provider is authorized.

Native Muse authentication may be reused server-side only with explicit `META_USE_MUSE_LOGIN=true`. `pnpm meta:verify` uses the read-only model catalog, with no inference. Never print the native credential store or any key. Secrets do not belong in prompts, logs, client bundles, screenshots or Git.

For a separately funded local video take, the operator sets `META_RUNTIME_BUCKET=publicDemo`; evaluation uses `heldoutEval` only after B7's freeze/hash gate. Local runs otherwise use `runtimeDev`. Vercel locks inference to `publicDemo`. These process settings do not enable live mode or waive the existing funding/reservation checks, and browser commands cannot select a bucket.

## Evaluation and delivery

Before held-out exposure, [the registered evaluation protocol](docs/EVAL_PROTOCOL.md) now fixes common proposal-action scoring for both methods, trial accounting and the freeze/unsealing order. `pnpm exec tsx scripts/eval-freeze.ts --prepare` is a source-only dry run; `--freeze` refuses to run before November1 9PM EST and never overwrites an existing manifest; `--verify` detects changed, added or removed frozen source. Held-out case hashes use raw bytes, separately from the source manifest's line-ending normalization. The latest evaluation-only changes passed 189 tests across 21 files and typecheck; the earlier fresh-clone product/build verification is recorded separately below.

`eval/DEV_RESULTS.md` reports the development baseline, including extra detections that reduce precision. It is not a Meta-versus-rules result. No clinical, time-saving or adoption benefit is claimed. B7 has now begun after source freeze: both original raw dataset hashes match and four baseline runs are saved. The gold's six-kind/span/reference scoring contract is incompatible with the frozen four-kind scorer. Official comparison metrics are unavailable; twelve Meta trials are pre-registered but unsent pending current funding evidence. [EVAL.md](EVAL.md) preserves this limitation and every baseline output. No post-exposure rule or scoring remapping was made.

This is a hackathon demonstration, not hospital integration software. A production path would require hospital-approved source interfaces and identity/access controls, a validated workflow design and appropriately hosted models inside the hospital's privacy boundary. Those integrations and certifications are not present here.

Feature freeze: November 1, 2026, 9 PM America/New_York. Rohit reviews the final packet and submits by November 4 at 7 PM (official deadline 9 PM). Public posting, organizer contact and final submission require separate approval. Planned free hosting is Vercel Hobby plus Turso free; no deployment exists yet. A pre-freeze fresh-clone check passed 179 tests, production build and 20 keyless integration assertions; repeat it on the final public candidate. See [delivery evidence](docs/DELIVERY_CHECK.md), [hosting preparation](docs/DEPLOYMENT_PREP.md), [demo runbook](docs/DEMO_RUNBOOK.md) and [submission draft](docs/SUBMISSION_DRAFT.md).

The approved specification lives in the parent `HANDOFF_TO_CODEX.md`, then `research/DESIGN_C.md`. Current implementation evidence and remaining gates are in `BUILD_LOG.md`.
