export type DemoAgentMode = "RECORDED META" | "RULES BASELINE";

export function defaultExecutionMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): DemoAgentMode {
  if (env.PATIENT_OPS_DEMO_MODE === "recorded") return "RECORDED META";
  return "RULES BASELINE";
}

export function keylessDemoEnvironment<T extends NodeJS.ProcessEnv | Record<string, string | undefined>>(
  env: T,
): NodeJS.ProcessEnv {
  const next: Record<string, string | undefined> = { ...env };
  next.PATIENT_OPS_DEMO_MODE = "recorded";
  next.META_LIVE_ENABLED = "false";
  next.META_USE_MUSE_LOGIN = "false";
  delete next.MODEL_API_KEY;
  delete next.META_API_KEY;
  return next as NodeJS.ProcessEnv;
}
