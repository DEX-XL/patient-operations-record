# Submission working draft — not submitted

Track: Indie Developer. Problem statement: Build for Your World. Team name remains Rohit's decision. Repository, product and YouTube URLs are pending; none should be invented.

## Description

Patient Operations Record is a synthetic U.S. inpatient shift-change replay. A shared patient record connects existing orders, pending results, operational task chains and named owners across charge nursing, hospitalists, laboratory and case management.

Meta's `muse-spark-1.3` reconciles messy sign-out shorthand with source facts, then proposes linked operational work for review. A deterministic validator checks citations, assignment, dependencies and encounter versions. A person accepts the exact batch. An OR-slot change makes an old proposal stale; acceptance is blocked and a new proposal uses the changed record.

The prototype includes cited handover/pending-tests drafts, real Meta recordings for keyless playback, a rules baseline and a reconciled usage ledger. It makes no clinical recommendations, creates no orders and writes no final EHR notes. All data are synthetic. Real hospital integration and clinical validation are future work.

Product URL is still pending. Evaluation disclosure: source frozen before exposure and both original raw hashes verified; four baseline executions are saved, twelve Meta trials are unsent pending current funding. The frozen output/scorer and gold categories/reference/span contract are incompatible, so official precision/recall/owner metrics are unavailable. No post-exposure mapping or algorithm change was made. See EVAL.md. Do not substitute development scores, a superiority claim or claimed time savings.

## Meta products and contribution

Runtime: Meta Model API, `muse-spark-1.3`, bounded role-scoped tools and validated staging. Three actual development captures support recorded playback. Muse Code produced two reviewed coding contributions: the keyless launcher/environment isolation and the shared request-size/pricing bound. `BUILD_LOG.md` includes response IDs, tokens, costs and failures. Codex built/reviewed the remaining implementation; do not attribute the entire app to Muse.

Why Meta: the working example uses its tool calls to reconcile shorthand against structured context; the reproducible recordings expose what the actual model did. A future hospital deployment could investigate an appropriately hosted open-weight model within its privacy boundary. No local Llama run or model-equivalence claim has been demonstrated.

## Product feedback from actual build

Native Muse Code's observed default request allowed 128,000 output tokens. A local no-inference probe identified this, and the launcher now bounds output and reserves budget before inference. A real runtime request also reached the initial 32KiB context bound because encrypted replay contributes to request size; the shared bound and conservative reservation were corrected to 64KiB. Billing remained on “Loading billing” during checks; the project records user-confirmed funding evidence transparently. These are observed integration details, not general provider reliability statistics.

Private review video: evidence/video-draft/patient-ops-recorded-review-draft.mp4 in the parent workspace,179seconds, actual captured UI with local synthetic narration and RECORDED META labels. It explicitly discloses incomplete evaluation. This is not an uploaded URL or final LIVE demonstration.

Final packet still needs: separately approved public source/licensing/hosting, actual remaining trials with honest limitations, verified accessible hosted URL, final accessible three-minute video, Rohit's field/consent review and final submission. No posting, organizer contact or submission has occurred.
