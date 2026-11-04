# Fresh-clone delivery check — October 30, 2026

Historical pre-freeze replay check. The newer192-test final local source/build/archive verification is in [FINAL_DELIVERY_CHECK.md](FINAL_DELIVERY_CHECK.md). B7 is now exposed after its freeze/hash gate; EVAL.md records the scoring-contract failure. Unopened/pending statements below describe October30 only.

Passed in a local Git clone of a secret-free candidate snapshot, with no pre-existing database, build output, model key or native login. The original working app's private database and credentials were not copied. Nothing was pushed or published. This is a pre-freeze delivery check, to be repeated on the final public candidate.

The frozen lockfile installed from the local package cache. Drizzle migrations, **179 tests across 19 files**, production compilation/TypeScript, emitted bundle verification and the secret/held-out boundary scan passed. The candidate Git working tree stayed clean after verification.

`pnpm demo` was deliberately launched with inherited placeholder model keys and live/native-login flags enabled. The launcher removed the keys and forced live/native login off. The fresh product defaulted to RECORDED META. `scripts/check-demo.mjs` passed 20 HTTP integration assertions against its disposable database:

- Three genuine captured runs matched the fresh replay contexts.
- A supplied OR-slot change invalidated the preceding proposal; stale acceptance was rejected, and the post-move recording staged separately.
- Human acceptance applied once. Duplicate acceptance failed.
- Accepted pneumonia coordination tasks appeared in CM and Charge RN views from the shared tick.
- The blood culture stayed preliminary and its final-report task stayed unfinished.
- A cited unsupported sentence was blocked; a pending-pathology section remained a cited draft.
- An explicit LIVE attempt returned LIVE_DISABLED with zero requests.
- Playback, validation and acceptance left spend and reservations at zero; the $30 reserve remained configured.

An earlier candidate also returned HTTP 200 for all 24 concurrent replay reads. That local check does not establish hosted latency, remote transaction behavior or multi-visitor reliability.

## Reproduce on a new disposable checkout

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm test
pnpm build
pnpm check:bundles
pnpm guardrails
pnpm demo --port 4395 --hostname 127.0.0.1
```

In another terminal in the same checkout:

```sh
node scripts/check-demo.mjs http://127.0.0.1:4395 --disposable-database
```

The integration check mutates the disposable synthetic replay. It refuses a nonempty run/proposal/spending history and requires the explicit disposable-database argument and a loopback HTTP URL. Do not aim it at the normal working preview or a public URL.

## Corrections discovered before freeze

Serverless traces originally included migration assets only for the agent endpoint. All five DB-backed API route bundles now include their migrations and journal; the agent bundle includes the three real recording assets. CI checks the emitted manifests after each build.

The evaluation scorer matched overall items one-to-one but could overcount duplicates in per-kind recall. Per-kind counts now use the same matched pairs; a regression with duplicate blood-culture detections and a missed CT item demonstrates the correction. Development aggregate results stayed unchanged. The workspace development config SHA-256 is `8ddf2bc961c5d2de10a7a2ead8d9c2aefa14942341cef7497d45c6d7db9d9d78`; this is not a held-out result.

Operator-owned `META_RUNTIME_BUCKET` now attributes local video or evaluation inference to the correct existing capped bucket. Vercel cannot redirect public inference into development/evaluation, and browser input cannot choose a bucket. Mocked integration tests verify actual reservation attribution and rejection before any provider request.

No additional Meta inference occurred during this check. The main working ledger remains 22 settled requests, $0.198013 tracked cost and zero uncertain/reserved requests. Held-out data remains unopened. Remote deployment, B7 evaluation, filming and final submission remain separate unfinished gates.
