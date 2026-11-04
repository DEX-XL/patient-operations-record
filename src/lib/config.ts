export const BUDGET_CAPS_USD = Object.freeze({ museBuild: 75, runtimeDev: 15, heldoutEval: 10, publicDemo: 20, reserve: 30 });
export const MODEL_LIMITS = Object.freeze({ requestsPerRun: 6, functionsPerRun: 6, outputTokens: 4096, requestTimeoutMs: 30_000, runTimeoutMs: 90_000, requestBodyBytes: 65_536 });
export const MODES = ["LIVE META", "RECORDED META", "RULES BASELINE", "SIMULATED EVENT", "UNAVAILABLE"] as const;
export type ExecutionMode = typeof MODES[number];
export const SYNTHETIC_BANNER = "Synthetic data. Not for clinical use. Not HIPAA-certified.";

export function getConfig(env: Record<string, string | undefined> = process.env) {
  return {
    // This flag alone never authorizes a request. Paid runtime is not implemented in B1/B2.
    liveEnabled: env.META_LIVE_ENABLED === "true",
    mode: "UNAVAILABLE" as ExecutionMode,
    model: "muse-spark-1.3",
    databaseUrl: env.DATABASE_URL ?? "file:data/patient-ops.db",
  };
}

export function assertLiveCallAllowed(gate: { userApproved: boolean; balanceVerified: boolean; reserved: boolean }, env: Record<string, string | undefined> = process.env): never {
  if (!getConfig(env).liveEnabled || !gate.userApproved || !gate.balanceVerified || !gate.reserved) {
    throw new Error("LIVE_CALL_BLOCKED: explicit approval, verified grant and reservation required.");
  }
  throw new Error("LIVE_CALL_BLOCKED: paid model transport is not implemented in B1/B2.");
}
