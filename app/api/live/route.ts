import { aircraftSnapshot, vesselSnapshot } from "../../../lib/live-store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // One database lease coordinates all visitors and edge locations.
    const [aircraft,vessels] = await Promise.all([aircraftSnapshot(),vesselSnapshot()]);
    return Response.json({servedAt:Date.now(),aircraft,vessels},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({servedAt:Date.now(),error:"Shared tracking storage is unavailable. Collection is paused to preserve the free request limits."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
