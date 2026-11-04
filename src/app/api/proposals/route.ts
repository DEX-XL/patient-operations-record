import { z } from "zod";
import { OperationsStore } from "@/db/operations";
import { runtimeDatabase } from "@/db/runtime";
import { DEMO_ROSTER } from "@/domain/roster";
import { commandBody, commandError, NO_STORE } from "@/lib/http";

export const runtime = "nodejs";
const Command = z.object({ action: z.enum(["accept", "reject"]), proposalId: z.string().min(1).max(100), actorId: z.enum(["rn-charge", "md-hospitalist", "lab-owner", "cm-owner"]) }).strict();
export async function POST(request: Request) {
  try {
    const body = await commandBody(request, Command, 512); const store = new OperationsStore(await runtimeDatabase(), DEMO_ROSTER);
    return Response.json(body.action === "accept" ? await store.accept(body.proposalId, body.actorId) : await store.reject(body.proposalId, body.actorId), { headers: NO_STORE });
  } catch (error) { return commandError(error); }
}
