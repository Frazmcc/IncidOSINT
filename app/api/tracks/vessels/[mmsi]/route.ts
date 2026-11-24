import fleet from "../../../../../data/vessels.json";
import { vesselTrail } from "../../../../../lib/vessel-trail-store";
import { validMmsi, VESSEL_HISTORY_DEFAULT_HOURS, VESSEL_HISTORY_HOURS } from "../../../../../lib/vessel-trails.mjs";
export const dynamic = "force-dynamic";

export async function GET(request:Request, {params}:{params:Promise<{mmsi:string}>}) {
  const {mmsi} = await params, value = new URL(request.url).searchParams.get("hours");
  const hours = value === null ? VESSEL_HISTORY_DEFAULT_HOURS : Number(value);
  if (!validMmsi(mmsi) || !VESSEL_HISTORY_HOURS.includes(hours)) return Response.json({error:"Choose a registered MMSI and a supported history period."}, {status:400});
  const vessel = fleet.records.find(r => r.mmsi === mmsi && !r.identity_conflict);
  if (!vessel) return Response.json({error:"Vessel not in the verified watchlist."}, {status:404});
  try { return Response.json(await vesselTrail(mmsi, vessel.vessel_name, hours), {headers:{"Cache-Control":"public, max-age=5, s-maxage=15"}}); }
  catch { return Response.json({error:"Recorded vessel history is temporarily unavailable. Current positions remain on the map."}, {status:503, headers:{"Cache-Control":"no-store"}}); }
}
