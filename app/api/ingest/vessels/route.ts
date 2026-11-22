import { ingestVessels, runtimeEnv } from "../../../../lib/live-store";
export const dynamic = "force-dynamic";
export async function POST(request:Request) {
  const token = runtimeEnv().VESSEL_INGEST_TOKEN;
  if (!token || token.length < 32) return Response.json({error:"Collector is not configured."},{status:503});
  const supplied = request.headers.get("Authorization") || "";
  if (supplied !== `Bearer ${token}`) return Response.json({error:"Unauthorized"},{status:401});
  if (Number(request.headers.get("Content-Length") || 0) > 300_000) return Response.json({error:"Snapshot is too large."},{status:413});
  const raw = await request.text();
  if (raw.length > 300_000) return Response.json({error:"Snapshot is too large."},{status:413});
  let body;
  try { body = JSON.parse(raw); } catch { return Response.json({error:"Invalid JSON"},{status:400}); }
  if (!Array.isArray(body.positions) || body.positions.length > 600) return Response.json({error:"Invalid position snapshot"},{status:400});
  const accepted = await ingestVessels(body.positions);
  return Response.json({accepted,receivedAt:Date.now()},{headers:{"Cache-Control":"no-store"}});
}
