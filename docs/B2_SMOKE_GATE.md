# B2 smoke gate — passed October 30

Current status supersedes the historical packet below. Rohit subsequently confirmed the $150 grant balance and explicitly requested paid calls. The first bounded request authenticated but was incomplete; the manually authorized follow-up returned SYNTHETIC_CONNECTION_OK. Combined tracked cost was $0.002460, below $0.02. Actual response IDs and reconciled usage are in BUILD_LOG.md. This approval is already fulfilled; do not ask for it again or repeat either request. All later calls still require current funding evidence, reservations and the approved bucket caps.

## Historical review packet (October 29, before execution)

**Approval received October29:** Rohit approved this one ≤$0.02 call after the funding checks pass. Do not ask for that approval again. Muse native login now provides a permitted credential path: set META_USE_MUSE_LOGIN=true in the smoke process to reuse the official API credential; no dotenv read or manual key paste is needed. `pnpm meta:verify` already authenticated with this route and confirmed Spark1.3, with zero inference requests. Funding is the remaining blocker: Billing is unavailable for both user and agent, Usage0 does not show grant balance/expiry, and no approved funding record has been created. No real smoke call or reservation has run. The manual hidden-prompt example below is an optional fallback, not a current setup requirement.

The engine and tests are ready. Rohit's direct instruction requires asking him before the first paid Meta request. Approval for the build does not approve this call. The one-call runner and reservation path are implemented and covered by 14 mocked tests; no real request has run. `pnpm smoke:prepare` prints a dry run only.

## Exact proposed request

One POST to `https://api.meta.ai/v1/responses`, model `muse-spark-1.3` (Standard model ID).

```json
{
  "model": "muse-spark-1.3",
  "store": false,
  "input": "Synthetic connectivity test only. Reply exactly: SYNTHETIC_CONNECTION_OK. Do not give clinical advice or invoke tools.",
  "reasoning": { "effort": "low" },
  "max_output_tokens": 128,
  "parallel_tool_calls": false
}
```

No tools, private files, chart data, held-out cases or conversation context. One request only, 30-second timeout, zero automatic retries. A timeout/incomplete/error consumes the authorization; retain the reservation until reconciled. Do not follow redirects or log authorization headers/provider error payloads. Record only response ID, status, safe connectivity text, usage and cost.

## Mandatory conditions before execution

1. Rohit approves **this one synthetic call**, maximum **$0.02** from the **$15 runtime-dev bucket**. Approval never authorizes card billing or further calls.
2. Recheck the account's applied remaining free grant, exact expiry and any shared Muse/runtime usage. The October 27 $150 screenshot is historical. Unknown expiry or unreconciled shared usage keeps the gate closed. Verify that the $30 reserve remains untouched; an email alert is not a hard cap.
3. Recheck price/output-cap semantics in the official documentation. October 29 rates: Spark Standard $1.25/M input, $4.25/M output, reasoning included in output. This short, fixed input and 128-token cap should cost much less than the $0.02 reservation; it is not a promise about a bank-level/provider cap.
4. The implemented runner persists a worst-case reservation in the local ledger **before** the request. It reserves against the remaining grant envelope, the $15 runtime-dev bucket and the $120 combined spend ceiling; uncertain entries keep their reservation. Its single authorization cannot be reused. A reservation failure sends no request. The B5 general-purpose ledger/agent loop is still later work.
5. Use credentials supplied directly to the process without exposing them. **Do not read app/.env.local**, even to inject the key into a subprocess. If no permitted credential source is available, stop for local user setup; do not create another key, ask for it in chat or change the secret-file restriction implicitly.
6. B1/B2 tests/build remain green. On completion, reconcile reported usage and Billing, update the ledger/build log, and leave app live mode disabled. A successful connectivity check does not validate B5 tool calling or encrypted replay.

## Operator setup after explicit approval

`scripts/meta-smoke.ts` reads only the designated nonsecret `data/b2-smoke-approval.json` and process environment. The approval record must match `SmokeApprovalSchema` in `src/lib/meta-smoke.ts`, including fresh verification timestamps, exact grant expiry, remaining free credits in integer microdollars, reconciled external spend by bucket and the human approval. Never fabricate missing values. Do not create this record as approved before Rohit's reply.

The current Codex process has **no MODEL_API_KEY** available. A user-controlled terminal can supply it directly as process environment without opening the protected secret file; never paste it into chat or a shell command. For example, after the approval record and checks are complete, a local PowerShell session can use a hidden prompt:

```powershell
$smokeCredential = Read-Host 'Meta key (hidden; do not paste into chat)' -AsSecureString
try {
  $env:MODEL_API_KEY = [System.Net.NetworkCredential]::new('', $smokeCredential).Password
  $env:META_LIVE_ENABLED = 'true'
  pnpm smoke:run
} finally {
  Remove-Item Env:MODEL_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:META_LIVE_ENABLED -ErrorAction SilentlyContinue
  $smokeCredential.Dispose()
}
```

This is a user-operated credential path, not authorization to read `.env.local`. The runner writes a safe report to ignored `data/b2-smoke-report.json`; no key, arbitrary provider payload or reasoning is printed. No automatic retry or new key is created. Do not run this example until the human approval and funding checks are complete. It is preparation, not a request to enter a key now.

Official references: [Responses API](https://dev.meta.ai/docs/protocols/responses), [reasoning](https://dev.meta.ai/docs/reasoning), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), [models](https://dev.meta.ai/docs/models). Checked October 29, 2026; recheck at execution if circumstances change.
