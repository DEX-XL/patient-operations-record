// This preload intentionally prevents Next from opening ANY dotenv files.
// No credentials are required for the B1/B2 build, development or preview.
const path = require("node:path");
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const envModule = require.resolve("@next/env", { paths: [path.dirname(require.resolve("next/package.json"))] });
const original = require(envModule);
require.cache[envModule].exports = {
  ...original,
  loadEnvConfig() { return { combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] }; },
};
// Fail closed if framework code ever bypasses its env loader after an upgrade.
const isSecretEnv = (file) => {
  if (typeof file !== "string" && !(file instanceof URL) && !Buffer.isBuffer(file)) return false;
  const name = path.basename(file instanceof URL ? require("node:url").fileURLToPath(file) : file.toString());
  return name === ".env" || name.startsWith(".env.") && name !== ".env.example";
};
for (const method of ["readFileSync", "openSync", "createReadStream"]) {
  const native = fs[method];
  fs[method] = function(file, ...args) {
    if (isSecretEnv(file)) throw new Error("DOTENV_READ_DISABLED");
    return native.call(this, file, ...args);
  };
}
for (const method of ["readFile", "open"]) {
  const native = fs.promises[method];
  fs.promises[method] = function(file, ...args) {
    if (isSecretEnv(file)) return Promise.reject(new Error("DOTENV_READ_DISABLED"));
    return native.call(this, file, ...args);
  };
}
const nativeReadFile = fs.readFile;
fs.readFile = function(file, ...args) {
  if (isSecretEnv(file)) { const callback = args.at(-1); queueMicrotask(() => callback(new Error("DOTENV_READ_DISABLED"))); return; }
  return nativeReadFile.call(this, file, ...args);
};
syncBuiltinESMExports();
