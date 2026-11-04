import { z } from "zod";
import { runtimeDatabase } from "@/db/runtime";
import { ReplayStore } from "@/db/replay-store";
import { commandBody, commandError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CommandSchema = z.object({ action: z.union([z.enum(["play", "pause", "step", "reset"]), z.literal(1), z.literal(60), z.literal(2000)]) }).strict();
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try { return Response.json(await new ReplayStore(await runtimeDatabase()).state(), { headers }); }
  catch { return Response.json({ synthetic: true, mode: "UNAVAILABLE", error: "Replay state unavailable" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  try {
    const body = await commandBody(request, CommandSchema, 512);
    return Response.json(await new ReplayStore(await runtimeDatabase()).state(Date.now(), body.action), { headers });
  } catch (error) { return commandError(error); }
}
