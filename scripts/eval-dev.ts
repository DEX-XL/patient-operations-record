import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { DEV_SCENARIOS } from "../src/replay/scenarios";
import { devContext } from "../src/eval/dev-context";
import { rulesBaseline } from "../src/eval/baseline";
import { scoreItems } from "../src/eval/metrics";
import { proposalObservations } from "../src/eval/observations";

async function main() {
  const configFiles = ["src/eval/baseline.ts", "src/eval/metrics.ts", "src/eval/observations.ts", "src/eval/dev-context.ts", "src/domain/validator.ts", "src/domain/drafts.ts", "src/domain/findings.ts", "src/domain/scope.ts", "fixtures/dev/scenarios.json", "config/templates/ct.json", "config/templates/lab.json", "config/templates/or.json", "config/templates/discharge.json"];
  const hash = createHash("sha256");
  for (const path of configFiles) { hash.update(path); hash.update(await readFile(path)); }
  const configHash = hash.digest("hex");
  await mkdir("eval/dev", { recursive: true });
  const rows = [];
  for (const scenario of DEV_SCENARIOS) {
    const { graph, actor, roster } = devContext(scenario);
    const started = performance.now(); const result = rulesBaseline(graph, actor, roster); const latencyMs = performance.now() - started;
    const observations = proposalObservations(result.proposal?.actions ?? []);
    const report = { scenarioId: scenario.id, set: "development", mode: result.mode, configHash, metrics: scoreItems(observations, scenario.gold), validationPassed: result.validation?.ok ?? true, validationIssues: result.validation && !result.validation.ok ? result.validation.issues : [], items: observations, internalRuleDetections: result.items, latencyMs, tokens: 0, costMicrousd: 0, mustNotRules: scenario.mustNot, safetyAssessment: "Structured validators run; free-text must-not rules require separate adjudication. Not counted as zero violations." };
    await writeFile(`eval/dev/${scenario.id}.json`, JSON.stringify(report, null, 2) + "\n"); rows.push(report);
  }
  const percent = (value: number | null) => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  const markdown = ["# Development rules-baseline run", "", "Development cases only. No held-out content opened. No model requests. This is not a final agent-vs-baseline evaluation or a clinical result.", "", "Scoring uses the common proposal-action extractor for both methods: staged findings and created tasks, with semantic task/finding duplicates counted once. Additional actual tasks count as predictions. Earlier reports scored internal rule detections alone; this pre-freeze correction lowers pneumonia precision without changing the baseline's behavior.", "", `Config SHA-256: ${configHash}`, "", "| Scenario | Recall | Precision | Owner accuracy | Valid proposal |", "| --- | --- | --- | --- | --- |", ...rows.map((row) => `| ${row.scenarioId} | ${percent(row.metrics.recall)} | ${percent(row.metrics.precision)} | ${percent(row.metrics.ownerAccuracy)} | ${row.validationPassed ? "yes" : "NO"} |`), "", "All per-case outputs, failures and denominators are in the adjacent JSON files. Must-not prose has not been automatically adjudicated; no zero-violation claim is made.", ""].join("\n");
  await writeFile("eval/DEV_RESULTS.md", markdown); console.log(markdown);
}
main().catch(() => { console.error("Development evaluation failed; no held-out input or provider request was used."); process.exitCode = 1; });
