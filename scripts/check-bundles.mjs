import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";

// Inspect emitted path manifests, never dotenv files or native credentials.
const root = process.cwd();
const migrations = (await readdir("drizzle")).filter(file => file.endsWith(".sql")).map(file => `drizzle/${file}`);
const journal = "drizzle/meta/_journal.json";
const captures = JSON.parse(await readFile("fixtures/recordings/index.json", "utf8"));
assert(captures.length > 0, "Real recording manifest must not be empty");
for (const name of captures) assert(/^[a-z0-9-]+__[a-z0-9-]+__[a-f0-9]{64}\.json$/.test(name));
const routes = ["agent", "replay/state", "proposals", "drafts", "tasks"];
for (const route of routes) {
  const manifest = `.next/server/app/api/${route}/route.js.nft.json`;
  const { files } = JSON.parse(await readFile(manifest, "utf8"));
  const traced = new Set(files.map(file => relative(root, resolve(dirname(manifest), file)).split(sep).join("/")));
  for (const file of [...migrations, journal, ...(route === "agent" ? ["fixtures/recordings/index.json", ...captures.map(name => `fixtures/recordings/${name}`)] : [])]) {
    assert(traced.has(file), `${route} is missing ${file} in its server bundle`);
  }
  assert(![...traced].some(file => /(^|\/)\.env(?:\.|$)/.test(file) || /(^|\/)(data|heldout|private)\//.test(file)), `${route} traces a protected path`);
}
console.log(`Bundle check passed: migrations in all ${routes.length} DB routes; ${captures.length} real recordings in agent route; no protected paths.`);
