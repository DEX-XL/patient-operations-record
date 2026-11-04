import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { keylessDemoEnvironment } from "../src/lib/demo-mode";

const nextScript = fileURLToPath(new URL("./next.mjs", import.meta.url));
const forwardedArgs = process.argv.slice(2);

const child = spawn(process.execPath, [nextScript, "start", ...forwardedArgs], {
  stdio: "inherit",
  env: keylessDemoEnvironment(process.env) as NodeJS.ProcessEnv,
  windowsHide: true,
});

child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
