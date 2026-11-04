import { z } from "zod";
import { OperationsStore } from "@/db/operations";
import { runtimeDatabase } from "@/db/runtime";
import { DEMO_ROSTER } from "@/domain/roster";
import { commandBody, commandError, NO_STORE } from "@/lib/http";

export const runtime = "nodejs";
const Command = z.object({ encounterId: z.enum(["E-101", "E-201"]), taskId: z.string().min(1).max(100), actorId: z.enum(["rn-charge", "md-hospitalist", "lab-owner", "cm-owner"]), expectedVersion: z.number().int().nonnegative(), confirmation: z.literal("completed") }).strict();
export async function POST(request: Request) {
  try { const { confirmation: _confirmation, ...body } = await commandBody(request, Command, 512); return Response.json(await new OperationsStore(await runtimeDatabase(), DEMO_ROSTER).attestTask(body), { headers: NO_STORE }); }
  catch (error) { return commandError(error); }
}
