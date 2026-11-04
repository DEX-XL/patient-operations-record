// Offline wiring probe: dummy credential, loopback server, no Meta inference.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveMetaCredential } from "../src/lib/meta-credential.ts";

const workspace = resolve("data/muse-offline-probe");
await mkdir(workspace, { recursive: true });
const requests = [];
let catalogReads = 0;
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/muse-code/models" && process.argv.includes("--catalog-read")) {
    // This exact read-only route was observed from the native CLI locally.
    // Never forward any inference request during this diagnostic.
    try {
      const key = await resolveMetaCredential({ META_USE_MUSE_LOGIN: "true" });
      if (!key || catalogReads) throw new Error("CATALOG_REFUSED");
      catalogReads++;
      const response = await fetch("https://api.meta.ai/muse-code/models", { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      const text = await response.text();
      if (Buffer.byteLength(text) > 524288) throw new Error("CATALOG_TOO_LARGE");
      requests.push({ path: "/muse-code/models", method: "GET", catalogHttpStatus: response.status });
      res.writeHead(response.status, { "Content-Type": "application/json" }).end(text);
    } catch { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "READ_ONLY_CATALOG_UNAVAILABLE" } })); }
    return;
  }
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 262144) { res.writeHead(413).end(); return; } chunks.push(chunk); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ path: req.url?.split("?")[0], method: req.method, bodyBytes: size, keys: Object.keys(body), model: body.model, maxOutputTokens: body.max_output_tokens, toolCount: Array.isArray(body.tools) ? body.tools.length : null, stream: body.stream });
  } catch { requests.push({ path: req.url?.split("?")[0], method: req.method, invalidJson: true, bodyBytes: size }); }
  // Deliberate permanent error, no retry advice and no fabricated model result.
  res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { type: "invalid_request_error", message: "OFFLINE_PROBE_ONLY_NO_META_CALL" } }));
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();
const executable = resolve("../.tools/muse/muse-bin-1.4.13-R6996.1.exe");
const args = ["exec", "--json", "--provider", "meta", "--preset", "empty", "--model", "muse-spark-1.3", "--reasoning-effort", "low", "--contributor-mode", "off", "--base-url", `http://127.0.0.1:${port}/v1`, "--api-key-stdin", "--workspace", workspace, "--max-model-steps", "1", "--no-foreign-personal-context", "--disable-web-tools", "--disable-reminders", "--disable-shell", "--disable-write", "--disable-request-user-input", "--approval-judge", "off", "--no-session-log", "Synthetic offline wiring probe. Reply OFFLINE_ONLY."];
const child = spawn(executable, args, { cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, META_API_KEY: "offline-placeholder", MODEL_API_KEY: "offline-placeholder", MUSE_TRANSPORT_TRACE: "0" } });
child.stdin.end("offline-placeholder\n");
// Native output can contain local context. Only emit the safe probe summary.
child.stdout.resume(); child.stderr.resume();
const timer = setTimeout(() => child.kill(), 60_000);
let startError = false;
const exitCode = await new Promise((resolveExit) => { child.once("error", () => { startError = true; resolveExit(null); }); child.once("close", resolveExit); });
clearTimeout(timer); await new Promise((resolveClose) => server.close(resolveClose));
console.log(JSON.stringify({ diagnosticOnly: true, realMetaInferenceRequests: 0, readOnlyMetaCatalogRequests: catalogReads, nativeExited: exitCode, startError, requests }, null, 2));
if (requests.filter((request) => request.method === "POST").length !== 1 || startError) process.exitCode = 1;
