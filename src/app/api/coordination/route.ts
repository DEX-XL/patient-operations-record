import { OperationsStore } from "@/db/operations";
import { runtimeDatabase } from "@/db/runtime";
import { DEMO_ROSTER } from "@/domain/roster";
import { commandBody, commandError, NO_STORE } from "@/lib/http";
import { CoordinationCommandSchema, confirmCoordinationTask, stageCoordinationTask } from "@/workflow/coordination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await commandBody(request, CoordinationCommandSchema, 4096);
    const store = new OperationsStore(await runtimeDatabase(), DEMO_ROSTER);
    return Response.json("action" in body ? await confirmCoordinationTask(store, body) : await stageCoordinationTask(store, body), { headers: NO_STORE });
  } catch (error) {
    return commandError(error);
  }
}
