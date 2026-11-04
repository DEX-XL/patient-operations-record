# Evaluation status — B7 incomplete

The algorithm was frozen before reading the held-out cases. Both original held-out raw-byte SHA-256 hashes match. Four baseline executions are saved. **No valid official Meta-versus-baseline score is available, and the twelve Meta trials remain unsent pending current grant verification.** No superiority, safety guarantee, time saved or clinical benefit is claimed.

## Provenance and integrity

The four cases and gold labels were written by Claude (Anthropic) on October27 at Rohit's request, not by independent clinicians. The required model is Meta muse-spark-1.3, a different model family. This is a very small, entirely synthetic set:24required items and3optional items. It is not clinical validation.

Expected hashes were read from the frozen README only after the source freeze. All named raw files were checked before parsing either input or gold:

| File | Original raw SHA-256 | Result |
| --- | --- | --- |
| inputs.json | 99793b06a23bf8e09e90be14cbd61c75462d883486a6a5b057d77821e13868a8 | match |
| gold.json | 3d0fa3333e7e6c25be27447768ace2b84e7cec774248d69410b9c2a1495c8983 | match |

[FROZEN_CONFIG.json](eval/FROZEN_CONFIG.json) identifies the exact frozen prompt, tools, templates, validators, baseline and scorer. Source manifests normalize Git line endings; held-out hashes above use raw bytes. The source freeze happened on November3 EST after quota restrictions prevented the scheduled November1 execution, and still preceded all held-out exposure. No prompt, rule, vocabulary, template or scorer was changed after that exposure.

## Scoring-contract failure

The frozen implementation emits four categories: `link`, `question`, `task`, `pending_owner`. Its scorer pairs normalized kind/subject and reports owner accuracy separately. The untouched gold contract instead requires six categories (`linked_commitment`, `discrepancy_no_order`, `contradiction`, `hidden_promise`, `pending_at_discharge`, `unverified_completion`), exact referenced order/event IDs and overlapping note spans. No bridge between these contracts was registered before exposure.

Reporting the existing four-category score as the official held-out score would therefore be invalid. No post-exposure remapping or favorable partial score has been invented. Precision, recall and owner accuracy under the official contract are **unavailable**, not zero and not passed. [CONTRACT_AUDIT.json](eval/heldout/CONTRACT_AUDIT.json) records the mismatch. This also exposes a product limitation: the fixed finding/template vocabulary cannot express several general family-call/interpreter/other follow-through commitments present in the broader gold set.

## Baseline executions

The unchanged rules baseline ran once on each case through an input-only adapter. The same graph/actor are preserved for planned Meta trials. Current structured order/result statuses and original raw record fields are retained; unsigned/signed note text remains untrusted context. No case fact, final result, clinician owner, task completion or dependency was fabricated from gold. Case IDs map to the existing two synthetic encounters; original unit/handoff/patient metadata remains in source facts. No task-state collection was supplied, so initial tasks/dependencies remain empty. This fact-only adapter does not reproduce a full replay ingestion and limits conclusions about operational chains.

| Case | Proposed actions | Logical observations | Validation | Official recall / precision / owner |
| --- | --- | --- | --- | --- |
| H-A1 | 1 | 1 | valid proposal | unavailable |
| H-A2 | 0 | 0 | no proposal | unavailable |
| H-P1 | 6 | 5 | valid proposal | unavailable |
| H-P2 | 2 | 2 | valid proposal | unavailable |

All raw baseline proposals, input graphs, limitations, observations and measured latency are in [eval/heldout](eval/heldout). Each run used zero model requests/tokens/dollars and zero human acceptances. No-output H-A2 is retained. Validation is separate from adjudication of the gold's safety assertions; unadjudicated rules are not counted as zero violations.

## Meta trials, budget and remaining metrics

[TRIALS.json](eval/heldout/TRIALS.json) pre-registers three trials per case, twelve total. At this checkpoint all are pending current funding evidence and none has reached the provider. Pending unsent trials are not completed runs or model failures. The real development captures are showcase evidence, not substitutes for these trials.

The existing ledger/bounds apply unchanged: heldoutEval $10,6requests/6functions per run,4096output tokens, low effort, no automatic HTTP retry,30-second request and90-second run bounds. Interrupted or ambiguous requests retain their ledger evidence; no replacement trial is added for an unfavorable result. Internal reasoning/credentials stay out of public reports. See [the registered protocol](docs/EVAL_PROTOCOL.md).

Must-not violations, official owner accuracy, held-out stale recovery, unsupported draft-line rate, human actions per completed chain and model latency/tokens/cost are not yet measured. A single development stale-recovery demo and its unit tests are separate evidence, not twelve held-out recovery trials. The existing development baseline table is also separate; its pre-freeze common-action correction changed pneumonia sign-out precision from75% to60% without changing baseline behavior.

Main ledger before any B7 inference:22settled requests,$0.198013 tracked conservative cost,0uncertain/reserved; eval/public buckets $0, reserve $30 untouched. Billing still displayed Loading billing on the current read-only refresh; no grant balance/expiry was invented. Fresh information was requested from Rohit without asking for the existing paid-call approval again.

## Reproduction and next steps

`pnpm exec tsx scripts/eval-freeze.ts --verify` verifies source integrity. `pnpm exec tsx scripts/b7-eval.ts` rechecks both raw dataset hashes, preserves existing baseline outputs and the fixed trial manifest, and makes no model call. `--execute` additionally requires current funding/pricing, reconciled ledger, explicit live enablement and a permitted process credential; it uses the $10 held-out bucket. Until verified, it exits without a provider request. Public release remains gated on Rohit's separate approval.

Completing twelve raw model trials would provide observations but would not retroactively repair the scoring contract. A revised scoring protocol/new evaluation set would need explicit prospective treatment and disclosure; the original blinded result must not be silently rewritten.
