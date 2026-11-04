export function GET() {
  return Response.json({ status: "ok", synthetic: true, mode: "SIMULATED EVENT", paidTransportImplemented: true, liveEnabled: process.env.META_LIVE_ENABLED === "true", fundingGateRequired: true }, { headers: { "Cache-Control": "no-store" } });
}
