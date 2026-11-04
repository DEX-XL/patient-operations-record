import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, basename, isAbsolute } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const testRoot = await mkdtemp(join(tmpdir(), "patient-ops-tests-"));
const executable = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const child = spawn(process.execPath, [executable, ...process.argv.slice(2)], {
  stdio: "inherit", env: { ...process.env, PATIENT_OPS_TEST_DIR: testRoot },
});
const code = await new Promise((resolveExit) => { child.on("error", () => resolveExit(1)); child.on("exit", (exitCode) => resolveExit(exitCode ?? 1)); });
// Verify the resolved target before recursive cleanup on Windows.
const target = resolve(testRoot);
const within = relative(resolve(tmpdir()), target);
if (!within || within.startsWith("..") || isAbsolute(within) || !basename(target).startsWith("patient-ops-tests-")) throw new Error("UNSAFE_TEST_CLEANUP_PATH");
await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
process.exitCode = code;
