import { runtimeDatabase } from "@/db/runtime";
import { commandBody, commandError, NO_STORE } from "@/lib/http";
import { HandoverInputSchema, persistSyntheticHandover } from "@/workflow/handovers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A demo-persona input endpoint, not hospital authentication or an EHR write.
// The helper validates the same strict schema again at the transaction boundary.
export async function POST(request: Request) {
  try {
    const input = await commandBody(request, HandoverInputSchema, 12_288);
    return Response.json(await persistSyntheticHandover(await runtimeDatabase(), input), { headers: NO_STORE });
  } catch (error) {
    return commandError(error);
  }
}
