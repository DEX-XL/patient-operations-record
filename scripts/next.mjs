import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Next's processed-env marker alone still reads files. Preload a no-env loader
// in the CLI AND workers, before Next is imported. See no-env.cjs.
const require = createRequire(import.meta.url);
const preload = fileURLToPath(new URL("./no-env.cjs", import.meta.url));
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preload)}`.trim(), NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
