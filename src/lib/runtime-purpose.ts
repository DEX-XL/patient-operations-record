import { BudgetError, type RuntimeBucket } from "./budget";

// Operator-owned process environment only; never accepted from browser input.
export function runtimeBucket(env: Record<string, string | undefined>): RuntimeBucket {
  const selected = env.META_RUNTIME_BUCKET;
  if (selected !== undefined && !["runtimeDev", "heldoutEval", "publicDemo"].includes(selected)) throw new BudgetError("INVALID_RUNTIME_BUCKET");
  if (env.VERCEL === "1") {
    if (selected && selected !== "publicDemo") throw new BudgetError("PUBLIC_DEPLOYMENT_BUCKET_LOCKED");
    return "publicDemo";
  }
  return (selected as RuntimeBucket | undefined) ?? "runtimeDev";
}
