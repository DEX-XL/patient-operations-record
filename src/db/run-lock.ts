import { and, eq, lt } from "drizzle-orm";
import type { DatabaseConnection } from "./client";
import { agentRuns } from "./schema";

export async function expireAbandonedRuns(db: Pick<DatabaseConnection["db"], "update">, now: number) {
  await db.update(agentRuns).set({ status: "failed", errorCode: "RUN_EXPIRED" }).where(and(eq(agentRuns.status, "ready"), lt(agentRuns.createdAt, now - 90_000)));
  // A calling step has at most 30s to finish after the 90s run envelope.
  await db.update(agentRuns).set({ status: "failed", errorCode: "RUN_EXPIRED" }).where(and(eq(agentRuns.status, "calling"), lt(agentRuns.createdAt, now - 120_000)));
}
