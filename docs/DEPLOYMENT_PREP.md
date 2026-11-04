# Free-hosting preparation

Prepared October 30. No hosted resource or public deployment has been created. Publication requires Rohit's separate approval of the concrete candidate.

## Candidate settings

Use the approved Vercel Hobby and Turso free plan only. The current Vercel documentation limits Hobby to personal, non-commercial use; verify that the project/account qualifies at deployment. Do not start a paid trial, add-on or upgrade. Exceeding free capacity means stop and retain the local/keyless demo.

- Repository root: this app, with Next.js framework detection and Node 24.
- Install: `pnpm install --frozen-lockfile`.
- Build: `pnpm build && pnpm check:bundles`.
- Runtime: Node.js route handlers; persistent remote **libSQL** database compatible with the existing `@libsql/client` + Drizzle stack. Do not silently switch to Turso's newer database engine/driver.
- Server environment: `DATABASE_URL` and `DATABASE_AUTH_TOKEN` for a new synthetic-only remote database; `PATIENT_OPS_DEMO_MODE=recorded`, `META_LIVE_ENABLED=false`, `META_USE_MUSE_LOGIN=false`.
- No model key or native Muse login store on the public recorded deployment. No funding evidence or local ledger database copied into it. The deployment's ledger starts empty and is a playback ledger, not the account's total spend.

Credentials are entered through the provider's private environment controls. Never copy/read a local dotenv file. Local `pnpm demo` remains a keyless alternative.

## Bundle and migration gate

Each serverless route can cold-start independently. The original build traced migrations only into `/api/agent`; replay, proposals, drafts and tasks had no migration assets in their emitted manifests. The build now explicitly includes SQL migrations and the journal for all API routes, with real captures included in the agent route. `pnpm check:bundles` checks the emitted manifests and rejects protected paths.

Apply the included Drizzle migrations to the new remote database through the existing migration script using explicit process environment. Verify an independent cold start of every DB-backed route after deployment. Local SQLite success does not verify remote libSQL transaction behavior, concurrent migration starts, free-plan availability, region latency or provider packaging.

The API has a 45-second function limit and the transport a 30-second request timeout. Vercel's documented Hobby maximum with Fluid Compute is currently longer; no increase is needed. The database persists run state between steps. Keep the per-request design and the existing bounds.

## Approval and remote acceptance

Before asking for publication approval, finish the freeze/evaluation and source review, preserve the actual candidate revision, and prepare the exact repository name, free project/database names and public URL proposal. Approval does not authorize paid hosting or Meta card fallback.

After approval, verify the deployed URL logged out: banner, recorded default, three matching recordings, exact-batch acceptance across panes, stale rejection, cited pending-tests draft, unsupported-line rejection and zero paid requests. Verify no host authentication wall prevents judges from viewing the approved public site. Record the actual URL and actual revision only after success. Do not describe localhost or this preparation as a deployed product.

The public synthetic console currently shares one unit/clock across visitors. It is a demonstration, not multi-tenant hospital access control. Concurrent visitors can change that shared replay. Live public inference remains disabled; enabling it would require a separately reviewed operator/access design and current funding gates.

## Official references checked October 30

- [Vercel Hobby](https://vercel.com/docs/plans/hobby): free plan and personal-use restriction.
- [Vercel function limits](https://vercel.com/docs/functions/limitations): Node duration constraints.
- [Turso TypeScript quickstart, remote libSQL section](https://docs.turso.tech/sdk/ts/quickstart#remote-libsql-database-libsqlclient): existing driver and remote database contract.
- Installed Next.js 16.4.3 guide: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` for route tracing.
