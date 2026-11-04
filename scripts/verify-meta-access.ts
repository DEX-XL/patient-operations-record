import { resolveMetaCredential } from "../src/lib/meta-credential";

async function main() {
  const key = await resolveMetaCredential();
  if (!key) throw new Error("NO_PERMITTED_CREDENTIAL");
  // Catalog read only: this generates no model output and sends no prompt.
  const response = await fetch("https://api.meta.ai/v1/models", {
    headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) { console.log(JSON.stringify({ authenticated: false, httpStatus: response.status, inferenceRequestsSent: 0 })); process.exitCode = 1; return; }
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  console.log(JSON.stringify({ authenticated: true, modelAvailable: payload.data?.some((model) => model.id === "muse-spark-1.3") ?? false, inferenceRequestsSent: 0 }));
}
main().catch(() => { console.error("META_CATALOG_CHECK_FAILED_DETAILS_WITHHELD"); process.exitCode = 1; });
