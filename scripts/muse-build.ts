// One bounded Muse Code contribution. Never falls back to direct CLI billing.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { runtimeDatabase } from "../src/db/runtime";
import { fundingRecords } from "../src/db/schema";
import { FundingSchema, MUSE_BODY_LIMIT, MUSE_RUN_CAP_MICROUSD } from "../src/lib/budget";
import { validateFundingEvidence } from "../src/lib/meta-smoke";
import { resolveMetaCredential } from "../src/lib/meta-credential";
import { forwardMuseRequest, MuseGatewayError } from "../src/agent/muse-gateway";

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ dryRun: true, model: "muse-spark-1.3", bucket: "museBuild", bucketCapUsd: 75, runCapMicrousd: MUSE_RUN_CAP_MICROUSD, maxModelRequests: 1, maxOutputTokens: 4096, bodyByteLimit: MUSE_BODY_LIMIT, nativeCredentialsStayInGateway: true, requires: ["current grant evidence or explicit human balance confirmation", "reconciled shared usage", "successful approved B2 smoke", "META_LIVE_ENABLED=true", "data/muse-task.md containing synthetic/public code only"] }, null, 2));
    return;
  }
  if (process.env.META_LIVE_ENABLED !== "true") throw new Error("LIVE_DISABLED");
  const connection = await runtimeDatabase();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const [record] = await connection.db.select().from(fundingRecords).where(eq(fundingRecords.id, "active"));
    const proof = FundingSchema.safeParse(record?.evidence);
    if (!proof.success) throw new Error("VERIFIED_FUNDING_AND_SMOKE_REQUIRED");
    validateFundingEvidence(proof.data.evidence, Date.now());
    const credential = await resolveMetaCredential();
    if (!credential) throw new Error("NO_PERMITTED_MUSE_CREDENTIAL");
    const task = await readFile("data/muse-task.md", "utf8");
    if (!task.trim() || Buffer.byteLength(task) > 24_000 || task.includes(credential) || /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:sk-|mmk-|LLM_)[A-Za-z0-9_-]{24,}/.test(task)) throw new Error("MUSE_TASK_REFUSED");
    const runId = randomUUID(), token = randomBytes(32).toString("hex"), startedAt = new Date().toISOString();
    const workspace = resolve(`data/muse-workspaces/${runId}`);
    await mkdir(workspace, { recursive: true });
    const promptPath = resolve(workspace, "task.md"); await writeFile(promptPath, task);
    let attempted = false, catalogRead = false, gatewayError: string | undefined;
    let completion: Awaited<ReturnType<typeof forwardMuseRequest>> | undefined;
    server = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
      try {
        if (request.method === "GET" && request.url?.split("?")[0] === "/muse-code/models" && !catalogRead) {
          catalogRead = true;
          const catalog = await fetch("https://api.meta.ai/muse-code/models", { headers: { Authorization: `Bearer ${credential}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
          const text = await catalog.text(); if (Buffer.byteLength(text) > 524_288) throw new Error("CATALOG_BOUND");
          response.writeHead(catalog.status, { "Content-Type": "application/json" }).end(text); return;
        }
        if (request.method !== "POST" || request.url !== "/v1/responses" || attempted) { response.writeHead(400).end(JSON.stringify({ error: { message: "MUSE_RUN_REQUEST_BOUND" } })); return; }
        attempted = true;
        let bytes = 0; const chunks: Buffer[] = [];
        for await (const chunk of request) { bytes += chunk.length; if (bytes > MUSE_BODY_LIMIT) throw new Error("BODY_BOUND"); chunks.push(chunk); }
        completion = await forwardMuseRequest({ connection, runId, step: 0, credential, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" }).end(completion.stream);
      } catch (error) {
        gatewayError = error instanceof MuseGatewayError || error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "MUSE_GATEWAY_REFUSED";
        response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: gatewayError } }));
      }
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("LOOPBACK_SERVER_UNAVAILABLE");
    const executable = resolve("../.tools/muse/muse-bin-1.4.13-R6996.1.exe");
    const args = ["exec", "--json", "--provider", "meta", "--preset", "empty", "--model", "muse-spark-1.3", "--reasoning-effort", "low", "--contributor-mode", "off", "--base-url", `http://127.0.0.1:${address.port}/v1`, "--api-key-stdin", "--workspace", workspace, "--max-model-steps", "1", "--no-foreign-personal-context", "--disable-web-tools", "--disable-reminders", "--disable-shell", "--disable-write", "--disable-request-user-input", "--approval-judge", "off", "--no-session-log", "--prompt-file", promptPath];
    const child = spawn(executable, args, { cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, META_API_KEY: token, MODEL_API_KEY: token, MUSE_TRANSPORT_TRACE: "0" } });
    child.stdin.end(`${token}\n`); child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 180_000);
    const exitCode = await new Promise<number | null>((done) => { child.once("error", () => done(null)); child.once("close", done); });
    clearTimeout(timer);
    // Keep only final assistant text. Do not persist internal reasoning/events.
    if (completion?.outputText) await writeFile(`data/muse-output-${runId}.md`, completion.outputText.split(credential).join("[REDACTED]") + "\n");
    const report = { runId, startedAt, builder: "Muse Code", model: "muse-spark-1.3", taskSha256: createHash("sha256").update(task).digest("hex"), exitCode, responseId: completion?.responseId, actualMicrousd: completion?.actualMicrousd, usage: completion?.usage, gatewayError, outputPath: completion?.outputText ? `data/muse-output-${runId}.md` : null, completionRequiresReview: true };
    await writeFile(`data/muse-build-${runId}.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    if (!completion) process.exitCode = 1;
  } finally {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    connection.client.close();
  }
}
main().catch((error) => { const message = error instanceof Error && /^(LIVE_DISABLED|VERIFIED_FUNDING_AND_SMOKE_REQUIRED|NO_PERMITTED_MUSE_CREDENTIAL|MUSE_TASK_REFUSED|STALE_GRANT_EVIDENCE|STALE_PRICING_EVIDENCE|GRANT_EXPIRED_OR_TOO_CLOSE)$/.test(error.message) ? error.message : "MUSE_SETUP_REFUSED_DETAILS_WITHHELD"; console.error(message); process.exitCode = 1; });
