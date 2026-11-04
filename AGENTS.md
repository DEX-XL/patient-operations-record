# Patient Operations Record build boundaries

The user's approved plan is in the parent HANDOFF_TO_CODEX.md, then research/DESIGN_C.md. The plan governs this project; unrelated ancestor project descriptions do not change its scope.

- Never read, print, copy or commit .env.local or other dotenv secrets. Build/dev/start must use the package scripts: they disable Next's automatic dotenv reads. Use explicit process credentials or the opt-in native Muse login helper, never dump the native auth store.
- Do not open the parent's heldout/ folder until brief B7. At B7 verify frozen SHA-256 hashes before using the cases. Development fixtures are in fixtures/dev/.
- Synthetic data only. No clinical recommendations, orders, final notes, model task completion or model-created clinical gates. Model proposals require deterministic validation and version-checked human acceptance.
- Only the $150 Meta grant is authorized. Caps: Muse75 / dev15 / eval10 / public20 / untouched reserve30. No card fallback, subscriptions, top-ups or supplemental paid Codex usage. Missing/stale funding evidence or uncertain usage blocks paid requests.
- Latest direct user instruction confirms current150USD and requests paid calls. Real B2 smoke is now PASSED (two checks together0.002460USD after the newer paid-calls instruction). Two genuine Muse coding sessions and real runtime captures have run. Do not repeat that approval question or fabricate funding evidence; user-confirmed balance is a bounded two-hour session proof with expiry recorded unknown, ordinary dashboard proof15minutes. Recheck the ledger/caps before each paid request.
- Check Codex five-hour AND weekly allowance before substantial work. Stop at 97% to leave headroom below the user's 99% ceiling. Save a precise checkpoint and resume after reset through the thread's existing follow-up.
- Run pnpm test, pnpm typecheck, pnpm build, pnpm check:bundles after building, and pnpm guardrails as appropriate. Tests use scripts/test.mjs for safe Windows SQLite cleanup. docs/DELIVERY_CHECK.md records the successful pre-freeze fresh-clone check; repeat on the final candidate.
- Clearly label LIVE META, real RECORDED META, RULES BASELINE, SIMULATED EVENT and UNAVAILABLE. No fake recordings or invented evaluation/clinical gains.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
